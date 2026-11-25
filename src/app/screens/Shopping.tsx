import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref, type RefObject } from 'react';
import type { Item, List } from '../../core/model';
import { cadenceLabel } from '../../smart/suggest';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { useShopAdd } from '../components/shopAdd';
import { ShopItemSheet } from '../components/ShopItemSheet';
import { useHub, usePartnerShopping, useRt } from '../context';
import { setPrefs, usePrefs } from '../prefs';
import { notifyMembers } from '../runtime';
import { Icon, type IconName } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { Avatar, Band, Check, Empty, IconButton, ListBullet, NewButton, Seg } from '../ui/primitives';
import { haptic } from '../ui/haptics';
import { UrgentTag, VisTag } from '../ui/tags';
import { useFresh } from '../ui/fresh';
import { useSettle, type Settle } from '../ui/useSettle';
import { visTagFor } from '../privacy';
import { back } from '../router';
import { useAddAction } from '../addAction';
import { createFromTemplate, PROJECT_TEMPLATES } from '../../core/actions';
import { heroVis, ProjectChips, ProjectHero, ProjectMenuButton } from './ListScreen';
import { NewProjectSheet } from './Lists';
import { SyncBadge } from '../components/SyncBadge';
import { shoppingView } from '../views';
import { aisleIcon } from '../aisles';

type Row = Item & { emoji: string };

const itemId = (i: Item) => i.id;

/** While the shopbar floats over the page, the page and the toasts make room for it. */
function useFloatHeight(ref: RefObject<HTMLDivElement | null>, on: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--float-h', `${el.offsetHeight + 12}px`);
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--float-h');
    };
  }, [ref, on]);
}

function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* denied — fine */
      }
    };
    const onVis = () => {
      if (alive && document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => {});
    };
  }, [on]);
}

export function Shopping({ listId }: { listId?: string } = {}) {
  const hub = useHub();
  const rt = useRt();
  const prefs = usePrefs();
  const { openSheet, toast } = useOverlays();
  const allLists = hub.shoppingLists();
  const scoped = listId ? hub.list(listId) : undefined;
  const lists = scoped ? [scoped] : allLists;
  const filter = scoped ? scoped.id : allLists.some((l) => l.id === prefs.shopFilter) ? prefs.shopFilter : 'all';
  const v = shoppingView(hub, filter, prefs.dismissed);
  const [mode, setMode] = useState(false);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const bar = useRef<HTMLDivElement>(null);
  const settle = useSettle<Item>(itemId);
  const partnerShopping = usePartnerShopping();
  const partner = hub.partner();
  const shopAdd = useShopAdd();
  const seen = useRef<{
    open: Set<string>;
    urgent: Set<string>;
    cart: Set<string>;
    added: Map<string, number>;
  } | null>(null);

  useWakeLock(mode);

  // Presence: tell the other phone we're in the store (and, once in a while, push them).
  useEffect(() => {
    if (!mode) return;
    rt.sync?.setPresence('shopping');
    let last = 0;
    try {
      last = Number(localStorage.getItem('gila-hub:shopNotified') ?? 0);
    } catch {
      /* storage blocked */
    }
    if (partner && partner.shopAlerts !== false && Date.now() - last > 30 * 60_000) {
      try {
        localStorage.setItem('gila-hub:shopNotified', String(Date.now()));
      } catch {
        /* storage blocked */
      }
      void notifyMembers(rt, [partner.id], {
        title: `${hub.me()?.name ?? 'Your partner'} is shopping`,
        body: 'Need anything? Add it now and it lands on their list.',
        url: '/shop',
        tag: 'shopping',
      });
    }
    return () => rt.sync?.setPresence(null);
  }, [mode, rt, partner, hub]);

  // Live: highlight what the partner adds (or brings back), or marks urgent, while we look at the list.
  const ids = useMemo(
    () => ({
      open: new Set(v.groups.flatMap((g) => g.items).map((i) => i.id)),
      urgent: new Set(v.urgent.map((i) => i.id)),
      cart: new Set(v.inCart.map((i) => i.id)),
    }),
    [v],
  );
  useEffect(() => {
    const prev = seen.current;
    // When each shopping item was last put on a list, whatever the filter shows: an Undo, an
    // untick or a wider filter then never reads as news, while the partner's add or re-add does.
    const shop = new Set(hub.shoppingLists().map((l) => l.id));
    const added = new Map<string, number>();
    for (const i of hub.store.all('item')) if (shop.has(i.listId) && !i.parentId) added.set(i.id, i.addedAt ?? i.createdAt);
    seen.current = { ...ids, added };
    if (!prev) return;
    const byOther = (id: string) => {
      const i = hub.item(id);
      return !!i && (i.addedBy ?? i.createdBy) !== hub.meId;
    };
    const fresh = [...ids.open]
      .filter((id) => prev.added.get(id) !== added.get(id) && byOther(id))
      // Urgent news first: it's the one the shopper most needs to hear.
      .sort((a, b) => Number(!!hub.item(b)?.urgent) - Number(!!hub.item(a)?.urgent));
    const urged = [...ids.urgent].filter((id) => !fresh.includes(id) && !prev.urgent.has(id) && prev.open.has(id) && hub.item(id)?.urgentBy !== hub.meId);
    if (!fresh.length && !urged.length) return;
    setFlash(new Set([...fresh, ...urged]));
    const item = hub.item(fresh[0] ?? urged[0]);
    if (mode && item) {
      const rest = (fresh.length || urged.length) - 1;
      const more = rest > 0 ? ` +${rest}` : '';
      const who = hub.member(fresh.length ? (item.addedBy ?? item.createdBy) : item.urgentBy) ?? hub.partner();
      // Back out of the cart: say why the cart just got smaller.
      const what = !fresh.length ? `marked ${item.title} urgent` : prev.cart.has(item.id) ? `wants another ${item.title}` : `added ${item.title}`;
      if (who) toast(`${who.name} ${what}${fresh.length && item.urgent ? ' · urgent' : ''}${more}`);
    }
    const t = setTimeout(() => setFlash(new Set()), 2200);
    return () => clearTimeout(t);
  }, [ids, hub, mode, toast]);

  const destFor = (name: string, listId?: string): List | undefined => {
    if (listId) return hub.list(listId);
    if (filter !== 'all') return hub.list(filter);
    return hub.routeShopping(name, lists);
  };

  /** One tap on a suggestion: straight onto the right list (routed in "Both"), without duplicates. */
  const quickAdd = (name: string) => {
    const dest = destFor(name);
    if (dest) shopAdd(dest.id, { title: name });
  };

  // New: the composer pointed at the list an item would go to (routed per item in "Both").
  const openNew = () =>
    allLists.length
      ? openSheet((close) => <QuickAddSheet onClose={close} listId={destFor('')?.id ?? lists[0].id} route={filter === 'all'} />)
      : openSheet((close) => <NewProjectSheet onClose={close} initial={{ kind: 'shopping' }} />);
  useAddAction(openNew, 'Add an item');
  const newBtn = <NewButton label="Add an item" onClick={openNew} />;
  const pause = <IconButton icon="pause" label="Pause shopping" onClick={() => setMode(false)} />;

  const tick = (i: Item) => {
    // The row strikes and folds where it is, then shows up in the cart.
    if (!i.done) settle.hold(i.id);
    // It drops into the cart card at the top; a tap on it there takes it back out.
    hub.toggle(i.id);
  };

  const openItem = (i: Item) => openSheet((close) => <ShopItemSheet id={i.id} onClose={close} />);

  const finish = () => {
    const n = v.inCart.length;
    const undo = hub.finishTrip(v.lists.map((l) => l.id));
    setMode(false);
    haptic('success');
    toast(n ? `Paid for · ${n} item${n > 1 ? 's' : ''} into Buy again` : 'Trip done', {
      action: { label: 'Undo', run: undo },
    });
  };

  const filterOptions = [
    { value: 'all', label: lists.length > 2 ? 'All' : 'Both' },
    ...lists.map((l) => ({
      value: l.id,
      label: (
        <>
          <ListBullet list={l} size="xs" />
          <span dir="auto">{l.name}</span>
        </>
      ),
    })),
  ];

  // Nothing to buy: a few things you often buy.
  const empty = !v.openCount && !v.inCart.length;
  const many = filter === 'all' && lists.length > 1;
  const sub = v.openCount ? `${v.openCount} to buy${v.inCart.length ? ` · ${v.inCart.length} in the cart` : ''}` : 'Nothing to buy';
  const shopper = partnerShopping ? hub.member(partnerShopping.member) : undefined;
  const floating = v.openCount > 0 && !mode;
  // Just ticked: it joins the cart once it has settled in its aisle.
  const cart = settle.view('cart', v.inCart);
  useFloatHeight(bar, floating);

  return (
    <div className={mode ? 'shopmode' : undefined}>
      {scoped ? (
        <Band
          onBack={() => back({ name: 'lists' })}
          actions={
            <>
              {mode ? pause : <ProjectMenuButton listId={scoped.id} />}
              {newBtn}
            </>
          }
          mini={scoped.name}
        >
          <ProjectHero list={scoped} sub={mode ? `Shopping now · ${sub}` : `${sub}${heroVis(hub, scoped)}`} />
        </Band>
      ) : (
        <Band
          top={<SyncBadge />}
          title={mode ? 'Shopping now' : 'Shopping'}
          sub={sub}
          actions={
            <>
              {mode ? pause : null}
              {newBtn}
            </>
          }
        />
      )}
      <div className="column">
        {scoped && !mode ? <ProjectChips list={scoped} /> : null}
        {!allLists.length ? (
          <Empty title="No shopping lists yet">
            <div className="tokens tokens--center">
              {PROJECT_TEMPLATES.filter((t) => t.kind === 'shopping').map((t) => (
                <button key={t.key} type="button" className="token" onClick={() => createFromTemplate(hub, t)}>
                  <Icon name="plus" /> {t.name}
                </button>
              ))}
            </div>
          </Empty>
        ) : null}
        {!scoped && lists.length > 1 ? (
          <div className="filter">
            <Seg label="Which list" value={filter} onChange={(val) => setPrefs({ shopFilter: val })} options={filterOptions} />
          </div>
        ) : null}

        {allLists.length && empty && v.buyAgain.length ? (
          <div className="tokens shop__again">
            {v.buyAgain.slice(0, 4).map((s) => (
              <button key={s.key} type="button" className="token" onClick={() => quickAdd(s.name)}>
                <Icon name="plus" />
                <span dir="auto">{s.name}</span>
              </button>
            ))}
          </div>
        ) : null}

        {cart.length ? (
          <CartCard items={cart.map(({ row }) => row)} left={v.openCount} onOut={tick} onFinish={finish} store={mode} />
        ) : null}

        {shopper && !mode ? (
          <div className="notice">
            <Avatar member={shopper} size="sm" />
            <span className="notice__text">
              <strong>{shopper.name} is in the store.</strong> What you add shows up for them.
            </span>
          </div>
        ) : null}

        <>
          {!mode && !empty && v.buyAgain.length ? (
            <div className="buyagain">
              <p className="inline__prompt">Buy again?</p>
              <div className="tokens tokens--scroll">
                {v.buyAgain.map((s) => (
                  <span key={s.key} className="token token--split" title={cadenceLabel(s.avgDays)}>
                    <button type="button" onClick={() => quickAdd(s.name)}>
                      <Icon name="plus" />
                      <span dir="auto">{s.name}</span>
                    </button>
                    <button
                      type="button"
                      className="token__x"
                      aria-label={`Not now: ${s.name}`}
                      onClick={() =>
                        setPrefs({
                          dismissed: { ...prefs.dismissed, [s.key]: s.lastAt },
                        })
                      }
                    >
                      <Icon name="x" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {v.urgent.length || v.groups.length ? (
            <ShopList
              groups={[
                ...(v.urgent.length
                  ? [
                      {
                        key: 'urgent',
                        label: null,
                        items: v.urgent,
                        showList: many,
                      },
                    ]
                  : []),
                ...v.groups.map((g) => {
                  // A list's dot only where it tells you something: on rows where an aisle mixes
                  // lists, or once on the head when two lists share this aisle's flavor.
                  const one = new Set(g.items.map((i) => i.listId)).size === 1;
                  const twins = lists.filter((l) => hub.flavorOf(l) === g.flavor).length > 1;
                  return {
                    key: g.key,
                    label: g.label,
                    items: g.items,
                    icon: aisleIcon(g.flavor, g.category),
                    emoji: g.emoji,
                    showList: many && !one,
                    dot: many && one && twins ? hub.list(g.items[0].listId) : undefined,
                  };
                }),
              ]}
              onTick={tick}
              onOpen={openItem}
              flash={flash}
              draggable={!mode}
              settle={settle}
            />
          ) : null}

        </>
      </div>

      {floating ? (
        <div className="shopbar" ref={bar}>
          <button type="button" className="btn shopbar__start" onClick={() => setMode(true)}>
            <Icon name="cart" className="icon--sm" /> Start shopping
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface ShopGroup {
  key: string;
  /** null = the Urgent group */
  label: string | null;
  items: Row[];
  /** Rows show their list's dot (the card mixes lists). */
  showList: boolean;
  /** The one list this card holds, when its name alone doesn't say which. */
  dot?: List;
  /** The aisle's glyph; aisles without one keep their emoji. */
  icon?: IconName;
  emoji?: string;
}

function SortableShopRow(props: Parameters<typeof ShopRow>[0]) {
  const s = useSortableItem(props.item.id);
  return <ShopRow {...props} liRef={s.ref} liStyle={s.style} liClass={s.className} dragProps={s.props} />;
}

/** A card per aisle (and the Urgent card on top). Hold a row to reorder it within its aisle. */
function ShopList({
  groups: live,
  onTick,
  onOpen,
  flash,
  draggable,
  settle,
}: {
  groups: ShopGroup[];
  onTick: (i: Item) => void;
  onOpen: (i: Item) => void;
  flash: Set<string>;
  draggable: boolean;
  settle: Settle<Item>;
}) {
  const hub = useHub();
  // An aisle whose last item was just ticked stays until that row has settled.
  const last = useRef<ShopGroup[]>([]);
  const groups = [...live];
  last.current.forEach((g, at) => {
    if (!groups.some((x) => x.key === g.key) && g.items.some((i) => settle.held.has(i.id))) groups.splice(Math.min(at, groups.length), 0, { ...g, items: [] });
  });
  last.current = live;
  /**
   * Order within one aisle, which is sorted by order key. An aisle can mix two lists whose keys
   * tie, so the aisle as dropped is what gets its keys (views.ts). The Urgent card isn't
   * arranged: it reads in walking order.
   */
  const onMove = (next: string[], id: string) => hub.reorderIn(next, id);
  return (
    <>
      {groups.map((g) => {
        const shown = settle.view(g.key, g.items);
        return shown.length ? (
          <section key={g.key} className={`aisle ${g.label ? '' : 'aisle--urgent'}`} aria-label={g.label ?? 'Urgent'} data-sort-bounds>
            {g.label ? (
              <h2 className="aisle__head">
                {g.icon ? (
                  <Icon name={g.icon} />
                ) : g.emoji ? (
                  <span className="aisle__emoji" aria-hidden="true">
                    {g.emoji}
                  </span>
                ) : null}
                {g.label}
                <span className="num">{g.items.length}</span>
                {g.dot ? <ListBullet list={g.dot} size="xs" /> : null}
              </h2>
            ) : null}
            <Sortable
              ids={g.items.map((i) => i.id)}
              onMove={onMove}
              bounds="refuse"
              disabled={!draggable || !g.label}
              label={(id) => hub.item(id)?.title ?? ''}
              renderOverlay={(id) => {
                const item = g.items.find((i) => i.id === id);
                return item ? (
                  <ul className="rows">
                    <ShopRow item={item} onTick={onTick} onOpen={onOpen} showList={g.showList} inUrgent={!g.label} />
                  </ul>
                ) : null;
              }}
            >
              <ul className="rows">
                {/* The Urgent card is the screen's one lemon card: its title sits inside it. */}
                {g.label ? null : (
                  <li className="aisle__cap">
                    <h2 className="aisle__captitle">Urgent</h2>
                    <span className="ccard__badge num">{g.items.length}</span>
                  </li>
                )}
                {shown.map(({ row: i, settling }) =>
                  settling ? (
                    <ShopRow key={i.id} item={i} onTick={onTick} onOpen={onOpen} showList={g.showList} inUrgent={!g.label} settling />
                  ) : draggable && g.label ? (
                    <SortableShopRow key={i.id} item={i} onTick={onTick} onOpen={onOpen} flash={flash.has(i.id)} showList={g.showList} inUrgent={!g.label} />
                  ) : (
                    <ShopRow key={i.id} item={i} onTick={onTick} onOpen={onOpen} flash={flash.has(i.id)} showList={g.showList} inUrgent={!g.label} />
                  ),
                )}
              </ul>
            </Sortable>
          </section>
        ) : null;
      })}
    </>
  );
}

/** One thing to buy. Also on Today (To buy). */
export function ShopRow({
  item,
  onTick,
  onOpen,
  flash,
  showList,
  inUrgent,
  settling,
  liRef,
  liStyle,
  liClass,
  dragProps,
}: {
  item: Item;
  onTick: (i: Item) => void;
  onOpen: (i: Item) => void;
  flash?: boolean;
  showList?: boolean;
  /** Rendered inside the Urgent card (so no extra tag needed). */
  inUrgent?: boolean;
  /** Just ticked: drawn checked while it strikes through and folds away (useSettle). */
  settling?: boolean;
  liRef?: Ref<HTMLLIElement>;
  liStyle?: CSSProperties;
  liClass?: string;
  dragProps?: Record<string, unknown>;
}) {
  const hub = useHub();
  const list = hub.list(item.listId);
  const vis = visTagFor(hub, item);
  const note = item.notes?.slice(0, 60);
  const mine = useFresh(item.id);
  // Once it's in the cart, the urgency is dealt with.
  const tagged = item.urgent && !item.done && !inUrgent;
  return (
    <li
      ref={liRef}
      style={liStyle}
      {...dragProps}
      data-id={item.id}
      data-settle={item.id}
      className={`row row--tap ${item.done ? 'is-done' : ''} ${mine ? 'row--fresh row--flash' : flash ? 'row--flash' : ''} ${settling ? 'is-settling' : ''} ${liClass ?? ''}`}
      onClick={() => onOpen(item)}
    >
      <Check on={item.done || !!settling} color={list?.color} onToggle={() => onTick(item)} label={item.title} />
      <div className="row__body">
        <span className="row__title" dir="auto">
          {item.title}
          {item.qty ? <span className="qty num">{/^\d+$/.test(item.qty) ? `×${item.qty}` : item.qty}</span> : null}
        </span>
        {vis || note ? (
          <span className="row__meta">
            {vis ? <VisTag item={item} /> : null}
            {note ? (
              <span className="meta" dir="auto">
                {note}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {showList || tagged ? (
        <span className="row__trail">
          {tagged ? <UrgentTag /> : null}
          {showList ? <ListBullet list={list} size="xs" /> : null}
        </span>
      ) : null}
    </li>
  );
}

/**
 * The cart: what you picked up this trip, as itself. It fills as you tick (each thing drops
 * in), the bar under it shows how much of the trip is done, a tap takes a thing back out to
 * its aisle, and Pay empties it into Buy again. No words needed.
 */
function CartCard({
  items,
  left,
  onOut,
  onFinish,
  store,
}: {
  items: Array<Item & { emoji?: string }>;
  left: number;
  onOut: (i: Item) => void;
  onFinish: () => void;
  store: boolean;
}) {
  const [paying, setPaying] = useState(false);
  const total = items.length + left;
  const pct = total ? Math.round((items.length / total) * 100) : 100;
  const pay = () => {
    if (paying) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return onFinish();
    setPaying(true);
    setTimeout(onFinish, 460);
  };
  return (
    <section className={`cartcard ${paying ? 'is-paying' : ''} ${left === 0 ? 'is-full' : ''}`} aria-label={`In the cart: ${items.length} of ${total}`}>
      <div className="cartcard__head">
        <span className="cartcard__basket" key={items.length}>
          <Icon name="basket" lit />
          <span className="cartcard__n num">{items.length}</span>
        </span>
        <span className="cartcard__bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="cartcard__of num">
          {items.length}/{total}
        </span>
      </div>
      <div className="cartcard__items">
        {[...items].reverse().map((i) => (
          <button key={i.id} type="button" className="cartchip" onClick={() => onOut(i)} aria-label={`Take ${i.title} out of the cart`}>
            {i.emoji ? <span className="cartchip__e">{i.emoji}</span> : null}
            <span dir="auto">{i.title}</span>
          </button>
        ))}
      </div>
      <button type="button" className={`btn btn--sm cartcard__pay ${store || left === 0 ? '' : 'btn--quiet'}`} onClick={pay}>
        <Icon name="check" className="icon--sm" /> Pay
      </button>
    </section>
  );
}

import { ViewToggle } from '../components/ViewToggle';
import { PathCrumbs, projectPath } from '../components/PathCrumbs';
import { useWide } from '../ui/useWide';
import { TwinTag } from '../components/ItemRow';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref, type RefObject } from 'react';
import type { Item, List } from '../../core/model';
import { cadenceLabel } from '../../smart/suggest';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { useShopAdd } from '../components/shopAdd';
import { useHub, usePartnerShopping, useRt } from '../context';
import { setPrefs, usePrefs } from '../prefs';
import { notifyMembers } from '../runtime';
import { Icon } from '../ui/Icon';
import { FilterBar, FilterButton, useFilter } from '../components/Filter';
import { TagManager, TagMark, TagPills } from '../components/Tags';
import { useOverlays } from '../ui/overlays';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { Avatar, Band, Check, Empty, IconButton, ListBullet, NewButton, Seg } from '../ui/primitives';
import { haptic } from '../ui/haptics';
import { UrgentTag, VisTag } from '../ui/tags';
import { useFresh } from '../ui/fresh';
import { useSettle, type Settle } from '../ui/useSettle';
import { visTagFor } from '../privacy';
import { back, navigate } from '../router';
import { useAddAction } from '../addAction';
import { createFromTemplate, PROJECT_TEMPLATES } from '../../core/actions';
import { heroVis, ProjectChips, ProjectHero, ProjectMenuButton } from './ListScreen';
import { SyncBadge } from '../components/SyncBadge';
import { shoppingView, shopTree } from '../views';

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
  const wide = useWide();
  const rt = useRt();
  const prefs = usePrefs();
  const { openSheet, toast } = useOverlays();
  // The Shopping tab is the Shopping project; a list's own page is that list (and what's inside it).
  const root = hub.shopRoot();
  const base = listId ? hub.list(listId) : root;
  const tab = !listId;
  const subs = base ? hub.subLists(base.id) : [];
  const [localPick, setLocalPick] = useState('all');
  const wanted = tab ? prefs.shopFilter : localPick;
  const pick = subs.some((l) => l.id === wanted) ? wanted : 'all';
  const setPick = (val: string) => (tab ? setPrefs({ shopFilter: val }) : setLocalPick(val));
  const scoped = tab ? undefined : base;
  const filter = useFilter(tab ? 'shop' : `l:${base?.id ?? ''}`);
  const v = shoppingView(hub, base?.id ?? '', pick, prefs.dismissed);
  const lists = v.lists;
  const openIn = (id: string) => {
    const ids = new Set(shopTree(hub, id).map((l) => l.id));
    return hub.store.all('item').filter((i) => ids.has(i.listId) && !i.done && !i.archived && !i.parentId).length;
  };
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

  /** Where a new thing goes: the one list shown, else the list its words belong on ("bulbs" → Home). */
  const destFor = (name: string): List | undefined => {
    if (lists.length === 1) return lists[0];
    const leaning = lists.filter((l) => l.flavor);
    return name && leaning.length ? hub.routeShopping(name, leaning) : (leaning.find((l) => l.flavor === 'grocery') ?? leaning[0] ?? lists[0]);
  };

  /** One tap on a suggestion: straight onto the right list (routed in "All"), without duplicates. */
  const quickAdd = (name: string) => {
    const dest = destFor(name);
    if (dest) shopAdd(dest.id, { title: name });
  };

  // New: the composer pointed at the list an item would go to (routed per item in "All").
  const openNew = () => {
    if (base) openSheet((close) => <QuickAddSheet onClose={close} listId={destFor('')?.id ?? base.id} route={lists.length > 1} />);
  };
  useAddAction(openNew, 'Add an item');
  const newBtn = <NewButton label="Add an item" onClick={openNew} />;
  const pause = <IconButton icon="pause" label="Pause shopping" onClick={() => setMode(false)} />;

  if (!base) {
    return (
      <>
        <Band top={<SyncBadge />} title="Shopping" />
        <div className="column">
          <Empty title="No shopping lists yet" text="They live in one Shopping project: groceries sorted by aisle, things for the home, anything you like.">
            <div className="tokens tokens--center">
              {PROJECT_TEMPLATES.filter((t) => t.flavor).map((t) => (
                <button key={t.key} type="button" className="token" onClick={() => createFromTemplate(hub, t)}>
                  <Icon name="plus" /> {t.name}
                </button>
              ))}
            </div>
          </Empty>
        </div>
      </>
    );
  }

  const tick = (i: Item) => {
    // The row strikes and folds where it is, then shows up in the cart.
    if (!i.done) settle.hold(i.id);
    // It drops into the cart card at the top; a tap on it there takes it back out.
    hub.toggle(i.id);
  };

  const openItem = (i: Item) => navigate({ name: 'item', id: i.id });

  const finish = () => {
    const n = v.inCart.length;
    const undo = hub.finishTrip(v.lists.map((l) => l.id));
    setMode(false);
    haptic('success');
    toast(n ? `Paid for · ${n} item${n > 1 ? 's' : ''} into Buy again` : 'Trip done', {
      action: { label: 'Undo', run: undo },
    });
  };

  // Nothing to buy: a few things you often buy.
  const empty = !v.openCount && !v.inCart.length;
  // Lists only get named (a dot on a row or an aisle) when more than one has things in it.
  const many = new Set([...v.groups.flatMap((g) => g.items), ...v.inCart].map((i) => i.listId)).size > 1;
  // The filter hides rows; the counts still say what's there.
  const keep = (i: Item) => filter.test(i);
  const groups = v.groups.map((g) => ({ ...g, items: g.items.filter(keep) })).filter((g) => g.items.length);
  const urgent = v.urgent.filter(keep);
  const hidden = filter.active ? v.openCount - groups.reduce((n, g) => n + g.items.length, 0) : 0;
  const sub = v.openCount ? `${v.openCount} to buy${v.inCart.length ? ` · ${v.inCart.length} in the cart` : ''}` : 'Nothing to buy';
  const shopper = partnerShopping ? hub.member(partnerShopping.member) : undefined;
  const floating = v.openCount > 0 && !mode;
  // Just ticked: it joins the cart once it has settled in its aisle.
  const cart = settle.view('cart', v.inCart);
  useFloatHeight(bar, floating);

  return (
    <div className={[mode ? 'shopmode' : '', scoped ? 'projpage' : ''].filter(Boolean).join(' ') || undefined}>
      {scoped ? (
        <Band
          onBack={() => back(hub.parentOf(scoped.id) ? { name: 'list', id: hub.parentOf(scoped.id)!.id } : { name: 'lists' })}
          actions={
            <>
              {mode ? pause : <FilterButton filter={filter} />}
              {mode ? null : <ProjectMenuButton listId={scoped.id} />}
              {newBtn}
            </>
          }
          mini={scoped.name}
          crumbs={<PathCrumbs steps={projectPath(hub, scoped.id)} />}
        >
          <ProjectHero list={scoped} sub={mode ? `Shopping now · ${sub}` : `${sub}${heroVis(hub, scoped)}`} />
          {wide && !mode ? <ProjectChips list={scoped} /> : null}
        </Band>
      ) : (
        <Band
          top={<SyncBadge />}
          title={mode ? 'Shopping now' : base.name}
          sub={sub}
          actions={
            <>
              {mode ? pause : <FilterButton filter={filter} />}
              {mode ? null : <ProjectMenuButton listId={base.id} />}
              {newBtn}
            </>
          }
        />
      )}
      <div className="column">
        {/* Which list, first thing on the page: all of them together, or one, each with its count. */}
        {subs.length > 1 || (subs.length === 1 && openIn(base.id) > openIn(subs[0].id)) ? (
          <div className="filter filter--top">
            <Seg
              label="Which list"
              value={pick}
              onChange={setPick}
              options={[
                { value: 'all', label: <FilterLabel name="All" n={openIn(base.id)} /> },
                ...subs.map((l) => ({ value: l.id, label: <FilterLabel list={l} name={l.name} n={openIn(l.id)} /> })),
              ]}
            />
          </div>
        ) : null}
        {scoped && !mode && !wide ? <ProjectChips list={scoped} /> : null}
        <FilterBar filter={filter} hidden={hidden} />

        {empty && v.buyAgain.length ? (
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
          {!mode && !empty && v.buyAgain.length && !filter.active ? (
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

          {urgent.length || groups.length ? (
            <>
            <ViewToggle which="shopView" />
            <ShopList
              cards={prefs.shopView === 'cards'}
              groups={[
                ...(urgent.length
                  ? [
                      {
                        key: 'urgent',
                        label: null,
                        items: urgent,
                        showList: many,
                      },
                    ]
                  : []),
                ...groups.map((g) => {
                  // A list's dot only where it tells you something: on rows when the aisle mixes lists.
                  const one = new Set(g.items.map((i) => i.listId)).size === 1;
                  return {
                    key: g.key,
                    label: g.label,
                    items: g.items,
                    tag: g.tag,
                    icon: g.icon,
                    showList: many && !one,
                    dot: many && one && pick === 'all' ? hub.list(g.items[0].listId) : undefined,
                  };
                }),
              ]}
              onTick={tick}
              onOpen={openItem}
              flash={flash}
              draggable={!mode}
              settle={settle}
            />
            </>
          ) : filter.active && v.openCount ? (
            <p className="hint">Nothing here with this filter.</p>
          ) : null}

          {!mode ? (
            <div className="homeedit">
              <button type="button" className="textbtn" onClick={() => openSheet((close) => <TagManager onClose={close} />)}>
                <Icon name="tag" />
                Edit tags
              </button>
            </div>
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
  /** The aisle's tag (null: the untagged), and its mark. Dragging a thing to another aisle gives it that tag. */
  tag?: string | null;
  icon?: string | null;
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
  cards,
}: {
  cards?: boolean;
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
  // One drag across every aisle: drop a thing in another aisle and it moves there (and is
  // remembered there, for both of us). The Urgent card isn't arranged: it reads in walking order.
  const labeled = groups.filter((g) => g.label);
  const ids = labeled.flatMap((g) => g.items.map((i) => i.id));
  const groupOf = new Map(labeled.flatMap((g) => g.items.map((i) => [i.id, g] as const)));
  const lastPt = useRef<[number, number] | null>(null);
  useEffect(() => {
    const track = (e: PointerEvent) => {
      lastPt.current = [e.clientX, e.clientY];
    };
    window.addEventListener('pointermove', track, { capture: true, passive: true });
    return () => window.removeEventListener('pointermove', track, { capture: true });
  }, []);
  const { toast } = useOverlays();
  const onMove = (next: string[], id: string) => {
    const from = groupOf.get(id);
    if (!from) return;
    const at = next.indexOf(id);
    // Where it landed: the aisle under the hand, else the one it now sits beside.
    const pt = lastPt.current;
    const key = pt ? document.elementsFromPoint(pt[0], pt[1]).map((e) => e.closest('[data-aisle]')?.getAttribute('data-aisle')).find(Boolean) : null;
    const to = labeled.find((g) => g.key === key) ?? groupOf.get(next[at - 1]) ?? groupOf.get(next[at + 1]) ?? from;
    const item = hub.item(id);
    if (to !== from) {
      if (!item || to.tag === undefined) return;
      hub.moveToTag(id, from.tag ?? null, to.tag);
      haptic('drop');
      toast(`Moved to ${to.label}`);
    }
    hub.reorderIn(
      next.filter((x) => x === id || groupOf.get(x) === to),
      id,
    );
  };
  const aisles = (
    <>
      {groups.map((g) => {
        const shown = settle.view(g.key, g.items);
        return shown.length ? (
          <section key={g.key} className={`aisle ${g.label ? '' : 'aisle--urgent'}`} aria-label={g.label ?? 'Urgent'} data-aisle={g.label ? g.key : undefined}>
            {g.label ? (
              <h2 className="aisle__head">
                <TagMark icon={g.icon} className="" />
                {g.label}
                <span className="num">{g.items.length}</span>
                {g.dot ? <ListBullet list={g.dot} size="xs" /> : null}
              </h2>
            ) : null}
              <ul className={`rows ${cards ? 'rows--cards' : ''}`}>
                {/* The Urgent card is the screen's one lemon card: its title sits inside it. */}
                {g.label ? null : (
                  <li className="aisle__cap">
                    <h2 className="aisle__captitle">Urgent</h2>
                    <span className="ccard__badge num">{g.items.length}</span>
                  </li>
                )}
                {shown.map(({ row: i, settling }) =>
                  settling ? (
                    <ShopRow key={i.id} item={i} onTick={onTick} onOpen={onOpen} showList={g.showList} inUrgent={!g.label} aisleTag={g.tag} settling />
                  ) : draggable && g.label ? (
                    <SortableShopRow key={i.id} item={i} onTick={onTick} onOpen={onOpen} flash={flash.has(i.id)} showList={g.showList} inUrgent={!g.label} aisleTag={g.tag} />
                  ) : (
                    <ShopRow key={i.id} item={i} onTick={onTick} onOpen={onOpen} flash={flash.has(i.id)} showList={g.showList} inUrgent={!g.label} aisleTag={g.tag} />
                  ),
                )}
              </ul>
          </section>
        ) : null;
      })}
    </>
  );
  if (!draggable) return aisles;
  return (
    <Sortable
      ids={ids}
      onMove={onMove}
      layout={cards ? 'grid' : 'rows'}
      bounds="none"
      label={(id) => hub.item(id)?.title ?? ''}
      renderOverlay={(id) => {
        const item = hub.item(id);
        const g = groupOf.get(id);
        return item && g ? (
          <ul className={`rows ${cards ? 'rows--cards' : ''}`}>
            <ShopRow item={item as Row} onTick={onTick} onOpen={onOpen} showList={g.showList} inUrgent={false} aisleTag={g.tag} />
          </ul>
        ) : null;
      }}
    >
      {aisles}
    </Sortable>
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
  aisleTag,
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
  /** The aisle it's drawn in: that tag goes without saying. */
  aisleTag?: string | null;
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
  const twin = hub.linked(item);
  const tags = hub.tagsOf(item).filter((t) => t !== aisleTag);
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
        {vis || note || twin || tags.length ? (
          <span className="row__meta">
            {twin ? <TwinTag twin={twin} label={`For ${hub.item(twin.parentId)?.title ?? twin.title}`} /> : null}
            <TagPills ids={tags} />
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

/** A filter choice: the list's dot, its name and how many are on it. */
function FilterLabel({ list, name, n }: { list?: List; name: string; n: number }) {
  return (
    <>
      {list ? <ListBullet list={list} size="xs" /> : null}
      <span dir="auto">{name}</span>
      {n ? <span className="filter__n num">{n}</span> : null}
    </>
  );
}

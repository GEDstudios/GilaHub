import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref, type RefObject } from 'react';
import type { Item, List } from '../../core/model';
import { suggestFromCatalog } from '../../smart/categorize';
import { fold, itemKey, parseQuantity } from '../../smart/normalize';
import type { ParseResult } from '../../smart/parse';
import { cadenceLabel, historyMatches } from '../../smart/suggest';
import { AddRow, type AddRowHandle } from '../components/QuickAdd';
import { QuickAddSheet } from '../components/QuickAddSheet';
import type { Draft } from '../components/editors';
import { useShopAdd } from '../components/shopAdd';
import { ShopItemSheet } from '../components/ShopItemSheet';
import { useHub, usePartnerShopping, useRt } from '../context';
import { setPrefs, usePrefs } from '../prefs';
import { notifyMembers } from '../runtime';
import { Icon, type IconName } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { Avatar, Band, Check, Disclosure, Empty, IconButton, ListBullet, NewButton, Seg } from '../ui/primitives';
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

/** The shopbar says what just went in the cart, with Undo, instead of a toast. */
interface CartNote {
  text: string;
  n: number;
  undo: () => void;
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
  const [query, setQuery] = useState('');
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [cartOpen, setCartOpen] = useState(false);
  const [note, setNote] = useState<CartNote | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const settle = useSettle<Item>(itemId);
  /** In "Both", the user can redirect the next add to the other list. */
  const [override, setOverride] = useState<string | null>(null);
  const partnerShopping = usePartnerShopping();
  const partner = hub.partner();
  const addRef = useRef<AddRowHandle>(null);
  const shopAdd = useShopAdd();
  const seen = useRef<{ open: Set<string>; urgent: Set<string> } | null>(null);

  useWakeLock(mode);
  // In the store the cart starts open; outside it, folded.
  useEffect(() => {
    setCartOpen(mode);
    setNote(null);
  }, [mode]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(t);
  }, [note]);

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

  // Live: highlight what the partner adds, or marks urgent, while we look at the list.
  const ids = useMemo(
    () => ({ open: new Set(v.groups.flatMap((g) => g.items).map((i) => i.id)), urgent: new Set(v.urgent.map((i) => i.id)) }),
    [v],
  );
  useEffect(() => {
    const prev = seen.current;
    seen.current = ids;
    if (!prev) return;
    const fresh = [...ids.open].filter((id) => !prev.open.has(id) && hub.item(id)?.createdBy !== hub.meId);
    const urged = [...ids.urgent].filter((id) => !prev.urgent.has(id) && prev.open.has(id) && hub.item(id)?.urgentBy !== hub.meId);
    if (!fresh.length && !urged.length) return;
    setFlash(new Set([...fresh, ...urged]));
    if (mode) {
      const [first, rest, verb] = fresh.length ? [fresh[0], fresh.length - 1, 'added'] : [urged[0], urged.length - 1, 'marked'];
      const item = hub.item(first);
      const who = hub.member(fresh.length ? item?.createdBy : item?.urgentBy) ?? hub.partner();
      if (who && item) toast(`${who.name} ${verb} ${item.title}${fresh.length ? '' : ' urgent'}${rest > 0 ? ` +${rest}` : ''}`);
    }
    const t = setTimeout(() => setFlash(new Set()), 2200);
    return () => clearTimeout(t);
  }, [ids, hub, mode, toast]);

  const destFor = (name: string, listId?: string): List | undefined => {
    if (listId) return hub.list(listId);
    if (filter !== 'all') return hub.list(filter);
    if (override) return hub.list(override);
    return hub.routeShopping(name, lists);
  };

  /** The add row's words → the right list (routed in "Both"), without duplicates. */
  const add = (p: ParseResult, chips: Draft, opts: { quiet?: boolean } = {}) => {
    const dest = destFor(p.title, p.listId);
    if (!dest) return;
    shopAdd(dest.id, { title: p.title, qty: p.qty ?? null, urgent: chips.urgent, vis: chips.visibility }, opts);
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
    const undo = hub.toggle(i.id);
    if (i.done) return;
    // The shopbar says it (with Undo) instead of a toast: one floating thing above the bar.
    setNote((prev) =>
      prev
        ? {
            text: `${prev.n + 1} in the cart`,
            n: prev.n + 1,
            undo: () => {
              undo();
              prev.undo();
            },
          }
        : { text: `${i.title} is in the cart`, n: 1, undo },
    );
  };

  const openItem = (i: Item) => openSheet((close) => <ShopItemSheet id={i.id} onClose={close} />);

  const finish = () => {
    const n = v.inCart.length;
    const undo = hub.finishTrip(v.lists.map((l) => l.id));
    setMode(false);
    toast(n ? `Trip done · ${n} item${n > 1 ? 's' : ''} filed` : 'Trip done', { action: { label: 'Undo', run: undo } });
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

  const q = query.trim();
  // Nothing to buy: just the add row and a few things you often buy.
  const empty = !v.openCount && !v.inCart.length;
  const searching = q.length > 0;
  const many = filter === 'all' && lists.length > 1;
  const sub = v.openCount ? `${v.openCount} to buy${v.inCart.length ? ` · ${v.inCart.length} in the cart` : ''}` : 'Nothing to buy';
  const shopper = partnerShopping ? hub.member(partnerShopping.member) : undefined;
  const floating = !searching && (v.openCount > 0 || mode || !!note);
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

        {allLists.length ? (
          <AddRow
            listId={(filter !== 'all' && hub.list(filter)?.id) || (destFor('') ?? lists[0]).id}
            placeholder={filter === 'all' ? 'Add an item' : `Add to ${hub.list(filter)?.name}`}
            text={query}
            onText={(t) => {
              setQuery(t);
              if (!t) setOverride(null);
            }}
            onSubmit={add}
            handle={addRef}
          />
        ) : null}
        {allLists.length && empty && !searching && v.buyAgain.length ? (
          <div className="tokens addrow__suggest">
            {v.buyAgain.slice(0, 4).map((s) => (
              <button key={s.key} type="button" className="token" onClick={() => addRef.current?.submit(s.name)}>
                <Icon name="plus" />
                <span dir="auto">{s.name}</span>
              </button>
            ))}
          </div>
        ) : null}

        {shopper && !mode ? (
          <div className="notice">
            <Avatar member={shopper} size="sm" />
            <span className="notice__text">
              <strong>{shopper.name} is in the store.</strong> What you add shows up for them.
            </span>
          </div>
        ) : null}

        {searching ? (
          <SearchResults
            query={q}
            view={v}
            onAdd={(raw) => addRef.current?.submit(raw)}
            onTick={tick}
            onOpen={openItem}
            filter={filter}
            lists={lists}
            dest={destFor(parseQuantity(q).name)}
            onSwitch={(id) => setOverride(id)}
          />
        ) : (
          <>
            {!mode && !empty && v.buyAgain.length ? (
              <div className="buyagain">
                <p className="inline__prompt">Buy again?</p>
                <div className="tokens tokens--scroll">
                  {v.buyAgain.map((s) => (
                    <span key={s.key} className="token token--split" title={cadenceLabel(s.avgDays)}>
                      <button type="button" onClick={() => addRef.current?.submit(s.name)}>
                        <Icon name="plus" />
                        <span dir="auto">{s.name}</span>
                      </button>
                      <button
                        type="button"
                        className="token__x"
                        aria-label={`Not now: ${s.name}`}
                        onClick={() => setPrefs({ dismissed: { ...prefs.dismissed, [s.key]: s.lastAt } })}
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
                  ...(v.urgent.length ? [{ key: 'urgent', label: null, items: v.urgent }] : []),
                  ...v.groups.map((g) => ({ key: g.key, label: g.label, items: g.items, icon: aisleIcon(g.flavor, g.category), emoji: g.emoji })),
                ]}
                onTick={tick}
                onOpen={openItem}
                flash={flash}
                showList={many}
                draggable={!mode}
                settle={settle}
              />
            ) : null}

            {cart.length ? (
              <Disclosure
                title={
                  <>
                    <Icon name="cart" className="icon--sm" /> In the cart
                  </>
                }
                count={cart.length}
                open={cartOpen}
                onToggle={setCartOpen}
                // One Finish: the shopbar's in the store, this one otherwise.
                after={
                  mode ? null : (
                    <button type="button" className="btn btn--quiet btn--sm finish" onClick={finish}>
                      <Icon name="check" className="icon--sm" /> Finish trip
                    </button>
                  )
                }
              >
                <ul className="rows">
                  {cart.map(({ row: i }) => (
                    <ShopRow key={i.id} item={i} onTick={tick} onOpen={openItem} showList={many} />
                  ))}
                </ul>
              </Disclosure>
            ) : null}
          </>
        )}
      </div>

      {floating ? (
        <div className="shopbar" ref={bar}>
          {mode ? (
            <div className="shopbar__inner">
              <span className={`shopbar__text num ${note ? 'is-note' : ''}`} key={note?.n ?? 0} dir="auto" aria-live="polite">
                {note ? note.text : `${v.openCount} left · ${v.inCart.length} in the cart`}
              </span>
              {note ? (
                <button
                  type="button"
                  className="shopbar__undo"
                  onClick={() => {
                    note.undo();
                    setNote(null);
                  }}
                >
                  Undo
                </button>
              ) : null}
              <button type="button" className="btn btn--sm" onClick={finish}>
                Finish
              </button>
            </div>
          ) : note ? (
            <div className="shopbar__inner shopbar__inner--note">
              <span className="shopbar__text is-note" key={note.n} dir="auto" aria-live="polite">
                {note.text}
              </span>
              <button
                type="button"
                className="shopbar__undo"
                onClick={() => {
                  note.undo();
                  setNote(null);
                }}
              >
                Undo
              </button>
            </div>
          ) : (
            <button type="button" className="btn shopbar__start" onClick={() => setMode(true)}>
              <Icon name="cart" className="icon--sm" /> Start shopping
            </button>
          )}
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
  showList,
  draggable,
  settle,
}: {
  groups: ShopGroup[];
  onTick: (i: Item) => void;
  onOpen: (i: Item) => void;
  flash: Set<string>;
  showList: boolean;
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
   * Order within one aisle. Order keys compare across lists, and an aisle is sorted by them, so
   * the visible neighbours place the row exactly where it was dropped, even when the aisle mixes
   * two lists. The Urgent card isn't arranged: it reads in walking order (views.ts).
   */
  const onMove = (next: string[], id: string) => {
    const at = next.indexOf(id);
    hub.reorder(id, next[at - 1] ?? null, next[at + 1] ?? null);
  };
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
                    <ShopRow item={item} onTick={onTick} onOpen={onOpen} showList={showList} inUrgent={!g.label} />
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
                  <ShopRow key={i.id} item={i} onTick={onTick} onOpen={onOpen} showList={showList} inUrgent={!g.label} settling />
                ) : draggable && g.label ? (
                  <SortableShopRow key={i.id} item={i} onTick={onTick} onOpen={onOpen} flash={flash.has(i.id)} showList={showList} inUrgent={!g.label} />
                ) : (
                  <ShopRow key={i.id} item={i} onTick={onTick} onOpen={onOpen} flash={flash.has(i.id)} showList={showList} inUrgent={!g.label} />
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
      {showList || (item.urgent && !inUrgent) ? (
        <span className="row__trail">
          {item.urgent && !inUrgent ? <UrgentTag /> : null}
          {showList ? <ListBullet list={list} size="xs" /> : null}
        </span>
      ) : null}
    </li>
  );
}

function SearchResults({
  query,
  view,
  onAdd,
  onTick,
  onOpen,
  filter,
  lists,
  dest,
  onSwitch,
}: {
  query: string;
  view: ReturnType<typeof shoppingView>;
  onAdd: (raw: string) => void;
  onTick: (i: Item) => void;
  onOpen: (i: Item) => void;
  filter: string;
  lists: List[];
  dest: List | undefined;
  onSwitch: (listId: string) => void;
}) {
  const hub = useHub();
  const { name } = parseQuantity(query);
  const q = fold(name);
  const key = itemKey(name);
  const ids = new Set(view.lists.map((l) => l.id));
  const all = hub.store.all('item').filter((i) => ids.has(i.listId) && !i.parentId);
  const onList = all.filter((i) => !i.done && !i.archived && fold(i.title).includes(q));
  const exact = onList.find((i) => itemKey(i.title) === key);
  const history = historyMatches(view.stats, name, 4).filter((h) => !onList.some((i) => itemKey(i.title) === h.key));
  const flavor = filter === 'all' ? undefined : hub.flavorOf(hub.list(filter));
  const catalog = suggestFromCatalog(name, flavor, 5).filter(
    (c) => !onList.some((i) => itemKey(i.title) === itemKey(c.label)) && !history.some((h) => h.key === itemKey(c.label)),
  );
  const other = filter === 'all' ? lists.find((l) => l.id !== dest?.id) : undefined;

  return (
    <div className="results">
      {onList.length ? (
        <>
          <h2 className="aisle__head">On the list</h2>
          <ul className="rows">
            {onList.slice(0, 8).map((i) => (
              <ShopRow key={i.id} item={i} onTick={onTick} onOpen={onOpen} showList={filter === 'all'} />
            ))}
          </ul>
        </>
      ) : null}
      <div className="suggest">
        {!exact ? (
          <div className="suggest__item is-active suggest__item--add">
            <button type="button" className="suggest__main" onClick={() => onAdd(query)}>
              <span className="suggest__icon">
                <Icon name="plus" className="icon--sm" />
              </span>
              <span className="suggest__text" dir="auto">
                Add “{query}”
                <span className="suggest__sub">
                  to {dest?.name}
                </span>
              </span>
            </button>
            {other ? (
              <button type="button" className="suggest__tag suggest__switch" onClick={() => onSwitch(other.id)} aria-label={`Add to ${other.name} instead`}>
                <Icon name="swap" className="icon--xs" />
                <span dir="auto">{other.name}</span>
              </button>
            ) : null}
          </div>
        ) : null}
        {history.map((h) => (
          <button key={h.key} type="button" className="suggest__item" onClick={() => onAdd(h.name)}>
            <span className="suggest__icon">
              <Icon name="undo" className="icon--sm" />
            </span>
            <span className="suggest__text" dir="auto">
              {h.name}
              <span className="suggest__sub">{cadenceLabel(h.avgDays) || `bought ${h.count}×`}</span>
            </span>
            <span className="suggest__tag">Again</span>
          </button>
        ))}
        {catalog.map((c) => (
          <button key={c.label} type="button" className="suggest__item" onClick={() => onAdd(c.label)}>
            <span className="suggest__icon">
              <Icon name="plus" className="icon--sm" />
            </span>
            <span className="suggest__text" dir="auto">
              {c.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

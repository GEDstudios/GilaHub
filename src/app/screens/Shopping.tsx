import { useEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react';
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
import { Avatar, Band, Check, Empty, IconButton, ListBullet, NewButton, Section, Seg } from '../ui/primitives';
import { UrgentTag, VisTag } from '../ui/tags';
import { useFresh } from '../ui/fresh';
import { visTagFor } from '../privacy';
import { back } from '../router';
import { useAddAction } from '../addAction';
import { createFromTemplate, PROJECT_TEMPLATES } from '../../core/actions';
import { ProjectHero, ProjectMenuButton } from './ListScreen';
import { NewProjectSheet } from './Lists';
import { SyncBadge } from './Today';
import { shoppingView } from '../views';

type Row = Item & { emoji: string };

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
  /** In "Both", the user can redirect the next add to the other list. */
  const [override, setOverride] = useState<string | null>(null);
  const partnerShopping = usePartnerShopping();
  const partner = hub.partner();
  const addRef = useRef<AddRowHandle>(null);
  const shopAdd = useShopAdd();
  const seen = useRef<Set<string> | null>(null);

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

  // Live: highlight what the partner adds while we look at the list.
  const openIds = useMemo(() => new Set([...v.urgent, ...v.groups.flatMap((g) => g.items)].map((i) => i.id)), [v]);
  useEffect(() => {
    const prev = seen.current;
    seen.current = openIds;
    if (!prev) return;
    const fresh = [...openIds].filter((id) => !prev.has(id) && hub.item(id)?.createdBy !== hub.meId);
    if (!fresh.length) return;
    setFlash(new Set(fresh));
    const who = hub.member(hub.item(fresh[0])?.createdBy);
    if (who && mode) toast(`${who.name} added ${hub.item(fresh[0])?.title}${fresh.length > 1 ? ` +${fresh.length - 1}` : ''}`);
    const t = setTimeout(() => setFlash(new Set()), 2200);
    return () => clearTimeout(t);
  }, [openIds, hub, mode, toast]);

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
    const undo = hub.toggle(i.id);
    if (!i.done) toast(`${i.title} is in the cart`, { action: { label: 'Undo', run: undo }, ms: 2600 });
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
          <ProjectHero list={scoped} sub={mode ? `Shopping now · ${sub}` : sub} />
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
                  ...v.groups.map((g) => ({ key: g.key, label: g.label, items: g.items, icon: g.flavor === 'grocery' ? AISLE_ICON[g.category] : undefined, emoji: g.emoji })),
                ]}
                onTick={tick}
                onOpen={openItem}
                flash={flash}
                showList={many}
                draggable={!mode}
              />
            ) : null}

            {v.inCart.length ? (
              <Section
                title={
                  <>
                    <Icon name="cart" className="icon--sm" /> In the cart
                  </>
                }
                count={v.inCart.length}
                action={
                  <button type="button" className="textbtn" onClick={() => setCartOpen(!cartOpen)}>
                    {cartOpen || mode ? 'Hide' : 'Show'}
                  </button>
                }
              >
                {cartOpen || mode ? (
                  <ul className="rows">
                    {v.inCart.map((i) => (
                      <ShopRow key={i.id} item={i} onTick={tick} onOpen={openItem} showList={many} />
                    ))}
                  </ul>
                ) : null}
                <button type="button" className="textbtn finish" onClick={finish}>
                  <Icon name="check" className="icon--sm" /> Finish trip
                </button>
              </Section>
            ) : null}
          </>
        )}
      </div>

      {!searching && (v.openCount > 0 || mode) ? (
        <div className="shopbar">
          {mode ? (
            <div className="shopbar__inner">
              <span className="shopbar__text num">
                {v.openCount} left · {v.inCart.length} in the cart
              </span>
              <button type="button" className="btn btn--sm" onClick={finish}>
                Finish
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

/** Grocery aisles drawn as icons in their card's header. */
const AISLE_ICON: Partial<Record<string, IconName>> = {
  produce: 'carrot',
  bakery: 'bread',
  dairy: 'cheese',
  meat: 'fish',
  deli: 'bowl',
  pantry: 'jar',
  snacks: 'cookie',
  frozen: 'snowflake',
  drinks: 'drink',
  household: 'spray',
  personal: 'soap',
  baby: 'baby',
  pets: 'paw',
  other: 'cart',
};

function SortableShopRow(props: Parameters<typeof ShopRow>[0]) {
  const s = useSortableItem(props.item.id);
  return <ShopRow {...props} liRef={s.ref} liStyle={s.style} liClass={s.className} dragProps={s.props} />;
}

/** A card per aisle (and the Urgent card on top). Hold a row to reorder it within its aisle. */
function ShopList({
  groups,
  onTick,
  onOpen,
  flash,
  showList,
  draggable,
}: {
  groups: ShopGroup[];
  onTick: (i: Item) => void;
  onOpen: (i: Item) => void;
  flash: Set<string>;
  showList: boolean;
  draggable: boolean;
}) {
  const hub = useHub();
  /** Order within one aisle; an item only moves among rows of its own list. */
  const onMove = (next: string[], id: string) => {
    const at = next.indexOf(id);
    const listId = hub.item(id)?.listId;
    const same = (x: string | undefined) => (x && hub.item(x)?.listId === listId ? x : null);
    hub.reorder(id, same(next[at - 1]), same(next[at + 1]));
  };
  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className="aisle" aria-label={g.label ?? 'Urgent'} data-sort-bounds>
          <h2 className="aisle__head">
            {g.label ? (
              <>
                {g.icon ? (
                  <Icon name={g.icon} />
                ) : g.emoji ? (
                  <span className="aisle__emoji" aria-hidden="true">
                    {g.emoji}
                  </span>
                ) : null}
                {g.label}
                <span className="num">{g.items.length}</span>
              </>
            ) : (
              <UrgentTag />
            )}
          </h2>
          <Sortable
            ids={g.items.map((i) => i.id)}
            onMove={onMove}
            bounds="refuse"
            disabled={!draggable}
            liftClass={g.label ? undefined : 'lift--urgent'}
            label={(id) => hub.item(id)?.title ?? ''}
            renderOverlay={(id) => {
              const item = g.items.find((i) => i.id === id);
              return item ? (
                <ul className={`rows ${g.label ? '' : 'rows--urgent'}`}>
                  <ShopRow item={item} onTick={onTick} onOpen={onOpen} showList={showList} inUrgent={!g.label} />
                </ul>
              ) : null;
            }}
          >
            <ul className={`rows ${g.label ? '' : 'rows--urgent'}`}>
              {g.items.map((i) =>
                draggable ? (
                  <SortableShopRow key={i.id} item={i} onTick={onTick} onOpen={onOpen} flash={flash.has(i.id)} showList={showList} inUrgent={!g.label} />
                ) : (
                  <ShopRow key={i.id} item={i} onTick={onTick} onOpen={onOpen} flash={flash.has(i.id)} showList={showList} inUrgent={!g.label} />
                ),
              )}
            </ul>
          </Sortable>
        </section>
      ))}
    </>
  );
}

function ShopRow({
  item,
  onTick,
  onOpen,
  flash,
  showList,
  inUrgent,
  liRef,
  liStyle,
  liClass,
  dragProps,
}: {
  item: Row;
  onTick: (i: Item) => void;
  onOpen: (i: Item) => void;
  flash?: boolean;
  showList?: boolean;
  /** Rendered inside the Urgent card (so no extra tag needed). */
  inUrgent?: boolean;
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
      className={`row row--tap ${item.done ? 'is-done' : ''} ${mine ? 'row--fresh row--flash' : flash ? 'row--flash' : ''} ${liClass ?? ''}`}
      onClick={() => onOpen(item)}
    >
      <Check on={item.done} color={list?.color} onToggle={() => onTick(item)} label={item.title} />
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
              <ShopRow key={i.id} item={{ ...i, emoji: hub.categoryFor(i).emoji }} onTick={onTick} onOpen={onOpen} showList={filter === 'all'} />
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
              <button type="button" className="suggest__tag suggest__switch" onClick={() => onSwitch(other.id)} title={`Add to ${other.name} instead`}>
                ⇄ {other.name}
              </button>
            ) : (
              null
            )}
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

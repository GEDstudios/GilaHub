import { useEffect, useMemo, useRef, useState } from 'react';
import type { Item, List } from '../../core/model';
import { categorize, suggestFromCatalog } from '../../smart/categorize';
import { fold, itemKey, parseQuantity, splitPasted } from '../../smart/normalize';
import { parseQuickAdd } from '../../smart/parse';
import { cadenceLabel, historyMatches } from '../../smart/suggest';
import { useParseContext } from '../components/QuickAdd';
import { ShopItemSheet } from '../components/ShopItemSheet';
import { useHub, usePartnerShopping, useRt } from '../context';
import { setPrefs, usePrefs } from '../prefs';
import { notifyMembers } from '../runtime';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Band, Check, Diamond, Empty, ListBullet, PersonBullet, Seg } from '../ui/primitives';
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

export function Shopping() {
  const hub = useHub();
  const rt = useRt();
  const prefs = usePrefs();
  const { openSheet, toast } = useOverlays();
  const lists = hub.shoppingLists();
  const filter = lists.some((l) => l.id === prefs.shopFilter) ? prefs.shopFilter : 'all';
  const v = shoppingView(hub, filter, prefs.dismissed);
  const [mode, setMode] = useState(false);
  const [query, setQuery] = useState('');
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [cartOpen, setCartOpen] = useState(false);
  /** In "Both", the user can redirect the next add to the other list. */
  const [override, setOverride] = useState<string | null>(null);
  const partnerShopping = usePartnerShopping();
  const partner = hub.partner();
  const parseCtx = useParseContext(lists[0]);
  const input = useRef<HTMLInputElement>(null);
  const seen = useRef<Set<string> | null>(null);

  useWakeLock(mode);

  // Presence: tell the other phone we're in the store (and, once in a while, push them).
  useEffect(() => {
    if (!mode) return;
    rt.sync?.setPresence('shopping');
    const last = Number(localStorage.getItem('gila-hub:shopNotified') ?? 0);
    if (partner && partner.shopAlerts !== false && Date.now() - last > 30 * 60_000) {
      localStorage.setItem('gila-hub:shopNotified', String(Date.now()));
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

  const add = (raw: string, opts: { quiet?: boolean } = {}) => {
    const p = parseQuickAdd(raw, { ...parseCtx, mode: 'shopping' });
    if (!p.title.trim()) return;
    const dest = destFor(p.title, p.listId);
    if (!dest) return;
    const res = hub.addShopping(dest.id, p.title, { qty: p.qty ?? null, urgent: p.urgent });
    setFlash(new Set([res.id]));
    setTimeout(() => setFlash(new Set()), 2000);
    if (opts.quiet) return res;
    const item = hub.item(res.id);
    if (res.kind === 'exists') {
      toast(`${item?.title} is already on the list`, { action: { label: '+1', run: () => hub.bump(res.id) } });
    } else if (res.kind === 'revived') {
      toast(`Brought back ${item?.title}`);
    }
    if (p.urgent && partnerShopping && item) {
      void notifyMembers(rt, [partnerShopping.member], {
        title: `${hub.me()?.name ?? 'Your partner'} added ${item.title}`,
        body: 'Marked urgent — while you’re there 🙏',
        url: '/shop',
        tag: 'urgent',
      });
    }
    return res;
  };

  const submit = (raw = query) => {
    if (!raw.trim()) return;
    add(raw);
    setQuery('');
    setOverride(null);
    input.current?.focus();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const lines = splitPasted(e.clipboardData.getData('text'));
    if (lines.length < 2) return;
    e.preventDefault();
    hub.store.batch(() => {
      for (const l of lines) add(l, { quiet: true });
    });
    toast(`Added ${lines.length} items, sorted into aisles`);
  };

  const tick = (i: Item) => {
    const undo = hub.toggle(i.id);
    if (!i.done) toast(`${i.title} — in the cart`, { action: { label: 'Undo', run: undo }, ms: 2600 });
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
  const searching = q.length > 0;

  return (
    <div className={mode ? 'shopmode' : undefined}>
      <Band
        title={mode ? 'Shopping now' : 'Shopping'}
        sub={v.openCount ? `${v.openCount} to buy${v.inCart.length ? ` · ${v.inCart.length} in the cart` : ''}` : 'Nothing to buy'}
        actions={
          mode ? (
            <button type="button" className="btn btn--sm btn--onband" onClick={() => setMode(false)}>
              Pause
            </button>
          ) : null
        }
      />
      <div className="column">
        {lists.length > 1 ? (
          <div style={{ margin: '16px var(--gutter) 0' }}>
            <Seg label="Which list" value={filter} onChange={(val) => setPrefs({ shopFilter: val })} options={filterOptions} />
          </div>
        ) : null}

        <form
          className="addbar"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Icon name="search" className="icon--sm" style={{ color: 'var(--ink-3)' }} />
          <input
            ref={input}
            value={query}
            dir="auto"
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value) setOverride(null);
            }}
            onPaste={onPaste}
            placeholder={filter === 'all' ? 'Add or find… (milk, נורות, 2 eggs)' : `Add to ${hub.list(filter)?.name}…`}
            aria-label="Add or find an item"
            enterKeyHint="done"
            autoComplete="off"
          />
          {query ? (
            <button type="button" className="iconbtn" onClick={() => setQuery('')} aria-label="Clear">
              <Icon name="x" className="icon--sm" />
            </button>
          ) : null}
          <button type="submit" className="addbar__go" disabled={!q} aria-label="Add">
            <Icon name="plus" className="icon--sm" />
          </button>
        </form>

        {partnerShopping && !mode && hub.member(partnerShopping.member) ? (
          <div className="banner" style={{ ['--c' as string]: `var(--${hub.member(partnerShopping.member)!.color})` }}>
            <span className="live" />
            <span className="banner__text">
              {hub.member(partnerShopping.member)!.name} is in the store
              <span className="banner__sub">Anything you add shows up on their phone right away.</span>
            </span>
          </div>
        ) : null}

        {searching ? (
          <SearchResults
            query={q}
            view={v}
            onAdd={submit}
            onTick={tick}
            onOpen={openItem}
            filter={filter}
            lists={lists}
            dest={destFor(parseQuantity(q).name)}
            onSwitch={(id) => setOverride(id)}
          />
        ) : (
          <>
            {!mode && v.buyAgain.length ? (
              <div className="buyagain">
                <div className="buyagain__label">Buy again</div>
                <div className="chips chips--scroll">
                  {v.buyAgain.map((s) => (
                    <span key={s.key} className="chip chip--outline buyagain__chip" title={cadenceLabel(s.avgDays)}>
                      <button type="button" onClick={() => add(s.name)} className="buyagain__add">
                        <span>{categorize(s.name, hub.flavorOf(hub.list(s.listId))).emoji}</span>
                        <span dir="auto">{s.name}</span>
                        <Icon name="plus" className="icon--sm" />
                      </button>
                      <button
                        type="button"
                        className="buyagain__x"
                        aria-label={`Not now: ${s.name}`}
                        onClick={() => setPrefs({ dismissed: { ...prefs.dismissed, [s.key]: s.lastAt } })}
                      >
                        <Icon name="x" className="icon--sm" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {!v.openCount && !v.inCart.length ? (
              <Empty
                mark={<span style={{ fontSize: 56 }}>🧺</span>}
                title="The list is empty. Nice."
                text="Type above to add. Paste a list from WhatsApp and it sorts itself into aisles."
              />
            ) : null}

            {v.urgent.length ? (
              <section aria-label="Urgent">
                <div className="aisle aisle--urgent">
                  <span className="aisle__label">
                    <Diamond /> Urgent
                  </span>
                  <span className="aisle__count num">{v.urgent.length}</span>
                </div>
                <ul className="rows">
                  {v.urgent.map((i) => (
                    <ShopRow key={i.id} item={i} onTick={tick} onOpen={openItem} flash={flash.has(i.id)} showList={filter === 'all'} />
                  ))}
                </ul>
              </section>
            ) : null}

            {v.groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <div className="aisle">
                  <span className="aisle__label">
                    <span aria-hidden="true">{g.emoji}</span>
                    {g.label}
                  </span>
                  <span className="aisle__count num">{g.items.length}</span>
                </div>
                <ul className="rows">
                  {g.items.map((i) => (
                    <ShopRow key={i.id} item={i} onTick={tick} onOpen={openItem} flash={flash.has(i.id)} showList={filter === 'all'} />
                  ))}
                </ul>
              </section>
            ))}

            {v.inCart.length ? (
              <section aria-label="In the cart" style={{ marginTop: 26 }}>
                <div className="section__head">
                  <h2 className="section__title">
                    <Icon name="cart" className="icon--sm" /> In the cart <span className="section__count num">{v.inCart.length}</span>
                  </h2>
                  <button type="button" className="section__action" onClick={() => setCartOpen(!cartOpen)}>
                    {cartOpen || mode ? 'Hide' : 'Show'}
                  </button>
                </div>
                {cartOpen || mode ? (
                  <ul className="rows">
                    {v.inCart.map((i) => (
                      <ShopRow key={i.id} item={i} onTick={tick} onOpen={openItem} showList={filter === 'all'} />
                    ))}
                  </ul>
                ) : null}
                <div style={{ margin: '12px var(--gutter) 0' }}>
                  <button type="button" className="btn btn--ghost btn--block" onClick={finish}>
                    <Icon name="check" className="icon--sm" /> Finish trip
                  </button>
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>

      {!searching && (v.openCount > 0 || mode) ? (
        <div className="shopbar">
          {mode ? (
            <>
              <span className="shopbar__text num">
                {v.openCount} left · {v.inCart.length} in the cart
              </span>
              <button type="button" className="btn btn--me" onClick={finish}>
                Finish
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--me btn--block" onClick={() => setMode(true)}>
              <Icon name="cart" className="icon--sm" /> Start shopping
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ShopRow({
  item,
  onTick,
  onOpen,
  flash,
  showList,
}: {
  item: Row;
  onTick: (i: Item) => void;
  onOpen: (i: Item) => void;
  flash?: boolean;
  showList?: boolean;
}) {
  const hub = useHub();
  const prefs = usePrefs();
  const list = hub.list(item.listId);
  const owner = hub.member(hub.ownerOf(item));
  const vis = hub.visibilityOf(item);
  return (
    <li className={`row row--tap ${item.done ? 'is-done' : ''} ${flash ? 'row--flash' : ''}`} onClick={() => onOpen(item)}>
      <Check on={item.done} color={list?.color} onToggle={() => onTick(item)} label={item.title} />
      {prefs.emoji ? <span className="row__emoji" aria-hidden="true">{item.emoji || '·'}</span> : null}
      <div className="row__body">
        <span className="row__title" dir="auto">
          {item.title}
          {item.qty ? <span className="qty num"> {/^\d+$/.test(item.qty) ? `×${item.qty}` : item.qty}</span> : null}
        </span>
        {item.notes || vis !== 'ours' ? (
          <span className="row__meta">
            {owner && vis === 'mine' ? <span className="meta">for {owner.id === hub.meId ? 'me' : owner.name}</span> : null}
            {vis === 'private' ? (
              <span className="meta">
                <Icon name="lock" /> only me
              </span>
            ) : null}
            {item.notes ? (
              <span className="meta" dir="auto">
                {item.notes.slice(0, 60)}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <span className="row__trail">
        {owner && vis === 'mine' ? <PersonBullet member={owner} size="sm" /> : null}
        {showList ? <ListBullet list={list} size="xs" /> : null}
      </span>
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
  const destEmoji = categorize(name, hub.flavorOf(dest)).emoji;
  const other = filter === 'all' ? lists.find((l) => l.id !== dest?.id) : undefined;

  return (
    <div className="results">
      {onList.length ? (
        <>
          <div className="aisle aisle--quiet" style={{ margin: '18px var(--gutter) 0', padding: '8px 0 0', height: 'auto' }}>
            <span className="aisle__label" style={{ paddingTop: 0 }}>
              On the list
            </span>
          </div>
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
              <span className="suggest__emoji">{destEmoji || '＋'}</span>
              <span className="suggest__text" dir="auto">
                Add “{query}”
                <span className="suggest__sub">
                  to <ListBullet list={dest} size="xs" /> {dest?.name}
                </span>
              </span>
            </button>
            {other ? (
              <button type="button" className="suggest__tag suggest__switch" onClick={() => onSwitch(other.id)} title={`Add to ${other.name} instead`}>
                ⇄ {other.name}
              </button>
            ) : (
              <Icon name="plus" />
            )}
          </div>
        ) : null}
        {history.map((h) => (
          <button key={h.key} type="button" className="suggest__item" onClick={() => onAdd(h.name)}>
            <span className="suggest__emoji">{categorize(h.name, hub.flavorOf(hub.list(h.listId))).emoji || '↺'}</span>
            <span className="suggest__text" dir="auto">
              {h.name}
              <span className="suggest__sub">{cadenceLabel(h.avgDays) || `bought ${h.count}×`}</span>
            </span>
            <span className="suggest__tag">Again</span>
          </button>
        ))}
        {catalog.map((c) => (
          <button key={c.label} type="button" className="suggest__item" onClick={() => onAdd(c.label)}>
            <span className="suggest__emoji">{c.emoji}</span>
            <span className="suggest__text" dir="auto">
              {c.label}
            </span>
            <Icon name="plus" className="icon--sm" />
          </button>
        ))}
      </div>
    </div>
  );
}

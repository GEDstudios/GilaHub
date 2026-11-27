import { useWide } from '../ui/useWide';
import { useEffect, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { fromDateStr, today as todayStr } from '../../core/dates';
import type { Item } from '../../core/model';
import { useAddAction } from '../addAction';
import { SavedListWidget } from '../components/SavedList';
import { HomeNotices, InviteCard, ProjectWidget, QuickView } from '../components/HomeWidgets';
import { DayCard, TodayList, UsTile, WeekStrip } from '../components/Home';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { SyncBadge } from '../components/SyncBadge';
import { TodayArrange } from '../components/TodayArrange';
import { useHub } from '../context';
import { visibleHome, queryIdOf } from '../home';
import { openSearch } from '../search';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Band, IconButton, lightVar, TextButton } from '../ui/primitives';
import { haptic } from '../ui/haptics';
import { setPrefs, usePrefs } from '../prefs';
import { isMineSide, VIS_ICON } from '../privacy';
import { SettleContext, useSettle } from '../ui/useSettle';
import { todayView, type TodayView } from '../views';
import { calm } from '../ui/tokens';
import { listIdOf } from '../../core/keys';
import { G } from '../ui/glyphs';
import { DoneButton } from '../ui/edit';
import { useEscape } from '../ui/keyboard';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Morning';
  if (h < 18) return 'Hey';
  return 'Evening';
}

/** On a computer, the looking (the week, us) sits beside the doing. */
const SIDE = new Set(['upcoming', 'week']);

/** Today with a filter on: only what passes, everywhere on the page (the counts follow). */
function filterToday(v: TodayView, keep: (i: Item) => boolean): TodayView {
  return {
    ...v,
    today: v.today.filter(keep),
    earlier: v.earlier.filter(keep),
    upcoming: v.upcoming.map((g) => ({ ...g, items: g.items.filter(keep) })).filter((g) => g.items.length),
    asked: v.asked.filter(keep),
    outgoing: v.outgoing.filter(keep),
    awaitingOk: v.awaitingOk.filter(keep),
    waitingTheirOk: v.waitingTheirOk.filter(keep),
    recent: v.recent.filter((r) => keep(r.item)),
  };
}

/** Cross-fade between the page and its editor, where the browser can. */
function swap(fn: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || calm()) return fn();
  doc.startViewTransition(() => flushSync(fn));
}

/** Widgets fade up the first time Today draws in a session. */
let greeted = false;

export function Today() {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const ref = todayStr();
  const prefs = usePrefs();
  const partner = hub.partner();
  const me = hub.me();
  // The one way to narrow Today, a tag beside search: Ours (everything) ↔ Mine (just my own: Mine and Private).
  const mineOnly = !!partner && prefs.todayScope === 'mine';
  const all = todayView(hub, ref);
  const v = mineOnly ? filterToday(all, (i) => isMineSide(hub, i)) : all;
  const scopeTag = partner ? (
    <button
      type="button"
      className={`scopetag ${mineOnly ? 'is-mine' : ''}`}
      style={{ '--me': lightVar(me?.color ?? 'lemon'), '--them': lightVar(partner.color) } as CSSProperties}
      aria-pressed={mineOnly}
      aria-label={mineOnly ? 'Showing only mine. Show ours too' : 'Showing everything. Show only mine'}
      onClick={() => {
        haptic('select');
        setPrefs({ todayScope: mineOnly ? 'all' : 'mine' });
      }}
    >
      <Icon name={VIS_ICON[mineOnly ? 'mine' : 'ours']} className="icon--sm" />
      {mineOnly ? 'Mine' : 'Ours'}
    </button>
  ) : null;

  // Ticked rows stay a moment (check, strike, fold) before they leave their block.
  const settle = useSettle<Item>();
  const [editing, setEditing] = useState(false);
  const [entering, setEntering] = useState(() => !greeted);

  useEffect(() => {
    greeted = true;
    if (!entering) return;
    const t = setTimeout(() => setEntering(false), 900);
    return () => clearTimeout(t);
  }, [entering]);

  // New from Today has no date of its own: the words (or the chip) give it one.
  const openNew = () => openSheet((close) => <QuickAddSheet onClose={close} />);
  useAddAction(openNew);

  const edit = (on: boolean) =>
    swap(() => {
      setEditing(on);
      window.scrollTo({ top: 0 });
    });

  useEscape(editing, () => edit(false));

  const date = fromDateStr(ref).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const wide = useWide();
  const slots = visibleHome(hub);

  const block = (key: string) => {
    const savedId = queryIdOf(key);
    if (savedId) return <SavedListWidget key={key} id={savedId} settle={settle} />;
    const listId = listIdOf(key);
    if (listId) return <ProjectWidget key={key} listId={listId} settle={settle} />;
    switch (key) {
      case 'today':
        // What my person asked waits in Us's cards; with Us hidden, folded under the list.
        return <TodayList key={key} v={v} day={ref} settle={settle} asksHere={!slots.some((x) => x.key === 'week')} />;
      case 'quick':
        return <QuickView key={key} settle={settle} />;
      case 'upcoming':
        return <WeekStrip key={key} v={v} day={ref} />;
      case 'week':
        return <UsTile key={key} v={v} settle={settle} />;
      default:
        return null;
    }
  };

  const editLink = (
    <div className="homeedit">
      <TextButton onClick={() => edit(true)}>
        <Icon name={G.edit} />
        Edit Today
      </TextButton>
    </div>
  );

  if (editing) {
    return (
      <>
        <Band
          top={<SyncBadge />}
          actions={<DoneButton onClick={() => edit(false)} />}
          title="Edit Today"
          mini="Edit Today"
        />
        <div className="column home home--editing">
          <DayCard v={v} day={ref} />
          <TodayArrange peek={block} />
        </div>
      </>
    );
  }

  return (
    <SettleContext.Provider value={settle}>
      <Band
        top={<SyncBadge />}
        actions={
          <>
            {scopeTag}
            <IconButton icon={G.search} label="Search" onClick={() => openSearch()} />
          </>
        }
        title={`${greeting()}, ${me?.name ?? 'you'}!`}
        sub={date}
        mini={date}
      />
      {wide ? (
        // A computer: the doing on the left (add, asks, today, the next days, pinned projects),
        // and beside it, staying in sight, the day at a glance and the week, us.
        <div className={`column home home--wide ${entering ? 'is-entering' : ''}`}>
          <div className="home__cols">
            <div className="home__main">
              <DayCard v={v} day={ref} />
              <HomeNotices />
              {slots.filter((s) => !SIDE.has(s.key)).map((s) => block(s.key))}
              {slots.length ? null : <p className="hint homehint">Your Today is clear. Bring things back any time.</p>}
              {editLink}
            </div>
            <aside className="home__side" aria-label="The week, and us">
              {slots.filter((s) => SIDE.has(s.key)).map((s) => block(s.key))}
              <InviteCard />
            </aside>
          </div>
        </div>
      ) : (
        <div className={`column home ${entering ? 'is-entering' : ''}`}>
          <DayCard v={v} day={ref} />
          <HomeNotices />
          {slots.map((s) => block(s.key))}
          <InviteCard />
          {slots.length ? null : <p className="hint homehint">Your Today is clear. Bring things back any time.</p>}
          {editLink}
        </div>
      )}
    </SettleContext.Provider>
  );
}

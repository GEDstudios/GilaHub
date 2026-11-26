import { useWide } from '../ui/useWide';
import { useEffect, useState } from 'react';
import { Lens, useFilter } from '../components/Filter';
import { flushSync } from 'react-dom';
import { fromDateStr, today as todayStr } from '../../core/dates';
import type { Item } from '../../core/model';
import { useAddAction } from '../addAction';
import { AsksWidget } from '../components/Asks';
import { ComingUp, HomeNotices, InviteCard, PartnerDid, ProjectWidget, SummaryCard, WeekStrips } from '../components/HomeWidgets';
import { TodayBlock } from '../components/Home';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { SyncBadge } from '../components/SyncBadge';
import { TodayArrange } from '../components/TodayArrange';
import { useHub } from '../context';
import { listIdOf, visibleHome } from '../home';
import { openSearch } from '../search';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Band, IconButton, NewButton } from '../ui/primitives';
import { SettleContext, useSettle } from '../ui/useSettle';
import { todayView, type TodayView } from '../views';

const idOf = (i: Item) => i.id;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Morning';
  if (h < 18) return 'Hey';
  return 'Evening';
}

/** On a computer the week (and us) is a glance, in the side column beside the day. */
const SIDE = new Set(['week']);

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
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return fn();
  doc.startViewTransition(() => flushSync(fn));
}

/** Widgets fade up the first time Today draws in a session. */
let greeted = false;

export function Today() {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const ref = todayStr();
  const filter = useFilter('today');
  const all = todayView(hub, ref);
  const v = filter.active ? filterToday(all, (i) => filter.test(i)) : all;
  // The lens looks over everything on the page, once each.
  const onPage = [...new Map([...all.today, ...all.earlier, ...all.upcoming.flatMap((g) => g.items), ...all.asked, ...all.outgoing, ...all.awaitingOk, ...all.waitingTheirOk].map((i) => [i.id, i])).values()];
  const lens = <Lens filter={filter} items={onPage} />;
  const me = hub.me();
  // Ticked rows stay a moment (check, strike, fold) before they leave their block.
  const settle = useSettle(idOf);
  const [editing, setEditing] = useState(false);
  const [entering, setEntering] = useState(() => !greeted);

  useEffect(() => {
    greeted = true;
    if (!entering) return;
    const t = setTimeout(() => setEntering(false), 900);
    return () => clearTimeout(t);
  }, [entering]);

  const openNew = () => openSheet((close) => <QuickAddSheet onClose={close} defaultDue={ref} />);
  useAddAction(openNew);

  const edit = (on: boolean) =>
    swap(() => {
      setEditing(on);
      window.scrollTo({ top: 0 });
    });

  // Esc leaves Edit Today (not while a row is being dragged: there Esc cancels the drag).
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.documentElement.classList.contains('is-dragging')) return;
      if (document.querySelector('.sheet')) return;
      edit(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const date = fromDateStr(ref).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const wide = useWide();
  const slots = visibleHome(hub);
  const shown = new Set(slots.map((x) => x.key));

  const block = (key: string) => {
    const listId = listIdOf(key);
    if (listId) return <ProjectWidget key={key} listId={listId} day={ref} settle={settle} show={filter.active ? (i) => filter.test(i, true) : undefined} />;
    switch (key) {
      case 'asks':
        return <AsksWidget key={key} v={v} settle={settle} />;
      case 'today':
        return <TodayBlock key={key} v={v} day={ref} settle={settle} />;
      case 'week':
        // The week, and what my person did in it: one place for us.
        return (
          <div key={key} className="homeweek">
            <WeekStrips v={v} shown={shown} />
            <PartnerDid v={v} />
          </div>
        );
      case 'upcoming':
        return <ComingUp key={key} v={v} day={ref} />;
      default:
        return null;
    }
  };

  const editLink = (
    <div className="homeedit">
      <button type="button" className="textbtn" onClick={() => edit(true)}>
        <Icon name="edit" />
        Edit Today
      </button>
    </div>
  );

  if (editing) {
    return (
      <>
        <Band
          top={<SyncBadge />}
          actions={
            <button type="button" className="btn btn--sm" onClick={() => edit(false)}>
              Done
            </button>
          }
          title="Edit Today"
          mini="Edit Today"
        />
        <div className="column home home--editing">
          <SummaryCard v={v} day={ref} asksShown={false} />
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
            <IconButton icon="search" label="Search" onClick={() => openSearch()} />
            <NewButton onClick={openNew} />
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
              <HomeNotices />
              {lens}
              {/* A computer's way in: an "add" line at the head of the day (N works from anywhere) */}
              <button type="button" className="quickbar" onClick={openNew} aria-keyshortcuts="N">
                <span className="quickbar__plus">
                  <Icon name="plus" className="icon--sm" />
                </span>
                <span className="quickbar__text">Add a task, or ask {hub.partner()?.name ?? 'your person'}…</span>
                <span className="kbd">N</span>
              </button>
              {slots.filter((s) => !SIDE.has(s.key)).map((s) => block(s.key))}
              {slots.length ? null : <p className="hint homehint">Your Today is clear. Bring things back any time.</p>}
              {editLink}
            </div>
            <aside className="home__side" aria-label="Your day and your week">
              <SummaryCard v={v} day={ref} asksShown={shown.has('asks')} />
              {slots.filter((s) => SIDE.has(s.key)).map((s) => block(s.key))}
              <InviteCard />
            </aside>
          </div>
        </div>
      ) : (
        <div className={`column home ${entering ? 'is-entering' : ''}`}>
          <SummaryCard v={v} day={ref} asksShown={shown.has('asks')} />
          <HomeNotices />
          {lens}
          {slots.map((s) => block(s.key))}
          <InviteCard />
          {slots.length ? null : <p className="hint homehint">Your Today is clear. Bring things back any time.</p>}
          {editLink}
        </div>
      )}
    </SettleContext.Provider>
  );
}

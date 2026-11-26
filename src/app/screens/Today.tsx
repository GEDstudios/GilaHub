import { useWide } from '../ui/useWide';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Hub } from '../../core/actions';
import { fromDateStr, today as todayStr } from '../../core/dates';
import type { Item } from '../../core/model';
import { useAddAction } from '../addAction';
import { AsksWidget } from '../components/Asks';
import {
  ComingUp,
  HomeNotices,
  InviteCard,
  PartnerDid,
  ProjectWidget,
  SummaryCard,
  ToBuyWidget,
  TodayWidget,
  WeekStrips,
} from '../components/HomeWidgets';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { SyncBadge } from '../components/SyncBadge';
import { TodayArrange } from '../components/TodayArrange';
import { useHub } from '../context';
import { aheadOf, listIdOf, visibleHome, weekBands } from '../home';
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

/** Does this block draw anything right now? (Today always does: its add row.) */
function hasContent(key: string, hub: Hub, v: TodayView, shown: ReadonlySet<string>): boolean {
  switch (key) {
    case 'asks':
      return !!hub.partner() && v.awaitingOk.length + v.asked.length + v.outgoing.length + v.waitingTheirOk.length > 0;
    case 'week':
      return weekBands(hub, v, shown).length > 0;
    case 'upcoming':
      return aheadOf(v).length > 0;
    case 'partner':
      return !!hub.partner() && v.recent.length > 0;
    case 'shop':
      return v.shopping.count > 0;
    default:
      return true;
  }
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
  const v = todayView(hub, ref);
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
  const shown = new Set(slots.map((s) => s.key));
  const first = slots.find((s) => hasContent(s.key, hub, v, shown))?.key;

  const block = (key: string) => {
    const listId = listIdOf(key);
    if (listId) return <ProjectWidget key={key} listId={listId} day={ref} settle={settle} />;
    switch (key) {
      case 'asks':
        return <AsksWidget key={key} v={v} settle={settle} />;
      case 'today':
        return <TodayWidget key={key} v={v} day={ref} settle={settle} bare={first === 'today' && !wide} />;
      case 'week':
        return <WeekStrips key={key} v={v} shown={shown} />;
      case 'upcoming':
        return <ComingUp key={key} v={v} day={ref} />;
      case 'partner':
        return <PartnerDid key={key} v={v} />;
      case 'shop':
        return <ToBuyWidget key={key} v={v} settle={settle} />;
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
        // A computer: the day's line across the top, then every block as a panel on a board,
        // flowing into columns in the order they're arranged.
        <div className={`column home home--wide ${entering ? 'is-entering' : ''}`}>
          <div className="home__lead">
            <SummaryCard v={v} day={ref} asksShown={shown.has('asks')} />
            <HomeNotices />
          </div>
          <div className="home__board">
            {slots.map((s) => block(s.key))}
            <InviteCard />
          </div>
          {slots.length ? null : <p className="hint homehint">Your Today is clear. Bring things back any time.</p>}
          {editLink}
        </div>
      ) : (
        <div className={`column home ${entering ? 'is-entering' : ''}`}>
          <SummaryCard v={v} day={ref} asksShown={shown.has('asks')} />
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

import { NotesElsewhere } from './Notes';
import { useState } from 'react';
import { addDays, humanTime, relativeAgo } from '../../core/dates';
import type { Item, LineColor } from '../../core/model';
import { byOrder } from '../../core/order';
import { useHub, usePartnerHere } from '../context';
import { AHEAD_MAX, aheadDay, aheadOf, summaryOf, things, weekBands } from '../home';
import { setPrefs, use24h, usePrefs } from '../prefs';
import { navigate } from '../router';
import { quickItems } from '../quick';
import { useLater } from '../tick';
import { useFresh } from '../ui/fresh';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { ProjectMark } from '../ui/ProjectMark';
import { Avatar, lineVars, Section } from '../ui/primitives';
import { UrgentTag } from '../ui/tags';
import { SettleContext, useSettle, type Settle } from '../ui/useSettle';
import { todayView, type TodayView } from '../views';
import { AsksWidget } from './Asks';
import { ItemRow } from './ItemRow';
import { PairSheet } from './PairSheet';
import { MomentsSheet } from './Moments';
import { QuickAddSheet } from './QuickAddSheet';

/**
 * The blocks of the Today page (HOME §2–3). Today.tsx draws the summary and notices, then
 * these in my order (home.ts). A block with nothing to show draws nothing at all, header
 * included; Today and pinned projects keep their add row.
 */

const idOf = (i: Item) => i.id;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- summary and notices

/** Tasky's cursor, as on a name tag. */
function Cursor() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 3l15 7.5-6.5 1.8L10.5 19z" fill="currentColor" />
    </svg>
  );
}

/** The partner's asks in a sheet, when Waiting on you isn't on the page. */
export function AsksSheet({ onClose, day }: { onClose: () => void; day: string }) {
  const hub = useHub();
  const v = todayView(hub, day);
  const settle = useSettle(idOf);
  return (
    <Sheet onClose={onClose} title="Waiting on you">
      <SettleContext.Provider value={settle}>
        <AsksWidget v={v} settle={settle} bare />
      </SettleContext.Provider>
    </Sheet>
  );
}

/** Always first: how much today holds, the projects it's in, and who's waiting on me. */
export function SummaryCard({ v, day, asksShown }: { v: TodayView; day: string; asksShown: boolean }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const partner = hub.partner();
  const s = summaryOf(hub, v);
  const prefs = usePrefs();
  // What's next: the next thing with a time still ahead today, else the first thing left.
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const next = v.today.find((i) => i.dueTime && i.dueTime >= hm) ?? v.today[0] ?? v.earlier[0];
  const openAsks = () => {
    const el = asksShown ? document.getElementById('home-asks') : null;
    if (el) el.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
    else openSheet((close) => <AsksSheet onClose={close} day={day} />);
  };
  return (
    <div className="summary">
      <p className="summary__text">
        {s.mood === 'busy' ? (
          <>
            You have {things(s.n)}{' '}
            <br />
            to tackle today
          </>
        ) : (
          <>
            {s.mood === 'done' ? 'All done for today.' : 'Nothing due today.'}{' '}
            <br />
            Enjoy it.
          </>
        )}
      </p>
      {s.lists.length || s.person ? (
        <span className="tags">
          {s.lists.map((l) => (
            <button key={l.id} type="button" className="tag tag--link" style={lineVars(l.color)} onClick={() => navigate({ name: 'list', id: l.id })}>
              <span dir="auto">{l.name}</span>
            </button>
          ))}
          {s.person && partner ? (
            <button type="button" className="tag tag--link tag--person" style={lineVars(partner.color)} onClick={openAsks} aria-label={`Waiting on you, from ${partner.name}`}>
              <Cursor />
              <span dir="auto">{partner.name}</span>
            </button>
          ) : null}
        </span>
      ) : null}
      {next ? (
        <button type="button" className="summary__next" onClick={() => navigate({ name: 'item', id: next.id })}>
          <span className="summary__nextlabel">Next</span>
          <span className="summary__nexttitle" dir="auto">
            {next.title}
          </span>
          {next.dueTime && v.today.includes(next) ? <span className="summary__nexttime num">{humanTime(next.dueTime, use24h(prefs))}</span> : null}
          <Icon name="chevron-right" className="icon--sm" />
        </button>
      ) : null}
    </div>
  );
}

/** Live notices under the summary: the partner is in the store. */
export function HomeNotices() {
  const hub = useHub();
  const here = usePartnerHere();
  const shopper = here ? hub.member(here.member) : undefined;
  const on = here?.listId ? hub.list(here.listId) : undefined;
  return (
    <>
      <NotesElsewhere />
      {shopper && on ? (
        <button type="button" className="notice" onClick={() => navigate({ name: 'list', id: on.id })}>
          <Avatar member={shopper} size="sm" />
          <span className="notice__text">
            <strong>
              {shopper.name} is on {on.name} now.
            </strong>{' '}
            Need anything?
          </span>
          <Icon name="chevron-right" />
        </button>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- today

/**
 * Today's rows and "n from earlier" folded under them. With nothing due and nothing from
 * earlier it isn't drawn at all (the summary already says the day is clear; + adds).
 * With nothing above it, it drops its label.
 */
export function TodayWidget({ v, day, settle, bare }: { v: TodayView; day: string; settle: Settle<Item>; bare: boolean }) {
  const hub = useHub();
  const prefs = usePrefs();
  const later = useLater();
  const rows = settle.view('today', v.today);
  const earlier = settle.view('earlier', v.earlier);
  const head = !bare || rows.length > 0;
  const open = prefs.earlierOpen;
  if (!rows.length && !earlier.length) return null;

  return (
    <section className={`section ${head ? '' : 'section--bare'}`} id="today">
      {head ? (
        <div className="section__head">
          <h2 className="section__title">
            Today
            {v.today.length ? <span className="section__count num">{v.today.length}</span> : null}
          </h2>
        </div>
      ) : null}
      {rows.length ? (
        <ul className="rows">
          {rows.map(({ row: i, settling }) => (
            <ItemRow key={i.id} item={i} showList settling={settling} />
          ))}
        </ul>
      ) : null}
      {earlier.length ? (
        <>
          <button type="button" className="quietline" aria-expanded={open} onClick={() => setPrefs({ earlierOpen: !open })}>
            {v.earlier.length} from earlier
            <span className="quietline__end">
              {open ? 'Hide' : 'Show'}
              <Icon name="chevron-down" />
            </span>
          </button>
          {open ? (
            <ul className="rows quietline__rows">
              {earlier.map(({ row: i, settling }) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  showList
                  settling={settling}
                  below={
                    hub.canEdit(i) ? (
                      <span className="catchup row__acts" onClick={(e) => e.stopPropagation()}>
                        {/* Today needs no word: the row moves up into Today. */}
                        {!i.repeat ? (
                          <button type="button" className="mini" onClick={() => hub.snooze(i.id, day)}>
                            Today
                          </button>
                        ) : null}
                        <button type="button" className="mini" onClick={() => later.run(i)}>
                          {later.label(i)}
                        </button>
                      </span>
                    ) : null
                  }
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- this week

function Strip({ color, num, label, detail, onClick }: { color: LineColor; num: number | string; label: string; detail?: string; onClick?: () => void }) {
  return (
    <button type="button" className="strip" style={lineVars(color)} onClick={onClick} aria-label={`${num} ${label}${detail ? `. ${detail}` : ''}`} disabled={!onClick}>
      <span className="strip__num num">{num}</span>
      <span className="strip__text">
        <span className="strip__label" dir="auto">
          {label}
        </span>
        {detail ? (
          <span className="strip__detail" dir="auto">
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** The one colour moment: to buy, how the week went (vs the last), and Moments. */
export function WeekStrips({ v, shown }: { v: TodayView; shown: ReadonlySet<string> }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const bands = weekBands(hub, v, shown);
  if (!bands.length) return null;
  const go = {
    done: undefined,
    moments: () => openSheet((close) => <MomentsSheet onClose={close} />),
  };
  return (
    <Section title="This week">
      <div className="stack">
        {bands.map((b) => (
          <Strip key={b.key} color={b.color} num={b.num} label={b.label} detail={b.detail} onClick={go[b.key]} />
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- coming up

function AheadTile({ item, day }: { item: Item; day: string }) {
  const hub = useHub();
  const prefs = usePrefs();
  const list = hub.list(item.listId);
  const fresh = useFresh(item.id);
  const when = `${aheadDay(item.due!, day)}${item.dueTime ? ` · ${humanTime(item.dueTime, use24h(prefs))}` : ''}`;
  return (
    <button type="button" className={`ahead__tile ${fresh ? 'row--flash' : ''}`} data-id={item.id} onClick={() => navigate({ name: 'item', id: item.id })}>
      <span className="ahead__when">
        <span>{when}</span>
        {item.urgent ? <UrgentTag short /> : null}
      </span>
      <span className="ahead__title" dir="auto">
        {item.title}
      </span>
      {list ? (
        <span className="tag" style={lineVars(list.color)} dir="auto">
          {list.name}
        </span>
      ) : null}
    </button>
  );
}

/** The next 7 days as Tasky's tiles, a glance (no ticking), ending in a hatched "plan something". */
export function ComingUp({ v, day }: { v: TodayView; day: string }) {
  const { openSheet } = useOverlays();
  const tiles = aheadOf(v).slice(0, AHEAD_MAX);
  if (!tiles.length) return null;
  return (
    <Section title="Coming up" id="upcoming">
      <div className="ahead">
        {tiles.map((i) => (
          <AheadTile key={i.id} item={i} day={day} />
        ))}
        <button
          type="button"
          className="ahead__free"
          aria-label="Plan something"
          title="Plan something"
          onClick={() => openSheet((close) => <QuickAddSheet onClose={close} defaultDue={addDays(day, 1)} />)}
        >
          <span>
            <Icon name="plus" />
          </span>
        </button>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- partner

/** What my person finished since yesterday, with a ♡ to thank them. */
export function PartnerDid({ v }: { v: TodayView }) {
  const hub = useHub();
  const partner = hub.partner();
  if (!partner || !v.recent.length) return null;
  return (
    <Section title={`${partner.name} did`}>
      <ul className="rows">
        {v.recent.map((r) => (
          <li key={r.log?.id ?? r.item.id} className="row">
            <Avatar member={partner} size="sm" />
            <div className="row__body">
              <span className="row__title" dir="auto">
                {r.item.title}
              </span>
              <span className="row__meta">
                <span className="meta">{relativeAgo(r.at)}</span>
              </span>
            </div>
            {r.log ? (
              <button
                type="button"
                className={`heart ${r.log.thankedBy ? 'is-on' : ''}`}
                onClick={() => hub.thank(r.log!.id)}
                aria-label={`Thank ${partner.name}`}
                aria-pressed={!!r.log.thankedBy}
              >
                <Icon name={r.log.thankedBy ? 'heart-fill' : 'heart'} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------- my quick view

/** The tasks I chose to keep in sight here (a task's "Spotlight" chip), from any folder. Gone while it's empty. */
export function QuickView({ settle, show }: { settle: Settle<Item>; show?: (i: Item) => boolean }) {
  const hub = useHub();
  const prefs = usePrefs();
  const open = quickItems(hub, prefs.quick).filter((i) => !show || show(i));
  const rows = settle.view('quick', open);
  if (!rows.length) return null;
  return (
    <Section
      title={
        <>
          <Icon name="sparkle" className="icon--sm" />
          <span>Spotlight</span>
        </>
      }
      count={open.length}
    >
      <ul className="rows">
        {rows.map(({ row: i, settling }) => (
          <ItemRow key={i.id} item={i} settling={settling} showList />
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------- a pinned project

/** A window into one project: its first few open things and its add row. Never deduped. */
export function ProjectWidget({ listId, settle, show }: { listId: string; day?: string; settle: Settle<Item>; show?: (i: Item) => boolean }) {
  const hub = useHub();
  const list = hub.list(listId);
  if (!list) return null;
  // What's open in it, and in the projects inside it.
  const ids = new Set([listId, ...hub.nestedLists(listId).map((l) => l.id)]);
  const open = hub.store.all('item').filter((i) => ids.has(i.listId) && !i.parentId && !i.done && !i.archived && (!show || show(i)));
  // Its name is the way in.
  const head = (
    <button type="button" className="section__go" onClick={() => navigate({ name: 'list', id: listId })}>
      <ProjectMark color={list.color} icon={list.icon} size="sm" />
      <span dir="auto">{list.name}</span>
      <Icon name="chevron-right" className="section__goarrow" />
    </button>
  );
  // Urgent first, then in the project's order: the first five.
  const rows = settle.view(`l:${listId}`, [...open].sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || byOrder(a, b)).slice(0, 5));
  const body = rows.length ? (
    <ul className="rows">
      {rows.map(({ row: i, settling }) => (
        <ItemRow key={i.id} item={i} settling={settling} />
      ))}
    </ul>
  ) : null;
  return (
    <Section title={head} count={open.length}>
      {body}
    </Section>
  );
}

// ---------------------------------------------------------------- invite

const TWO_WEEKS = 14 * 86_400_000;

/** While I'm on my own: bring my person in. × puts it away for two weeks (this device). */
export function InviteCard() {
  const hub = useHub();
  const prefs = usePrefs();
  const { openSheet, toast } = useOverlays();
  // Read once per draw; the card comes back on its own after two weeks.
  const [now] = useState(() => Date.now());
  if (hub.partner() || prefs.inviteHiddenUntil > now) return null;
  return (
    <div className="invite">
      <button type="button" className="invite__main" onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)}>
        <span className="invite__people" aria-hidden="true">
          <Avatar member={hub.me()} size="md" />
          <span className="invite__empty">
            <Icon name="plus" className="icon--sm" />
          </span>
        </span>
        <span className="invite__text">
          <strong>Bring your person in</strong>
        </span>
        <Icon name="chevron-right" />
      </button>
      <button
        type="button"
        className="invite__x"
        aria-label="Not now"
        title="Not now"
        onClick={() => {
          setPrefs({ inviteHiddenUntil: Date.now() + TWO_WEEKS });
          toast('Okay. It’s in Settings when you’re ready.');
        }}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

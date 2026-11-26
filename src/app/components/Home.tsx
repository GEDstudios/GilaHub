import { useState } from 'react';
import { addDays, humanTime, relativeAgo, today as todayStr } from '../../core/dates';
import { use24h, usePrefs } from '../prefs';
import type { Item } from '../../core/model';
import { useHub, usePartnerHere } from '../context';
import { aheadDay, summaryOf, weekBy, weekCounts } from '../home';
import { onThisDay } from '../moments';
import { navigate } from '../router';
import { useLater } from '../tick';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Avatar, lineVars, Section } from '../ui/primitives';
import type { Settle } from '../ui/useSettle';
import type { TodayView } from '../views';
import { AsksSheet } from './HomeWidgets';
import { ItemRow } from './ItemRow';
import { MomentsSheet } from './Moments';
import { QuickAddSheet } from './QuickAddSheet';

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });

// ---------------------------------------------------------------- the day

/**
 * The page's one colour moment, and its answer: how much is left today, in big type; a bar of
 * done against left; and what needs me beyond it, each a way there: things from earlier, my
 * person's asks, my person on a project right now.
 */
export function DayCard({ v }: { v: TodayView }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const h24 = use24h(usePrefs());
  const partner = hub.partner();
  const here = usePartnerHere();
  const s = summaryOf(hub, v);
  const left = s.n;
  const done = v.doneToday;
  const total = left + done;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const asks = v.asked.length + v.awaitingOk.length;
  const on = here?.listId ? hub.list(here.listId) : undefined;
  const shopper = here ? hub.member(here.member) : undefined;
  // What's next: the next thing with a time still ahead today, else the first thing left.
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const next = v.today.find((i) => i.dueTime && i.dueTime >= hm) ?? v.today[0] ?? v.earlier[0];
  return (
    <section className="daycard" aria-label="Your day">
      <div className="daycard__main">
        {left ? (
          <p className="daycard__big">
            <span className="daycard__n num">{left}</span>
            <span className="daycard__what">
              left
              <br />
              today
            </span>
          </p>
        ) : (
          <p className="daycard__big daycard__big--calm">{done ? 'All done.' : 'A clear day.'}</p>
        )}
        {total ? (
          <div className="daycard__progress">
            <span className="daycard__bar" aria-hidden="true">
              <span style={{ width: `${Math.max(pct, done ? 6 : 0)}%` }} />
            </span>
            <span className="daycard__done">{done ? `${done} done` : 'Nothing done yet'}</span>
          </div>
        ) : (
          <p className="daycard__sub">Nothing due. Plan something, or enjoy it.</p>
        )}
        {next ? (
          <button type="button" className="daycard__next" onClick={() => navigate({ name: 'item', id: next.id })}>
            <span className="daycard__nextlabel">Next</span>
            <span className="daycard__nexttitle" dir="auto">
              {next.title}
            </span>
            {next.dueTime && v.today.includes(next) ? <span className="daycard__nexttime num">{humanTime(next.dueTime, h24)}</span> : null}
            <Icon name="chevron-right" className="icon--sm" />
          </button>
        ) : null}
      </div>
      {v.earlier.length || (partner && asks) || (shopper && on) ? (
        <div className="daycard__chips">
          {v.earlier.length ? (
            <button type="button" className="daychip" onClick={() => goTo('today')}>
              <Icon name="clock" className="icon--sm" />
              {v.earlier.length} from earlier
            </button>
          ) : null}
          {partner && asks ? (
            <button
              type="button"
              className="daychip daychip--person"
              style={lineVars(partner.color)}
              aria-label={`Waiting on you, from ${partner.name}`}
              onClick={() => (document.getElementById('home-asks') ? goTo('home-asks') : openSheet((close) => <AsksSheet onClose={close} day={todayStr()} />))}
            >
              <Avatar member={partner} size="xs" />
              {asks} from {partner.name}
            </button>
          ) : null}
          {shopper && on ? (
            <button type="button" className="daychip daychip--live" onClick={() => navigate({ name: 'list', id: on.id })}>
              <span className="daychip__dot" aria-hidden="true" />
              {shopper.name} is on {on.name}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- today

/**
 * Today: what's late first, said plainly, each with its quick way out (Today, Tomorrow or Skip),
 * then today's, in time order. Nothing at all: no block (the day card says it).
 */
export function TodayBlock({ v, day, settle }: { v: TodayView; day: string; settle: Settle<Item> }) {
  const hub = useHub();
  const later = useLater();
  const late = settle.view('earlier', v.earlier);
  const rows = settle.view('today', v.today);
  if (!late.length && !rows.length) return null;
  return (
    <Section title="Today" count={v.today.length + v.earlier.length} id="today">
      {late.length ? (
        <>
          <p className="daylabel daylabel--late">From earlier</p>
          <ul className="rows">
            {late.map(({ row: i, settling }) => (
              <ItemRow
                key={i.id}
                item={i}
                showList
                settling={settling}
                below={
                  hub.canEdit(i) ? (
                    <span className="catchup row__acts" onClick={(e) => e.stopPropagation()}>
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
        </>
      ) : null}
      {rows.length ? (
        <>
          {late.length ? <p className="daylabel">Today</p> : null}
          <ul className="rows">
            {rows.map(({ row: i, settling }) => (
              <ItemRow key={i.id} item={i} showList settling={settling} />
            ))}
          </ul>
        </>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------- the next days

const AGENDA_MAX = 8;

/** The next seven days as an agenda: a quiet heading per day, its things under it, then "Plan something". */
export function NextDays({ v, day }: { v: TodayView; day: string }) {
  const { openSheet } = useOverlays();
  const [all, setAll] = useState(false);
  if (!v.upcoming.length) return null;
  let budget = all ? Infinity : AGENDA_MAX;
  const days = v.upcoming.flatMap((g) => {
    if (budget <= 0) return [];
    const items = g.items.slice(0, budget);
    budget -= items.length;
    return [{ date: g.date, items }];
  });
  const total = v.upcoming.reduce((n, g) => n + g.items.length, 0);
  const shown = days.reduce((n, g) => n + g.items.length, 0);
  return (
    <Section
      title="Next 7 days"
      count={total}
      id="upcoming"
      action={
        <button type="button" className="textbtn" onClick={() => openSheet((close) => <QuickAddSheet onClose={close} defaultDue={addDays(day, 1)} />)}>
          Plan
        </button>
      }
    >
      <div className="agenda">
        {days.map((g) => (
          <div key={g.date} className="agenda__day">
            <p className="daylabel">{aheadDay(g.date, day)}</p>
            <ul className="rows">
              {g.items.map((i) => (
                <ItemRow key={i.id} item={i} showList dateMode="time" />
              ))}
            </ul>
          </div>
        ))}
      </div>
      {shown < total ? (
        <button type="button" className="quietline" onClick={() => setAll(true)}>
          {total - shown} more this week
          <span className="quietline__end">
            <Icon name="chevron-down" />
          </span>
        </button>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------- the week, us

/**
 * The week, as the two of us lived it: how much got done (against last week), who did what as
 * one split bar in our colours, what my person did since yesterday (a ♡ thanks them), and our
 * moments: the latest, or one from a year ago today, and a way to keep one.
 */
export function WeekCard({ v }: { v: TodayView }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const partner = hub.partner();
  const { week, last } = weekCounts(hub);
  const by = weekBy(hub);
  const people = hub.members().filter((m) => (by.get(m.id) ?? 0) > 0);
  const diff = week - last;
  const vs = !last ? null : diff > 0 ? `${diff} more than last week` : diff < 0 ? `${-diff} fewer than last week` : 'Same as last week';
  const moments = hub.moments();
  const back = onThisDay(moments, todayStr());
  const latest = back?.moment ?? moments[0];
  const openMoments = () => openSheet((close) => <MomentsSheet onClose={close} />);
  return (
    <section className="weekcard" aria-label="This week" id="week">
      <div className="weekcard__head">
        <h2 className="weekcard__title">This week</h2>
        {vs ? <span className="weekcard__vs">{vs}</span> : null}
      </div>
      <p className="weekcard__big">
        <span className="num">{week}</span> done{partner ? ' together' : ''}
      </p>
      {partner && week ? (
        <div className="weekcard__split" aria-label={people.map((m) => `${m.name} ${by.get(m.id)}`).join(', ')}>
          <span className="weekcard__bar">
            {people.map((m) => (
              <span key={m.id} style={{ ...lineVars(m.color), flex: by.get(m.id) }} />
            ))}
          </span>
          <span className="weekcard__people">
            {hub.members().map((m) => (
              <span key={m.id} className="weekcard__who">
                <Avatar member={m} size="xs" />
                {m.id === hub.meId ? 'You' : m.name} <span className="num">{by.get(m.id) ?? 0}</span>
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {partner && v.recent.length ? (
        <ul className="rows rows--plain weekcard__did">
          {v.recent.map((r) => (
            <li key={r.log?.id ?? r.item.id} className="row">
              <Avatar member={partner} size="xs" />
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
      ) : null}

      <button type="button" className="weekcard__moment" onClick={openMoments}>
        <span className="weekcard__feel" aria-hidden="true">
          {latest ? latest.feel : <Icon name="plus" />}
        </span>
        <span className="weekcard__mtext">
          <span dir="auto">{latest ? latest.text : 'Keep a moment'}</span>
          <span className="weekcard__mmeta">{back ? `${back.ago} today` : latest ? `${hub.member(latest.by)?.name ?? ''} · moments` : 'Something small counts'}</span>
        </span>
        <Icon name="chevron-right" className="icon--sm" />
      </button>
    </section>
  );
}

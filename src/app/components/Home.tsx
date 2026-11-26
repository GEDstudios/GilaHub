import { useState } from 'react';
import { addDays, fromDateStr, humanTime, relativeAgo, today as todayStr } from '../../core/dates';
import type { Item } from '../../core/model';
import { useHub, usePartnerHere } from '../context';
import { summaryOf, weekBy, weekCounts } from '../home';
import { onThisDay } from '../moments';
import { setPrefs, use24h, usePrefs } from '../prefs';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { PersonCursor } from '../ui/PersonCursor';
import { Avatar, lineVars } from '../ui/primitives';
import { RequestActions } from '../ui/tags';
import type { Settle } from '../ui/useSettle';
import type { TodayView } from '../views';
import { AskedLine } from './Asks';
import { ItemRow } from './ItemRow';
import { MomentsSheet } from './Moments';
import { QuickAddSheet } from './QuickAddSheet';

/*
 * Today, as docs/07-HOME.md has it: the day's card (my colour, a sentence, my person's tag on its
 * edge), one list of what I have to do, the week as a strip of days opened in place, and us.
 */

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const things = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'}`;

/** Asks that are mine to do now: undated, or due by today (a later one waits in the week, on its day). */
const asksNow = (v: TodayView, day: string) => v.asked.filter((i) => !i.due || i.due <= day);
/** Of those, the ones that wait folded under Today (an urgent one is in the list itself). */
const asksFolded = (v: TodayView, day: string) => asksNow(v, day).filter((i) => !i.urgent);

// ---------------------------------------------------------------- the day's card

/**
 * The day in words, on a card in my colour: how many things today, then one sentence (what's
 * next, what's from earlier; when nothing's left, what tomorrow holds). A black badge counts
 * done of all. My person's name tag sits on its edge, their cursor alive: what they asked of me
 * (a tap goes to it), or where they are right now.
 */
export function DayCard({ v, day }: { v: TodayView; day: string }) {
  const hub = useHub();
  const me = hub.me();
  const partner = hub.partner();
  const here = usePartnerHere();
  const h24 = use24h(usePrefs());
  // What's mine today; what my person asked waits folded (unless it's urgent), so it isn't counted.
  const left = summaryOf(hub, v).n - asksFolded(v, day).length;
  const done = v.doneToday;
  const total = left + done;
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const next = v.today.find((i) => i.dueTime && i.dueTime >= hm) ?? v.today[0] ?? v.earlier[0] ?? asksNow(v, day).find((i) => i.urgent);
  const tomorrow = v.upcoming.find((g) => g.date === addDays(day, 1))?.items.length ?? 0;
  const asks = v.awaitingOk.length + asksNow(v, day).length;
  const on = here?.listId ? hub.list(here.listId) : undefined;

  const title = left ? `${things(left)} today` : done ? 'All done for today' : 'A clear day';
  const sentence = left
    ? [next ? `${next.title}${next.dueTime && v.today.includes(next) ? ` at ${humanTime(next.dueTime, h24)}` : ''} is next.` : '', v.earlier.length ? `${v.earlier.length} from earlier.` : '']
        .filter(Boolean)
        .join(' ')
    : tomorrow
      ? `Tomorrow: ${things(tomorrow)}.`
      : 'Nothing due. Enjoy it.';

  // To what they asked: unfold it, then bring it into view.
  const toAsks = () => {
    setPrefs({ asksOpen: true });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const at = document.querySelector('#today .homeasks') ?? document.querySelector('#today li.is-ask');
        at?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' });
        const row = document.querySelector('#today li.is-ask');
        if (row) {
          row.classList.remove('row--flash');
          void (row as HTMLElement).offsetWidth;
          row.classList.add('row--flash');
        }
      }),
    );
  };

  return (
    <section className="daycard" style={lineVars(me?.color)} aria-label="Your day">
      <div className="daycard__top">
        <h2 className="daycard__title">{title}</h2>
        {done ? (
          <span className="daycard__badge num" aria-label={`${done} of ${total} done`}>
            {done}/{total}
          </span>
        ) : null}
      </div>
      <p className="daycard__sentence">
        {next && left ? (
          <button type="button" className="daycard__next" onClick={() => navigate({ name: 'item', id: next.id })}>
            {sentence}
          </button>
        ) : (
          sentence
        )}
      </p>
      {partner ? (
        <button
          type="button"
          className={`nametag daycard__tag ${asks ? 'is-asking' : ''}`}
          style={lineVars(partner.color)}
          onClick={() => (asks ? toAsks() : on ? navigate({ name: 'list', id: on.id }) : undefined)}
          aria-label={asks ? `${partner.name} asked you for ${things(asks)}` : on ? `${partner.name} is on ${on.name} now` : partner.name}
        >
          <PersonCursor color={partner.color} />
          {on && !asks ? <span className="live" /> : null}
          <span dir="auto">{asks ? `${partner.name} asked ${asks}` : on ? `${partner.name} · on ${on.name}` : partner.name}</span>
        </button>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- today, one list

/**
 * Everything I have to do now, as one list in the order to do it: an OK I owe my person (OK /
 * Not yet under it), what's from earlier ("since Tue"), today's in time order. What my person
 * asked of me waits under it, folded in one quiet line ("Hila asked you for 2 things"): it's
 * rarely for right now. An urgent ask is in the list itself. Ticked rows strike and fold.
 */
export function TodayList({ v, day, settle }: { v: TodayView; day: string; settle: Settle<Item> }) {
  const hub = useHub();
  const prefs = usePrefs();
  const partner = hub.partner();
  const ok = settle.view('ok', v.awaitingOk);
  const late = settle.view('earlier', v.earlier);
  const rows = settle.view('today', v.today);
  const loud = settle.view('asked!', asksNow(v, day).filter((i) => i.urgent));
  const folded = asksFolded(v, day);
  const quiet = settle.view('asked', folded);
  const open = prefs.asksOpen;
  const n = v.awaitingOk.length + v.earlier.length + v.today.length + loud.length;
  if (!ok.length && !late.length && !rows.length && !loud.length && !quiet.length) return null;
  const who = partner?.name ?? 'Your partner';
  return (
    <section className="section homelist" id="today">
      <div className="section__head">
        <h2 className="section__title">
          Today
          {n ? <span className="section__count num">{n}</span> : null}
        </h2>
      </div>
      {ok.length || late.length || rows.length || loud.length ? (
        <ul className="rows">
          {ok.map(({ row: i, settling }) =>
            i.submittedAt && i.requestedBy === hub.meId ? (
              <ItemRow key={i.id} item={i} settling={settling} showList dateMode="none" liClass="is-ask" below={<RequestActions item={i} className="row__acts" />} />
            ) : (
              <ItemRow key={i.id} item={i} settling={settling} showList liClass="is-ask" />
            ),
          )}
          {loud.map(({ row: i, settling }) => (
            <ItemRow key={i.id} item={i} showList settling={settling} liClass="is-ask" />
          ))}
          {late.map(({ row: i, settling }) => (
            <ItemRow key={i.id} item={i} showList settling={settling} />
          ))}
          {rows.map(({ row: i, settling }) => (
            <ItemRow key={i.id} item={i} showList settling={settling} />
          ))}
        </ul>
      ) : null}
      {quiet.length ? (
        <div className="homeasks">
          <button type="button" className="quietline" aria-expanded={open} onClick={() => setPrefs({ asksOpen: !open })}>
            {partner ? <Avatar member={partner} size="xs" /> : null}
            <span dir="auto">
              {who} asked you for {things(folded.length || quiet.length)}
            </span>
            <span className="quietline__end">
              <Icon name="chevron-down" />
            </span>
          </button>
          {open ? (
            <ul className="rows quietline__rows">
              {quiet.map(({ row: i, settling }) => (
                <ItemRow key={i.id} item={i} showList settling={settling} liClass="is-ask" />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- the week

/**
 * The next seven days as a strip of dates, a dot for each thing (up to three), the busiest
 * reading busiest at a glance. A tap opens that day's things right under it; an empty day offers
 * to plan something on it.
 */
export function WeekStrip({ v, day }: { v: TodayView; day: string }) {
  const { openSheet } = useOverlays();
  const days = Array.from({ length: 7 }, (_, n) => addDays(day, n + 1));
  const byDay = new Map<string, Item[]>(days.map((d) => [d, []]));
  for (const g of v.upcoming) byDay.get(g.date)?.push(...g.items);
  for (const i of v.asked) if (i.due && byDay.has(i.due)) byDay.get(i.due)!.push(i);
  const busy = days.filter((d) => byDay.get(d)!.length);
  const [pick, setPick] = useState<string | null>(null);
  if (!busy.length) return null;
  const chosen = pick && byDay.has(pick) ? pick : busy[0];
  const items = byDay.get(chosen)!;
  const total = busy.reduce((n, d) => n + byDay.get(d)!.length, 0);
  const label = (d: string) => (d === addDays(day, 1) ? 'Tomorrow' : fromDateStr(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }));
  return (
    <section className="section homeweek" id="upcoming">
      <div className="section__head">
        <h2 className="section__title">
          The week
          <span className="section__count num">{total}</span>
        </h2>
      </div>
      <div className="weekstrip" role="tablist" aria-label="The next seven days">
        {days.map((d) => {
          const n = byDay.get(d)!.length;
          const date = fromDateStr(d);
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === chosen}
              aria-label={`${label(d)}: ${n ? things(n) : 'nothing'}`}
              className={`weekstrip__day ${d === chosen ? 'is-on' : ''} ${n ? '' : 'is-empty'}`}
              onClick={() => setPick(d)}
            >
              <span className="weekstrip__wd">{date.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}</span>
              <span className="weekstrip__date num">{date.getDate()}</span>
              <span className="weekstrip__dots" aria-hidden="true">
                {Array.from({ length: Math.min(n, 3) }, (_, k) => (
                  <i key={k} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <p className="weekstrip__label">{label(chosen)}</p>
      {items.length ? (
        <ul className="rows">
          {items.map((i) => (
            <ItemRow key={i.id} item={i} showList dateMode="time" />
          ))}
        </ul>
      ) : (
        <button type="button" className="quietline" onClick={() => openSheet((close) => <QuickAddSheet onClose={close} defaultDue={chosen} />)}>
          Nothing yet. Plan something
          <span className="quietline__end">
            <Icon name="plus" />
          </span>
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- us

/**
 * Us, in one grey tile: the one shared number (done together this week, against last week), who
 * did what; what my person did since yesterday (a ♡ thanks them); what I asked of them; and a
 * moment to keep (or one from a year ago today). On my own: my week and my moments.
 */
export function UsTile({ v, settle }: { v: TodayView; settle: Settle<Item> }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const partner = hub.partner();
  const { week, last } = weekCounts(hub);
  const by = weekBy(hub);
  const diff = week - last;
  const vs = !last ? null : diff > 0 ? `${diff} more than last week` : diff < 0 ? `${-diff} fewer than last week` : 'as many as last week';
  const moments = hub.moments();
  const back = onThisDay(moments, todayStr());
  const latest = back?.moment ?? moments[0];
  return (
    <section className="section homeus" id="week" aria-label={partner ? 'Us' : 'Your week'}>
      <div className="section__head">
        <h2 className="section__title">{partner ? 'Us' : 'Your week'}</h2>
      </div>
      <div className="ustile">
        <div className="ustile__week">
          <span className="ustile__n num">{week}</span>
          <span className="ustile__what">
            done {partner ? 'together ' : ''}this week
            {vs ? <span className="ustile__vs">{vs}</span> : null}
          </span>
          {partner ? (
            <span className="ustile__people">
              {hub.members().map((m) => (
                <span key={m.id} className="ustile__who" title={`${m.name}: ${by.get(m.id) ?? 0}`}>
                  <Avatar member={m} size="xs" />
                  <span className="num">{by.get(m.id) ?? 0}</span>
                </span>
              ))}
            </span>
          ) : null}
        </div>
        {partner && v.recent.length ? (
          <ul className="ustile__did">
            {v.recent.map((r) => (
              <li key={r.log?.id ?? r.item.id}>
                <Avatar member={partner} size="xs" />
                <span className="ustile__didtext" dir="auto">
                  {r.item.title}
                  <span className="ustile__ago"> · {relativeAgo(r.at)}</span>
                </span>
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
        <AskedLine v={v} settle={settle} />
        <button type="button" className="ustile__moment" onClick={() => openSheet((close) => <MomentsSheet onClose={close} />)}>
          <span className="ustile__feel" aria-hidden="true">
            {latest ? latest.feel : <Icon name="sparkle" />}
          </span>
          <span className="ustile__mtext" dir="auto">
            {latest ? latest.text : 'Keep a moment from this week'}
            {back ? <span className="ustile__ago"> · {back.ago}</span> : null}
          </span>
          <Icon name="chevron-right" className="icon--sm" />
        </button>
      </div>
    </section>
  );
}

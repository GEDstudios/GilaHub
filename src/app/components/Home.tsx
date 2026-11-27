import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { addDays, fromDateStr, humanTime, relativeAgo, today as todayStr } from '../../core/dates';
import type { Item, LineColor } from '../../core/model';
import { useHub, usePartnerHere } from '../context';
import { summaryOf, weekBy, weekCounts, weekDays } from '../home';
import { setPrefs, use24h } from '../prefs';
import { usePrefs } from '../usePrefs';
import { howMany } from '../labels';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { PersonCursor } from '../ui/PersonCursor';
import { Avatar, lightVar, lineVars, ThanksButton, Button, Section } from '../ui/primitives';
import { haptic } from '../ui/haptics';
import { RequestActions } from './RowTags';
import type { Settle } from '../ui/useSettle';
import type { TodayView } from '../views';
import { ItemRow } from './ItemRow';
import { QuickAddSheet } from './QuickAddSheet';
import { calm } from '../ui/tokens';
import { G } from '../ui/glyphs';

/*
 * Today, as docs/07-HOME.md has it: the day's card (my colour, a sentence, my person's tag on its
 * edge), one list of what I have to do, the week as a strip of days opened in place, and us.
 */

const things = (n: number) => howMany(n, 'thing');

/** Open one of Us's colour cards from elsewhere on the page ('asks', 'week', 'did', 'asked'). */
const US_EVENT = 'gila:us-card';
function openUsCard(key: string): void {
  window.dispatchEvent(new CustomEvent(US_EVENT, { detail: key }));
}

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

  // To what they asked: its card opens (or, with Us hidden, the line under Today), and comes into view.
  const toAsks = () => {
    openUsCard('asks');
    setPrefs({ asksOpen: true });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const at = document.querySelector('.wcard[data-card="asks"]') ?? document.querySelector('#today .homeasks') ?? document.querySelector('li.is-ask');
        at?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' });
        const row = document.querySelector('.wcard[data-card="asks"] li.is-ask, #today li.is-ask');
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
 * asked of me is rarely for right now: it waits in Us's colour cards ("Hila asked you for"), or,
 * with Us hidden, folded in one quiet line under the list. An urgent ask is in the list itself.
 * Ticked rows strike and fold.
 */
export function TodayList({ v, day, settle, asksHere = false }: { v: TodayView; day: string; settle: Settle<Item>; asksHere?: boolean }) {
  const hub = useHub();
  const prefs = usePrefs();
  const partner = hub.partner();
  const ok = settle.view('ok', v.awaitingOk);
  const late = settle.view('earlier', v.earlier);
  const rows = settle.view('today', v.today);
  const loud = settle.view('asked!', asksNow(v, day).filter((i) => i.urgent));
  const folded = asksHere ? asksFolded(v, day) : [];
  const quiet = settle.view('asked', folded);
  const open = prefs.asksOpen;
  const n = v.awaitingOk.length + v.earlier.length + v.today.length + loud.length;
  if (!ok.length && !late.length && !rows.length && !loud.length && !quiet.length) return null;
  const who = partner?.name ?? 'Your person';
  return (
    <Section className="homelist" id="today" title="Today" count={n}>
      {ok.length || late.length || rows.length || loud.length ? (
        <ul className="rows">
          {ok.map(({ row: i, settling }) =>
            i.submittedAt && i.requestedBy === hub.meId ? (
              <ItemRow key={i.id} item={i} settling={settling} showList listLink={false} dateMode="none" liClass="is-ask" below={<RequestActions item={i} className="row__acts" />} />
            ) : (
              <ItemRow key={i.id} item={i} settling={settling} showList listLink={false} liClass="is-ask" />
            ),
          )}
          {loud.map(({ row: i, settling }) => (
            <ItemRow key={i.id} item={i} showList listLink={false} settling={settling} liClass="is-ask" />
          ))}
          {late.map(({ row: i, settling }) => (
            <ItemRow key={i.id} item={i} showList listLink={false} settling={settling} />
          ))}
          {rows.map(({ row: i, settling }) => (
            <ItemRow key={i.id} item={i} showList listLink={false} settling={settling} />
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
            <Icon name={G.fold} className="chev quietline__end" />
          </button>
          {open ? (
            <ul className="rows quietline__rows">
              {quiet.map(({ row: i, settling }) => (
                <ItemRow key={i.id} item={i} showList listLink={false} settling={settling} liClass="is-ask" />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Section>
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
    <Section className="homeweek" id="upcoming" title="The week" count={total}>
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
            <ItemRow key={i.id} item={i} showList listLink={false} dateMode="time" />
          ))}
        </ul>
      ) : (
        <button type="button" className="quietline" onClick={() => openSheet((close) => <QuickAddSheet onClose={close} defaultDue={chosen} />)}>
          Nothing yet. Plan something
          <span className="quietline__end">
            <Icon name={G.add} />
          </span>
        </button>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- us

type Card = { key: string; color: LineColor; num: ReactNode; label: string; detail?: string; more: ReactNode };

/**
 * Us, as colour cards on a table (each leans a little, the next the other way, overlapping),
 * only the ones with something to say. A tap picks one up and opens it in place:
 * - what my person asked of me (first: it's mine to do): open, the rows, to tick right there.
 * - the week: how many we did (against last week); open, a chart of the seven days, a bar each,
 *   in our colours, that grow in; a tap on a day says who did what.
 * - what my person did since yesterday: open, each thing with a ♡ to thank them (and one for all).
 * - what I asked of them: open, those rows, to see where they are.
 * On my own: my week.
 */
export function UsTile({ v, settle }: { v: TodayView; settle: Settle<Item> }) {
  const hub = useHub();
  const partner = hub.partner();
  const [open, setOpen] = useState<string | null>(null);
  const { week, last } = weekCounts(hub);
  const by = weekBy(hub);
  const diff = week - last;
  const vs = !last ? '' : diff > 0 ? `${diff} more than last week` : diff < 0 ? `${-diff} fewer than last week` : 'as many as last week';
  const cards: Card[] = [];
  const day = todayStr();

  // Open a card from elsewhere (Hila's tag on the day card opens what she asked).
  useEffect(() => {
    const on = (e: Event) => setOpen((e as CustomEvent<string>).detail);
    window.addEventListener(US_EVENT, on);
    return () => window.removeEventListener(US_EVENT, on);
  }, []);

  // What my person asked of me (not urgent: an urgent one is in Today's list): first, it's mine to do.
  const asks = partner ? asksFolded(v, day) : [];
  if (partner && asks.length) {
    cards.push({
      key: 'asks',
      color: 'amber',
      num: asks.length,
      label: `${partner.name} asked you for`,
      detail: asks
        .slice(0, 3)
        .map((i) => i.title)
        .join(', '),
      more: <AsksRows items={asks} settle={settle} />,
    });
  }

  if (week || partner) {
    const people = partner ? hub.members().map((m) => `${m.id === hub.meId ? 'You' : m.name} ${by.get(m.id) ?? 0}`).join(' · ') : '';
    cards.push({
      key: 'week',
      color: 'lilac',
      num: week,
      label: `done ${partner ? 'together ' : ''}this week`,
      detail: [people, vs].filter(Boolean).join(' · ') || (week ? 'Tap to see your days' : 'Tick things off and they count here'),
      more: <WeekChart />,
    });
  }

  if (partner && v.recent.length) {
    const n = v.recent.length;
    const thanked = v.recent.filter((r) => r.log?.thankedBy).length;
    cards.push({
      key: 'did',
      // In their colour (unless that's another card's).
      color: partner.color === 'ink' ? 'lemon' : partner.color === 'lilac' || partner.color === 'sky' ? 'pink' : partner.color,
      num: n,
      label: `${partner.name} did since yesterday`,
      detail: thanked === n ? 'All thanked ♡' : v.recent.map((r) => r.item.title).slice(0, 3).join(', '),
      more: <DidList v={v} />,
    });
  }

  const asked = v.outgoing.length + v.waitingTheirOk.length;
  if (partner && asked) {
    const done = v.waitingTheirOk.length;
    cards.push({
      key: 'asked',
      color: 'sky',
      num: v.outgoing.length || done,
      label: v.outgoing.length ? `you asked ${partner.name} for` : `waiting for ${partner.name}’s OK`,
      detail: v.outgoing.length ? [v.outgoing.slice(0, 2).map((i) => i.title).join(', '), done ? `${done} waiting for ${partner.name}’s OK` : ''].filter(Boolean).join(' · ') : undefined,
      more: <AskedRows v={v} settle={settle} />,
    });
  }

  if (!cards.length) return null;
  return (
    <section className="section homeus" id="week" aria-label={partner ? 'Us' : 'Your week'}>
      <div className="section__head">
        <h2 className="section__title">{partner ? 'Us' : 'Your week'}</h2>
      </div>
      <div className={`wcards ${open ? 'has-open' : ''}`}>
        {cards.map((c, i) => {
          const on = open === c.key;
          return (
            <div key={c.key} data-card={c.key} className={`wcard ${on ? 'is-open' : ''}`} style={{ ...lineVars(c.color), '--i': i } as CSSProperties}>
              <button
                type="button"
                className="wcard__face"
                aria-expanded={on}
                onClick={() => {
                  haptic(on ? 'select' : 'tick');
                  setOpen(on ? null : c.key);
                }}
              >
                <span className="wcard__num num">{c.num}</span>
                <span className="wcard__text">
                  <span className="wcard__label" dir="auto">
                    {c.label}
                  </span>
                  {c.detail ? (
                    <span className="wcard__detail" dir="auto">
                      {c.detail}
                    </span>
                  ) : null}
                </span>
                <Icon name={G.fold} className="chev wcard__chev" />
              </button>
              {on ? <div className="wcard__more">{c.more}</div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The seven days as bars, a segment each of us in our colours, growing in one after another. */
function WeekChart() {
  const hub = useHub();
  const days = weekDays(hub);
  const members = hub.partner() ? hub.members() : hub.me() ? [hub.me()!] : [];
  const max = Math.max(1, ...days.map((d) => d.total));
  const [pick, setPick] = useState<number>(6);
  const d = days[pick];
  const label = (date: string) => (date === todayStr() ? 'Today' : fromDateStr(date).toLocaleDateString('en-GB', { weekday: 'long' }));
  const said = d.total
    ? members
        .filter((m) => d.by.get(m.id))
        .map((m) => `${m.id === hub.meId ? 'You' : m.name} ${d.by.get(m.id)}`)
        .join(' · ')
    : 'Nothing ticked';
  return (
    <div className="wchart">
      <p className="wchart__say" aria-live="polite">
        <strong>{label(d.date)}</strong> · {said}
      </p>
      <div className="wchart__bars" role="group" aria-label="The last seven days">
        {days.map((day, k) => (
          <button
            key={day.date}
            type="button"
            className={`wchart__day ${k === pick ? 'is-on' : ''}`}
            style={{ '--k': k } as CSSProperties}
            aria-label={`${label(day.date)}: ${day.total}`}
            aria-pressed={k === pick}
            onClick={(e) => {
              e.stopPropagation();
              haptic('select');
              setPick(k);
            }}
          >
            <span className="wchart__col" style={{ height: `${Math.max(day.total ? 14 : 4, (day.total / max) * 100)}%` }}>
              {members.map((m) =>
                day.by.get(m.id) ? <span key={m.id} className="wchart__seg" style={{ flexGrow: day.by.get(m.id), background: lightVar(m.color) }} /> : null,
              )}
            </span>
            <span className="wchart__wd">{fromDateStr(day.date).toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** What my person did since yesterday, each with a ♡; "Thank for all" sends the rest. */
function DidList({ v }: { v: TodayView }) {
  const hub = useHub();
  const partner = hub.partner();
  if (!partner) return null;
  const left = v.recent.filter((r) => r.log && !r.log.thankedBy);
  return (
    <>
      <ul className="wcard__list">
        {v.recent.map((r) => (
          <li key={r.log?.id ?? r.item.id}>
            <span className="wcard__item" dir="auto">
              {r.item.title}
              <span className="wcard__ago"> · {relativeAgo(r.at)}</span>
            </span>
            {r.log ? <ThanksButton on={!!r.log.thankedBy} label={`Thank ${partner.name} for ${r.item.title}`} onToggle={() => hub.thank(r.log!.id)} /> : null}
          </li>
        ))}
      </ul>
      {left.length > 1 ? (
        <Button
          icon={G.thanks}
          small
          onClick={(e) => {
            e.stopPropagation();
            haptic('success');
            hub.store.batch(() => {
              for (const r of left) hub.thank(r.log!.id);
            });
          }}
          className="wcard__all"
        >
          Thank {partner.name} for all
        </Button>
      ) : null}
    </>
  );
}

/** What my person asked of me: the rows, to tick right here. */
function AsksRows({ items, settle }: { items: Item[]; settle: Settle<Item> }) {
  const rows = settle.view('asked', items);
  return (
    <ul className="rows wcard__rows" onClick={(e) => e.stopPropagation()}>
      {rows.map(({ row: i, settling }) => (
        <ItemRow key={i.id} item={i} settling={settling} showList listLink={false} liClass="is-ask" />
      ))}
    </ul>
  );
}

/** What I asked of my person, and what I did of theirs waiting for their OK: the rows themselves. */
function AskedRows({ v, settle }: { v: TodayView; settle: Settle<Item> }) {
  const rows = [...settle.view('outgoing', v.outgoing), ...settle.view('theirok', v.waitingTheirOk)];
  return (
    <ul className="rows wcard__rows" onClick={(e) => e.stopPropagation()}>
      {rows.map(({ row: i, settling }) => (
        <ItemRow key={i.id} item={i} settling={settling} showList listLink={false} />
      ))}
    </ul>
  );
}

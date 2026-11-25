import { addDays, addMonths, diffDays, fromDateStr, today, weekday, type DateStr } from '../core/dates';
import type { RepeatRule } from '../core/model';

/**
 * Two repeat types, in plain words (see docs/RESEARCH.md → chores):
 *
 *  "Every N days after it's done"  (interval, from: 'done')     — mess-based chores.
 *      Next = the day it was done + N. Early or late, the clock restarts that day.
 *
 *  "On set days"                   (weekdays, or interval from: 'schedule') — bins, bills.
 *      A completion counts for the nearest occurrence that isn't done yet.
 *      Early → next is the following occurrence. Late → missed ones collapse into one,
 *      next is the first future occurrence. Never a pile-up.
 */

const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** Does this date match one of the month days? Days past a short month's end fold into its last day. */
function isMonthday(date: DateStr, days: number[]): boolean {
  const d = fromDateStr(date);
  const dom = d.getDate();
  const last = daysInMonth(d);
  return days.some((x) => (x === -1 ? dom === last : Math.min(x, last) === dom));
}

/** First month-day occurrence on or after `from`. */
function nextMonthday(from: DateStr, days: number[], inclusive: boolean): DateStr {
  const set = days.length ? days : [fromDateStr(from).getDate()];
  let d = inclusive ? from : addDays(from, 1);
  for (let i = 0; i < 400; i++) {
    if (isMonthday(d, set)) return d;
    d = addDays(d, 1);
  }
  return d;
}

/** "1st", "2nd", "23rd", "last day". */
export function ordinalDay(n: number): string {
  if (n === -1) return 'last day';
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

export function isFlexible(rule: RepeatRule): boolean {
  return rule.type === 'interval' && rule.from === 'done';
}

function step(date: DateStr, rule: Extract<RepeatRule, { type: 'interval' }>, times = 1): DateStr {
  const n = rule.every * times;
  switch (rule.unit) {
    case 'day':
      return addDays(date, n);
    case 'week':
      return addDays(date, 7 * n);
    case 'month':
      return addMonths(date, n);
    case 'year':
      return addMonths(date, 12 * n);
  }
}

/** Approximate period in days, for freshness bars and "usually every…" copy. */
export function periodDays(rule: RepeatRule): number {
  if (rule.type === 'weekdays') return Math.max(1, Math.round((7 * (rule.every ?? 1)) / Math.max(1, rule.days.length)));
  if (rule.type === 'monthdays') return Math.max(1, Math.round(30 / Math.max(1, rule.days.length)));
  const per = { day: 1, week: 7, month: 30, year: 365 }[rule.unit];
  return per * rule.every;
}

/** First weekday occurrence on or after `from`. */
function nextWeekday(from: DateStr, days: number[], inclusive: boolean): DateStr {
  const set = new Set(days.length ? days : [weekday(from)]);
  let d = inclusive ? from : addDays(from, 1);
  for (let i = 0; i < 8; i++) {
    if (set.has(weekday(d))) return d;
    d = addDays(d, 1);
  }
  return d;
}

/** The first due date for a newly created repeating item. */
/**
 * When a new repeating thing first comes due, if you didn't give a date:
 * set days → the next of those days (today counts); "every N" → one period from now.
 * A brand-new chore starts fresh instead of landing on today.
 */
export function firstDue(rule: RepeatRule, start: DateStr = today()): DateStr {
  if (rule.type === 'weekdays') return nextWeekday(start, rule.days, true);
  if (rule.type === 'monthdays') return nextMonthday(start, rule.days, true);
  return step(start, rule);
}

/**
 * Next due date after completing the occurrence due on `due` on day `doneOn`.
 */
export function nextDue(rule: RepeatRule, due: DateStr | null | undefined, doneOn: DateStr = today()): DateStr {
  if (rule.type === 'interval' && rule.from === 'done') return step(doneOn, rule);

  if (rule.type === 'monthdays') {
    const current = due ?? nextMonthday(doneOn, rule.days, true);
    const after = doneOn < current ? current : doneOn;
    return nextMonthday(after, rule.days, false);
  }

  if (rule.type === 'weekdays') {
    const current = due ?? nextWeekday(doneOn, rule.days, true);
    // Early: counts for `current`; the next one is the following occurrence after it.
    // On time / late: collapse everything missed; next future occurrence after today.
    const after = doneOn < current ? current : doneOn;
    return nextWeekday(after, rule.days, false);
  }

  // Interval on a fixed schedule.
  const current = due ?? doneOn;
  if (doneOn < current) return step(current, rule);
  // Late: jump to the first occurrence strictly after doneOn (collapsing missed ones).
  let next = step(current, rule);
  let guard = 0;
  while (next <= doneOn && guard++ < 10_000) next = step(next, rule);
  return next;
}

/** Skip the current occurrence without recording it as done (fixed schedules). */
export function skipDue(rule: RepeatRule, due: DateStr | null | undefined, ref: DateStr = today()): DateStr {
  const current = due ?? ref;
  if (rule.type === 'weekdays') return nextWeekday(current, rule.days, false);
  if (rule.type === 'monthdays') return nextMonthday(current, rule.days, false);
  if (rule.type === 'interval' && rule.from === 'done') return step(ref, rule);
  return step(current, rule);
}

export type Freshness = 'fresh' | 'soon' | 'today' | 'whenever';

/** Words, not counters: Fresh → Soon → Today → When you can. */
export function freshness(due: DateStr | null | undefined, ref: DateStr = today()): Freshness {
  if (!due) return 'fresh';
  const d = diffDays(ref, due);
  if (d < 0) return 'whenever';
  if (d === 0) return 'today';
  if (d <= 2) return 'soon';
  return 'fresh';
}

/**
 * 0..1 — how much "freshness" is left (1 = just done, 0 = due). Clamped.
 * Drives the draining bar on chore rows.
 */
export function freshnessLevel(rule: RepeatRule, due: DateStr | null | undefined, ref: DateStr = today()): number {
  if (!due) return 1;
  const period = periodDays(rule);
  const left = diffDays(ref, due);
  return Math.max(0, Math.min(1, left / period));
}

/** Plain-language description: "Every 3 days after it's done", "Sun & Wed", "Every month on the 1st". */
export function describeRule(rule: RepeatRule, weekdayShort: (n: number) => string): string {
  if (rule.type === 'weekdays') {
    const days = [...rule.days].sort((a, b) => a - b);
    if (days.length === 7) return 'Every day';
    const names = days.map(weekdayShort);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}` : names[0];
    return (rule.every ?? 1) > 1 ? `Every ${rule.every} weeks · ${list}` : `Every ${list}`;
  }
  if (rule.type === 'monthdays') {
    const days = [...rule.days].sort((a, b) => (a === -1 ? 99 : a) - (b === -1 ? 99 : b)).map(ordinalDay);
    const list = days.length > 1 ? `${days.slice(0, -1).join(', ')} & ${days[days.length - 1]}` : days[0];
    return `Every month on the ${list}`;
  }
  const unit = rule.every === 1 ? rule.unit : `${rule.unit}s`;
  const base = rule.every === 1 ? (rule.unit === 'day' ? 'Every day' : `Every ${unit}`) : `Every ${rule.every} ${unit}`;
  return rule.from === 'done' ? `${base} after it's done` : base;
}

/** Shift a due date forward by the length of an away period (used by Away mode). */
export function shiftForAway(rule: RepeatRule, due: DateStr | null | undefined, awayDays: number, ref: DateStr = today()): DateStr | null {
  if (!due) return null;
  if (isFlexible(rule)) return addDays(due, awayDays);
  // Fixed schedules don't move; just collapse anything missed while away.
  if (due >= ref) return due;
  let next = due;
  let guard = 0;
  while (next < ref && guard++ < 10_000) next = skipDue(rule, next, ref);
  return next;
}

export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(fromDateStr(s).getTime());
}

/** Local-calendar date helpers. Dates are "YYYY-MM-DD" strings in the device's time zone. */

export type DateStr = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateStr(s: DateStr): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(now: Date = new Date()): DateStr {
  return toDateStr(now);
}

export function addDays(s: DateStr, n: number): DateStr {
  const d = fromDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** Add months keeping the day-of-month (clamped), optionally pinned to `day`. */
export function addMonths(s: DateStr, n: number, day?: number): DateStr {
  const d = fromDateStr(s);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const want = day ?? d.getDate();
  target.setDate(Math.min(want, daysInMonth(target.getFullYear(), target.getMonth())));
  return toDateStr(target);
}

/** Whole calendar days from a to b (b - a). DST-safe. */
export function diffDays(a: DateStr, b: DateStr): number {
  const da = fromDateStr(a);
  const db = fromDateStr(b);
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86_400_000);
}

export function weekday(s: DateStr): number {
  return fromDateStr(s).getDay();
}

function dateOfMs(ms: number): DateStr {
  return toDateStr(new Date(ms));
}

/** Epoch ms of a local date + optional "HH:mm". */
export function atLocal(s: DateStr, time?: string | null): number {
  const d = fromDateStr(s);
  if (time) {
    const [h, m] = time.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  } else {
    d.setHours(9, 0, 0, 0);
  }
  return d.getTime();
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayName(n: number, long = false): string {
  return (long ? WEEKDAYS_LONG : WEEKDAYS_SHORT)[n];
}

/** "Today", "Tomorrow", "Yesterday", "Thursday", "Mon 30 Nov", "12 Jan 2027". */
export function humanDate(s: DateStr, ref: DateStr = today()): string {
  const delta = diffDays(ref, s);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  const d = fromDateStr(s);
  if (delta > 1 && delta < 7) return WEEKDAYS_LONG[d.getDay()];
  const r = fromDateStr(ref);
  const base = `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === r.getFullYear() ? base : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** Gentle phrasing for things in the past: "since yesterday", "since Tuesday", "since 3 Nov". */
export function sinceDate(s: DateStr, ref: DateStr = today()): string {
  const delta = diffDays(s, ref);
  if (delta <= 0) return '';
  if (delta === 1) return 'since yesterday';
  const d = fromDateStr(s);
  if (delta < 7) return `since ${WEEKDAYS_LONG[d.getDay()]}`;
  return `since ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** "17:30" → "5:30 pm" or keep 24h depending on preference. */
export function humanTime(t: string, h24 = false): string {
  const [h, m] = t.split(':').map(Number);
  if (h24) return `${pad(h)}:${pad(m)}`;
  const suffix = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hh} ${suffix}` : `${hh}:${pad(m)} ${suffix}`;
}

export function relativeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w} wk ago`;
  return dateOfMs(ms);
}

/** A day of a moment, short: "20 Nov", or "20 Nov 2025" in another year. */
export function shortDay(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** A compact age for a meta line: "now", "5m", "3h", "3d", "2w", then the day ("20 Nov"). */
export function shortAgo(ms: number, now = Date.now()): string {
  const m = Math.floor(Math.max(0, now - ms) / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  if (d < 35) return `${Math.floor(d / 7)}w`;
  return shortDay(ms, now);
}

/** Does the locale write dates day-first (13/12) rather than month-first (12/13)? */
export function prefersDayFirst(locale = typeof navigator !== 'undefined' ? navigator.language : 'en-IL'): boolean {
  return !/^en-(US|PH|CA)$/i.test(locale) && !/^(fil|tl)/i.test(locale);
}

/** 0 = Sunday-first (Israel, US), 1 = Monday-first (most of Europe). */
export function weekStartsOn(locale = typeof navigator !== 'undefined' ? navigator.language : 'en-IL'): 0 | 1 {
  return /-(IL|US|CA|JP|BR|MX|PH|IN|KR|TW|ZA|SA|AE)$/i.test(locale) || /^(he|iw)/i.test(locale) ? 0 : 1;
}

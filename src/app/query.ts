import type { Hub } from '../core/actions';
import { addDays, today as todayStr, weekday } from '../core/dates';
import type { Item } from '../core/model';
import { fold } from '../smart/normalize';
import { getPrefs, weekStart } from './prefs';
import { itemVisChoice } from './privacy';

/**
 * Which tasks: the one filter behind search (typed: "#work urgent this week") and the filtered
 * lists on Today. Every part narrows; an unset part lets everything through.
 */
export type DueWindow = 'overdue' | 'today' | 'tomorrow' | 'thisweek' | 'nextweek' | 'next7' | 'nodate';

export interface TaskQuery {
  /** Words in the title or the note. */
  text?: string;
  /** All of these tags (ids). */
  tags?: string[];
  /** In this folder, or one inside it. */
  listId?: string | null;
  due?: DueWindow | null;
  urgent?: boolean;
  /** Mine (Mine and Private) or ours (the rest). */
  side?: 'mine' | 'ours' | null;
  /** Done ones too. */
  done?: boolean;
}

export const DUE_LABEL: Record<DueWindow, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisweek: 'This week',
  nextweek: 'Next week',
  next7: 'Next 7 days',
  nodate: 'No date',
};

/** The calendar week this day is in (from my week's first day), as its first and last day. */
function weekOf(day: string, start: 0 | 1): [string, string] {
  const back = (weekday(day) - start + 7) % 7;
  const first = addDays(day, -back);
  return [first, addDays(first, 6)];
}

export function dueMatches(item: Item, w: DueWindow, ref = todayStr(), start: 0 | 1 = weekStart(getPrefs())): boolean {
  const d = item.due ?? null;
  if (w === 'nodate') return !d;
  if (!d) return false;
  if (w === 'overdue') return d < ref;
  if (w === 'today') return d === ref;
  if (w === 'tomorrow') return d === addDays(ref, 1);
  if (w === 'next7') return d >= ref && d <= addDays(ref, 6);
  const [a, b] = weekOf(ref, start);
  if (w === 'thisweek') return d >= ref && d <= b;
  return d >= addDays(a, 7) && d <= addDays(b, 7);
}

/** The tasks it lets through (top-level and subtasks alike), the open ones first, the newest first. */
export function runQuery(hub: Hub, q: TaskQuery, ref = todayStr()): Item[] {
  const lists = new Set((q.listId ? [q.listId, ...hub.nestedLists(q.listId).map((l) => l.id)] : hub.lists().map((l) => l.id)));
  const words = q.text ? fold(q.text).split(/\s+/).filter(Boolean) : [];
  const start = weekStart(getPrefs());
  const out: Item[] = [];
  for (const it of hub.store.all('item')) {
    if (!lists.has(it.listId) || it.archived) continue;
    if (it.done && !q.done) continue;
    if (q.urgent && !it.urgent) continue;
    if (q.due && !dueMatches(it, q.due, ref, start)) continue;
    if (q.tags?.length) {
      const own = hub.tagsOf(it);
      if (!q.tags.every((t) => own.includes(t))) continue;
    }
    if (q.side) {
      const c = itemVisChoice(hub, it);
      const mine = c === 'mine' || c === 'private';
      if ((q.side === 'mine') !== mine) continue;
    }
    if (words.length) {
      const hay = fold(`${it.title} ${it.notes ?? ''}`);
      if (!words.every((w) => hay.includes(w))) continue;
    }
    out.push(it);
  }
  return out.sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** True when it asks for anything beyond words (then search shows a filtered list). */
export const hasFilters = (q: TaskQuery) => !!(q.tags?.length || q.listId || q.due || q.urgent || q.side || q.done);

const KEYWORDS: Array<{ re: RegExp; set: (q: TaskQuery) => void; label: string }> = [
  { re: /^(urgent|!)$/, set: (q) => (q.urgent = true), label: 'Urgent' },
  { re: /^overdue$/, set: (q) => (q.due = 'overdue'), label: 'Overdue' },
  { re: /^today$/, set: (q) => (q.due = 'today'), label: 'Today' },
  { re: /^tomorrow$/, set: (q) => (q.due = 'tomorrow'), label: 'Tomorrow' },
  { re: /^next\s*week$/, set: (q) => (q.due = 'nextweek'), label: 'Next week' },
  { re: /^(this\s*)?week$/, set: (q) => (q.due = 'thisweek'), label: 'This week' },
  { re: /^no\s*date$/, set: (q) => (q.due = 'nodate'), label: 'No date' },
  { re: /^mine$/, set: (q) => (q.side = 'mine'), label: 'Mine' },
  { re: /^ours$/, set: (q) => (q.side = 'ours'), label: 'Ours' },
  { re: /^done$/, set: (q) => (q.done = true), label: 'Done too' },
];

/**
 * What was typed in search, read: "#name" a tag (its start is enough), the words urgent,
 * overdue, today, tomorrow, this week, next week, no date, mine, ours and done, and the rest
 * words to find. Returns the query and the parts it understood (to show as chips).
 */
export function parseSearch(hub: Hub, raw: string): { query: TaskQuery; parts: Array<{ token: string; label: string; kind: 'tag' | 'word' }> } {
  const query: TaskQuery = {};
  const parts: Array<{ token: string; label: string; kind: 'tag' | 'word' }> = [];
  const rest: string[] = [];
  // Two-word keywords first ("this week", "next week", "no date").
  const tokens = raw.trim().replace(/\b(this|next)\s+week\b/gi, (m) => m.replace(/\s+/, '+')).replace(/\bno\s+date\b/gi, (m) => m.replace(/\s+/, '+')).split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const t = tok.replace(/\+/g, ' ');
    if (t.startsWith('#') && t.length > 1) {
      // Spaces don't matter (#fruitandveg, #fruit&veg for "Fruit & Veg"); the start is enough.
      const flat = (x: string) => fold(x).replace(/\s+/g, '');
      const name = flat(t.slice(1));
      const tag = hub.tags().find((x) => flat(x.name) === name) ?? hub.tags().find((x) => flat(x.name).startsWith(name));
      if (tag) {
        query.tags = [...(query.tags ?? []), tag.id];
        parts.push({ token: tok, label: `#${tag.name}`, kind: 'tag' });
        continue;
      }
    }
    const kw = KEYWORDS.find((k) => k.re.test(t.toLowerCase()));
    if (kw) {
      kw.set(query);
      parts.push({ token: tok, label: kw.label, kind: 'word' });
      continue;
    }
    rest.push(t);
  }
  if (rest.length) query.text = rest.join(' ');
  return { query, parts };
}

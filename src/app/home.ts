import type { Hub } from '../core/actions';
import { addDays, diffDays, fromDateStr, humanDate, today as todayStr, weekdayName } from '../core/dates';
import { onThisDay } from './moments';
import type { HomeSlot, Item, LineColor, List } from '../core/model';
import { keepDormant } from './tabs';
import type { IconName } from './ui/Icon';
import { openCount, type ChoreRow, type ChoresView, type TodayView } from './views';

/**
 * My Today page: a fixed summary, then widgets in my order. Only order and on/off are mine
 * to choose, plus up to 3 pinned projects (DECISIONS #6, HOME §5). Stored on my member record
 * as `home`, so my devices follow. Hidden widgets stay as on:false entries, so a widget shipped
 * later can slot in at its default place without bringing back one I hid.
 */
export const MAX_HOME_PROJECTS = 3;

export type WidgetKey = 'asks' | 'today' | 'week' | 'upcoming' | 'partner' | 'shop' | 'chores';

export const DEFAULT_HOME: readonly HomeSlot[] = [
  { key: 'asks', on: true },
  { key: 'today', on: true },
  { key: 'week', on: true },
  { key: 'upcoming', on: true },
  { key: 'partner', on: true },
  { key: 'shop', on: false },
  { key: 'chores', on: false },
];

export interface WidgetDef {
  title: (hub: Hub) => string;
  icon: IconName;
  /** Only while there are two of us. */
  needsPartner?: boolean;
}

export const WIDGETS: Record<WidgetKey, WidgetDef> = {
  asks: { title: () => 'Waiting on you', icon: 'hand', needsPartner: true },
  today: { title: () => 'Today', icon: 'sun' },
  week: { title: () => 'This week', icon: 'stack' },
  upcoming: { title: () => 'Coming up', icon: 'calendar' },
  partner: { title: (hub) => `${hub.partner()?.name ?? 'Your person'} did`, icon: 'heart', needsPartner: true },
  shop: { title: () => 'To buy', icon: 'basket' },
  // Mine are in Today ("Today wins"), so this one holds my partner's: never anything while solo.
  chores: { title: (hub) => `${hub.partner()?.name ?? 'Your person'}’s chores`, icon: 'broom', needsPartner: true },
};

export const isWidget = (key: string): key is WidgetKey => Object.prototype.hasOwnProperty.call(WIDGETS, key);
export const projectKey = (listId: string) => `l:${listId}`;
export const listIdOf = (key: string): string | null => (key.startsWith('l:') ? key.slice(2) : null);

/** A slot's title: the widget's name, or the pinned project's. */
export function slotTitle(hub: Hub, key: string): string {
  const id = listIdOf(key);
  if (id) return hub.list(id)?.name ?? 'A project';
  return isWidget(key) ? WIDGETS[key].title(hub) : key;
}

/** What I stored, cleaned: known widgets and live projects (at most 3), each once, plus any widget I've never seen. */
export function homeOf(hub: Hub): HomeSlot[] {
  const raw = hub.me()?.home;
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_HOME.map((s) => ({ ...s }));
  const lists = new Set(hub.lists().map((l) => l.id));
  const seen = new Set<string>();
  const out: HomeSlot[] = [];
  let pins = 0;
  for (const s of raw) {
    if (!s || typeof s.key !== 'string' || seen.has(s.key)) continue;
    const id = listIdOf(s.key);
    if (id) {
      // Deleted, archived, or now out of my sight (made Only me by the partner).
      if (!lists.has(id) || pins >= MAX_HOME_PROJECTS) continue;
      pins++;
    } else if (!isWidget(s.key)) continue; // from an older or newer build
    seen.add(s.key);
    out.push({ key: s.key, on: s.on !== false });
  }
  // Widgets added in a later version go in after their predecessor, as the defaults have them.
  DEFAULT_HOME.forEach((d, i) => {
    if (seen.has(d.key)) return;
    const prev = DEFAULT_HOME.slice(0, i)
      .reverse()
      .find((p) => seen.has(p.key));
    out.splice(prev ? out.findIndex((s) => s.key === prev.key) + 1 : 0, 0, { ...d });
    seen.add(d.key);
  });
  return out;
}

const available = (hub: Hub, s: HomeSlot) => !isWidget(s.key) || !WIDGETS[s.key].needsPartner || !!hub.partner();

/** What Today draws, in order: on, and not waiting for a partner who isn't here. */
export function visibleHome(hub: Hub): HomeSlot[] {
  return homeOf(hub).filter((s) => s.on && available(hub, s));
}

/** Widgets I could bring back (the tray), in their stored order. */
export function hiddenWidgets(hub: Hub): WidgetKey[] {
  return homeOf(hub)
    .filter((s) => !s.on && isWidget(s.key) && available(hub, s))
    .map((s) => s.key as WidgetKey);
}

export function pinnedProjects(hub: Hub): string[] {
  return homeOf(hub)
    .map((s) => listIdOf(s.key))
    .filter((id): id is string => !!id);
}

/**
 * Write my Today page. Pins to projects that are only out of sight for now (archived) stay
 * stored, while there's room for them: a project pinned into a freed slot takes it for good,
 * so a restore never pushes a newer pin off.
 */
export function setHome(hub: Hub, slots: readonly HomeSlot[]): void {
  const raw = (hub.me()?.home ?? []).filter((s): s is HomeSlot => !!s && typeof s.key === 'string');
  const kept = keepDormant(raw, slots, (s) => s.key, (s) => {
    const id = listIdOf(s.key);
    return !!id && hub.listDormant(id);
  });
  const chosen = new Set(slots.map((s) => s.key));
  let over = kept.filter((s) => listIdOf(s.key)).length - MAX_HOME_PROJECTS;
  const next = kept.filter((s) => chosen.has(s.key) || !listIdOf(s.key) || over-- <= 0);
  hub.upsertMember(hub.meId, { home: next.map((s) => ({ key: s.key, on: s.on !== false })) });
}

/** "Back to the default": really the default, archived pins and all. Undo puts back what was stored. */
export function resetHome(hub: Hub): () => void {
  const raw = hub.me()?.home;
  hub.upsertMember(hub.meId, { home: DEFAULT_HOME.map((s) => ({ ...s })) });
  return () => hub.upsertMember(hub.meId, { home: raw });
}

export function isDefaultHome(hub: Hub): boolean {
  const now = homeOf(hub);
  return now.length === DEFAULT_HOME.length && now.every((s, i) => s.key === DEFAULT_HOME[i].key && s.on === DEFAULT_HOME[i].on);
}

/** A new order for what's visible; hidden and unavailable entries keep their places. One write. */
export function reorderHome(hub: Hub, visibleKeys: readonly string[]): void {
  const all = homeOf(hub);
  const shown = new Set(visibleHome(hub).map((s) => s.key));
  const next = visibleKeys.filter((k) => shown.has(k));
  if (next.length !== shown.size || new Set(next).size !== next.length) return; // not a reorder of what's shown
  let k = 0;
  setHome(
    hub,
    all.map((s) => (shown.has(s.key) ? { key: next[k++], on: true } : s)),
  );
}

/** Hide a widget (it stays, off) or unpin a project (it goes). */
export function hideHome(hub: Hub, key: string): void {
  const all = homeOf(hub);
  setHome(hub, listIdOf(key) ? all.filter((s) => s.key !== key) : all.map((s) => (s.key === key ? { ...s, on: false } : s)));
}

/** Bring a widget back, or pin a project: it goes right after the last visible block. Returns whether it's shown now. */
export function showHome(hub: Hub, key: string): boolean {
  const all = homeOf(hub);
  const id = listIdOf(key);
  if (id) {
    if (!hub.lists().some((l) => l.id === id)) return false;
    if (!all.some((s) => s.key === key) && pinnedProjects(hub).length >= MAX_HOME_PROJECTS) return false;
  } else if (!isWidget(key)) return false;
  const shown = new Set(visibleHome(hub).map((s) => s.key));
  const rest = all.filter((s) => s.key !== key);
  let at = 0;
  rest.forEach((s, i) => {
    if (shown.has(s.key)) at = i + 1;
  });
  rest.splice(at, 0, { key, on: true });
  setHome(hub, rest);
  return visibleHome(hub).some((s) => s.key === key);
}

// ---------------------------------------------------------------- what the blocks show

/** The summary: how many things today, and which projects (and person) they're in. */
export function summaryOf(hub: Hub, v: TodayView): { n: number; mood: 'busy' | 'done' | 'free'; lists: List[]; person: boolean } {
  // An ask with a date counts on its day (it moves into today or earlier then), not before.
  const askedNow = v.asked.filter((i) => !i.due);
  const counted: Item[] = [...v.today, ...v.earlier, ...v.awaitingOk, ...askedNow];
  const n = counted.length;
  const person = !!hub.partner() && v.awaitingOk.length + v.asked.length > 0;
  const tally = new Map<string, number>();
  for (const i of counted) tally.set(i.listId, (tally.get(i.listId) ?? 0) + 1);
  const lists = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => hub.list(id))
    .filter((l): l is List => !!l)
    .slice(0, person ? 2 : 3);
  return { n, mood: n ? 'busy' : v.doneToday ? 'done' : 'free', lists, person };
}

export const things = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'}`;

export interface WeekBand {
  key: 'shop' | 'chores' | 'done' | 'moments';
  color: LineColor;
  /** The big figure: a count, or a feeling. */
  num: number | string;
  label: string;
}

/** Done this week (tasks, chores, shopping trips), and the week before, for "more than last week". */
export function weekCounts(hub: Hub, now = Date.now()): { week: number; last: number } {
  const day = 86_400_000;
  const kinds = new Map(hub.lists().map((l) => [l.id, l.kind]));
  const at = [
    ...hub.store.all('log').map((l) => l.at),
    ...hub.store
      .all('item')
      .filter((i) => i.done && i.doneAt && !i.repeat && kinds.get(i.listId) !== 'shopping')
      .map((i) => i.doneAt!),
  ];
  return { week: at.filter((t) => t > now - 7 * day).length, last: at.filter((t) => t > now - 14 * day && t <= now - 7 * day).length };
}

/** Chores ready now, minus what Today already shows (so: my partner's). Nothing while we're away. */
export function choresReady(hub: Hub, v: TodayView, chores: ChoresView): ChoreRow[] {
  if (hub.isAway()) return [];
  const onToday = new Set([...v.today, ...v.earlier].map((i) => i.id));
  return chores.now.filter((r) => !onToday.has(r.item.id));
}

/**
 * This week's strips, each only when non-zero, and never twice on the page: the To buy and
 * Chores ready widgets take over their strip when they're on.
 */
export function weekBands(hub: Hub, v: TodayView, chores: ChoresView, shown: ReadonlySet<string> = new Set(visibleHome(hub).map((s) => s.key))): WeekBand[] {
  const out: WeekBand[] = [];
  if (v.shopping.count && !shown.has('shop')) out.push({ key: 'shop', color: 'lemon', num: v.shopping.count, label: 'to buy' });
  // The same "ready" the Chores widget shows: not what Today already lists.
  const ready = choresReady(hub, v, chores).length;
  if (ready && !shown.has('chores')) out.push({ key: 'chores', color: 'pink', num: ready, label: `${ready === 1 ? 'chore' : 'chores'} ready for ${hub.partner()?.name ?? 'them'}` });
  // How the week went, against the one before.
  const { week, last } = weekCounts(hub);
  if (week) {
    const diff = week - last;
    const vs = !last ? '' : diff > 0 ? ` · ${diff} more than last week` : diff < 0 ? ` · ${-diff} fewer than last week` : ' · same as last week';
    out.push({ key: 'done', color: 'lilac', num: week, label: `${hub.partner() ? 'done together' : 'done'} this week${vs}` });
  }
  // Moments: the good bits. A year (or a month) ago today first; else this week's; else an invitation.
  const moments = hub.moments();
  const today = todayStr();
  const back = onThisDay(moments, today);
  const thisWeek = moments.filter((m) => m.day > addDays(today, -7));
  if (back) out.push({ key: 'moments', color: 'mint', num: back.moment.feel, label: `${back.ago}: ${back.moment.text}` });
  else if (thisWeek.length) out.push({ key: 'moments', color: 'mint', num: thisWeek[0].feel, label: thisWeek.length > 1 ? `${thisWeek[0].text} · and ${thisWeek.length - 1} more` : thisWeek[0].text });
  else out.push({ key: 'moments', color: 'mint', num: '+', label: moments.length ? 'Keep a moment from this week' : 'Keep a moment, to look back on' });
  return out;
}

/** Coming up, as tiles: the next 7 days, flat (Today draws at most AHEAD_MAX). */
export const AHEAD_MAX = 12;
export function aheadOf(v: TodayView): Item[] {
  return v.upcoming.flatMap((g) => g.items);
}

/** A tile's day, short enough to share a line with a time: "Tomorrow", "Fri", "Wed 2 Dec". */
export function aheadDay(due: string, ref: string): string {
  const delta = diffDays(ref, due);
  return delta > 1 && delta < 7 ? weekdayName(fromDateStr(due).getDay()) : humanDate(due, ref);
}

/** The one-line live preview under a slot in the editor, or why it's empty right now. */
export function homePreview(key: string, hub: Hub, v: TodayView, chores: ChoresView): { text: string; empty: boolean } {
  const p = hub.partner()?.name ?? 'your person';
  const join = (parts: Array<string | false>, empty: string) => {
    const t = parts.filter(Boolean).join(' · ');
    return t ? { text: t, empty: false } : { text: empty, empty: true };
  };
  const id = listIdOf(key);
  if (id) {
    const n = openCount(hub, id);
    return join([n > 0 && `${n} open`], 'Nothing open');
  }
  switch (key) {
    case 'asks': {
      const mine = v.awaitingOk.length + v.asked.length;
      const asked = v.outgoing.length;
      const did = v.waitingTheirOk.length;
      return join([mine > 0 && `${mine} for you`, asked > 0 && `${asked} you asked ${p}`, did > 0 && `${did} waiting for ${p}’s OK`], `${p}’s asks and OKs show up here`);
    }
    case 'today':
      return join([v.today.length > 0 && `${v.today.length} today`, v.earlier.length > 0 && `${v.earlier.length} from earlier`], 'Nothing due today');
    case 'week': {
      const bands = weekBands(hub, v, chores);
      const short = (b: WeekBand) => (b.key === 'shop' ? `${b.num} to buy` : b.key === 'chores' ? `${b.num} ${b.num === 1 ? 'chore' : 'chores'}` : `${b.num} done`);
      return join(bands.map(short), 'Shows up when there’s something');
    }
    case 'upcoming': {
      const n = aheadOf(v).length;
      return join([n > 0 && `${n} in the next 7 days`], 'Nothing in the next 7 days');
    }
    case 'partner':
      return join([v.recent.length > 0 && `${v.recent.length} since yesterday`], `Shows what ${p} finishes`);
    case 'shop':
      return join([v.shopping.count > 0 && `${v.shopping.count} to buy`, v.shopping.urgent > 0 && `${v.shopping.urgent} urgent`], 'Nothing to buy');
    case 'chores': {
      if (hub.isAway()) return { text: 'Paused while you’re away', empty: true };
      const n = choresReady(hub, v, chores).length;
      return join([n > 0 && `${n} ready for ${p}`], `${p}’s ready chores show up here`);
    }
    default:
      return { text: '', empty: true };
  }
}

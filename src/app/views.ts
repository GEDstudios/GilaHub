import type { Hub } from '../core/actions';
import { addDays, diffDays, fromDateStr, today as todayStr } from '../core/dates';
import type { Idea, Item, List, LogEntry } from '../core/model';
import { byOrder } from '../core/order';
import type { Flavor } from '../smart/categorize';
import { itemKey } from '../smart/normalize';
import { freshness, periodDays, type Freshness } from '../smart/recurrence';
import { buyAgain, purchaseStats, type BuyAgainSuggestion, type PurchaseStats } from '../smart/suggest';

/** Cache a derived view per store version (and args). */
function memo<A extends unknown[], R>(fn: (hub: Hub, ...args: A) => R): (hub: Hub, ...args: A) => R {
  let lastV = -1;
  let lastHub: Hub | null = null;
  const cache = new Map<string, R>();
  return (hub, ...args) => {
    if (hub !== lastHub || hub.store.version !== lastV) {
      cache.clear();
      lastV = hub.store.version;
      lastHub = hub;
    }
    const key = JSON.stringify(args);
    if (!cache.has(key)) cache.set(key, fn(hub, ...args));
    return cache.get(key)!;
  };
}

const byUrgentThenTime = (a: Item, b: Item) =>
  Number(!!b.urgent) - Number(!!a.urgent) || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') || byOrder(a, b);

/** Is this mine to do (or ours)? Partner's own things stay out of my Today, unless they asked me. */
export function isForMe(hub: Hub, item: Item): boolean {
  if (item.assignee === hub.meId) return true;
  const owner = hub.ownerOf(item);
  if (owner && owner !== hub.meId) return false;
  if (item.assignee === 'turns') return !item.turn || item.turn === hub.meId;
  if (item.assignee && item.assignee !== 'both' && item.assignee !== hub.meId) return false;
  return true;
}

// ---------------------------------------------------------------- Today

export interface TodayView {
  today: Item[];
  earlier: Item[];
  upcoming: Array<{ date: string; items: Item[] }>;
  /** What's on the shopping lists: `preview` is the first 4, urgent first, then newest. */
  shopping: { count: number; urgent: number; lists: List[]; preview: Item[] };
  together: number;
  recent: Array<{ log?: LogEntry; item: Item; by: string; at: number }>;
  dueCount: number;
  /** My requests my partner says are done — waiting for my OK. */
  awaitingOk: Item[];
  /** My partner's asks for me that aren't already in today/earlier: undated or later. */
  asked: Item[];
  /** What I asked my partner to do, still open. */
  outgoing: Item[];
  /** I did my partner's ask; waiting for their OK. */
  waitingTheirOk: Item[];
  /** My completions today (ticked things and repeating ones). */
  doneToday: number;
}

const byDueThenTime = (a: Item, b: Item) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || byUrgentThenTime(a, b);

export const todayView = memo((hub: Hub, ref: string): TodayView => {
  const lists = new Map(hub.lists().map((l) => [l.id, l]));
  const away = hub.isAway();
  const open = hub.store.all('item').filter((i) => {
    const l = lists.get(i.listId);
    if (away && l?.kind === 'chores') return false;
    return l && l.kind !== 'shopping' && !i.done && !i.archived && !i.someday && !i.paused && !i.submittedAt && i.due;
  });
  const mine = open.filter((i) => isForMe(hub, i));
  const todayAll = mine.filter((i) => i.due === ref).sort(byUrgentThenTime);
  const earlierAll = mine.filter((i) => i.due! < ref).sort((a, b) => a.due!.localeCompare(b.due!) || byUrgentThenTime(a, b));
  // Requests between us: one-off things in task projects (not chores, not shopping).
  const partnerId = hub.partner()?.id;
  const items = hub.store.all('item');
  const live = (i: Item) => {
    const l = lists.get(i.listId);
    return !!l && !i.done && !i.archived && !i.someday && !i.repeat && l.kind !== 'shopping';
  };
  const asked = partnerId
    ? items
        .filter(
          (i) =>
            live(i) &&
            !i.submittedAt &&
            isForMe(hub, i) &&
            (i.requestedBy === partnerId || (i.owner === hub.meId && i.createdBy === partnerId && !i.requestedBy)),
        )
        .sort(byDueThenTime)
    : [];
  // Everything I'm asked waits in one place, "Waiting on you", whatever its date: not twice.
  const askedIds = new Set(asked.map((i) => i.id));
  const today = todayAll.filter((i) => !askedIds.has(i.id));
  const earlier = earlierAll.filter((i) => !askedIds.has(i.id));
  const outgoing = partnerId
    ? items.filter((i) => live(i) && !i.submittedAt && i.requestedBy === hub.meId && i.assignee === partnerId).sort(byDueThenTime)
    : [];
  const waitingTheirOk = partnerId
    ? items
        .filter((i) => !i.done && !i.archived && lists.has(i.listId) && i.submittedAt && i.submittedBy === hub.meId && i.requestedBy === partnerId)
        .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0))
    : [];

  const end = addDays(ref, 7);
  const upcomingMap = new Map<string, Item[]>();
  for (const i of mine) {
    if (lists.get(i.listId)?.kind === 'chores' || askedIds.has(i.id)) continue;
    if (i.due! > ref && i.due! <= end) {
      const arr = upcomingMap.get(i.due!) ?? [];
      arr.push(i);
      upcomingMap.set(i.due!, arr);
    }
  }
  const upcoming = [...upcomingMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({ date, items: items.sort(byUrgentThenTime) }));

  const shopLists = hub.shoppingLists();
  const shopIds = new Set(shopLists.map((l) => l.id));
  const shopOpen = hub.store
    .all('item')
    .filter((i) => shopIds.has(i.listId) && !i.done && !i.archived && !i.parentId)
    .sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const weekAgo = Date.now() - 7 * 86_400_000;
  const logs = hub.store.all('log');
  const doneTasks = hub.store.all('item').filter((i) => i.done && i.doneAt && i.doneAt > weekAgo && lists.get(i.listId)?.kind !== 'shopping');
  const together = logs.filter((l) => l.at > weekAgo).length + doneTasks.length;

  const partner = hub.partner();
  const dayAgo = Date.now() - 36 * 3600_000;
  const recent: TodayView['recent'] = [];
  if (partner) {
    for (const l of logs) {
      if (l.kind !== 'done' || l.by !== partner.id || l.at < dayAgo) continue;
      const item = hub.item(l.itemId);
      if (item) recent.push({ log: l, item, by: l.by, at: l.at });
    }
    for (const i of doneTasks) if (i.doneBy === partner.id && i.doneAt! > dayAgo) recent.push({ item: i, by: partner.id, at: i.doneAt! });
    recent.sort((a, b) => b.at - a.at);
  }

  return {
    today,
    earlier,
    upcoming,
    shopping: {
      count: shopOpen.length,
      urgent: shopOpen.filter((i) => i.urgent).length,
      preview: shopOpen.slice(0, 4),
      lists: shopLists.filter((l) => shopOpen.some((i) => i.listId === l.id)),
    },
    together,
    recent: recent.slice(0, 3),
    dueCount: today.length + earlier.length,
    awaitingOk: items
      .filter((i) => i.submittedAt && !i.done && !i.archived && i.requestedBy === hub.meId && lists.has(i.listId))
      .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0)),
    asked,
    outgoing,
    waitingTheirOk,
    doneToday: doneOn(hub, ref),
  };
});

/** How many things I finished on `day`: ticked tasks plus repeating ones (their 'done' logs). */
function doneOn(hub: Hub, day: string): number {
  const from = fromDateStr(day).getTime();
  const to = fromDateStr(addDays(day, 1)).getTime();
  const within = (t: number | null | undefined) => !!t && t >= from && t < to;
  let n = 0;
  for (const i of hub.store.all('item')) {
    if (i.done && i.doneBy === hub.meId && within(i.doneAt) && hub.list(i.listId)?.kind !== 'shopping') n++;
  }
  for (const l of hub.store.all('log')) if (l.kind === 'done' && l.by === hub.meId && within(l.at)) n++;
  return n;
}

// ---------------------------------------------------------------- Shopping

export interface AisleGroup {
  key: string;
  flavor: Flavor;
  category: string;
  label: string;
  emoji: string;
  items: Array<Item & { emoji: string }>;
}

export interface ShoppingView {
  lists: List[];
  urgent: Array<Item & { emoji: string }>;
  groups: AisleGroup[];
  inCart: Array<Item & { emoji: string }>;
  openCount: number;
  stats: Map<string, PurchaseStats>;
  buyAgain: BuyAgainSuggestion[];
}

export const shoppingView = memo((hub: Hub, filter: string, dismissed: Record<string, number>): ShoppingView => {
  const all = hub.shoppingLists();
  // 'all', or the ids of the lists to show, comma-separated.
  const wanted = new Set(filter.split(','));
  const lists = filter === 'all' ? all : all.filter((l) => wanted.has(l.id));
  const ids = new Set(lists.map((l) => l.id));
  const items = hub.store.all('item').filter((i) => ids.has(i.listId) && !i.parentId);
  const withEmoji = (i: Item) => ({ ...i, emoji: hub.categoryFor(i).emoji });
  const open = items.filter((i) => !i.done && !i.archived);
  const groups = new Map<string, AisleGroup>();
  for (const i of open) {
    const list = hub.list(i.listId);
    const flavor = hub.flavorOf(list);
    const { category, emoji } = hub.categoryFor(i);
    const key = `${flavor}:${category}`;
    let g = groups.get(key);
    if (!g) {
      const meta = hub.aisleMeta(flavor, category);
      g = { key, flavor, category, label: meta.name, emoji: meta.emoji, items: [] };
      groups.set(key, g);
    }
    g.items.push({ ...i, emoji });
  }
  const orders = { grocery: hub.aisleOrder('grocery'), home: hub.aisleOrder('home') };
  const rank = (g: AisleGroup) => (g.flavor === 'grocery' ? 0 : 1000) + orders[g.flavor].indexOf(g.category);
  const sorted = [...groups.values()].sort((a, b) => rank(a) - rank(b));
  // Where each item sits on the walk through the store: its aisle, then its place in it.
  const walk = new Map<string, number>();
  sorted.forEach((g, at) => {
    g.items.sort(byOrder);
    g.items.forEach((i, n) => walk.set(i.id, at * 10_000 + n));
  });
  const inCart = items
    .filter((i) => i.done && !i.archived)
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
    .map(withEmoji);

  const logs = hub.store.all('log').filter((l) => l.kind === 'bought' && (!l.listId || ids.has(l.listId)));
  const stats = purchaseStats(logs);
  const onList = new Set(open.map((i) => itemKey(i.title)));
  const suggestions = buyAgain(stats, onList, { isDismissed: (key, lastAt) => dismissed[key] === lastAt });

  return {
    lists,
    // The Urgent card reads in walking order; it has no order of its own (arrange in the aisles).
    urgent: open
      .filter((i) => i.urgent)
      .sort((a, b) => (walk.get(a.id) ?? 0) - (walk.get(b.id) ?? 0))
      .map(withEmoji),
    groups: sorted,
    inCart,
    openCount: open.length,
    stats,
    buyAgain: suggestions,
  };
});

// ---------------------------------------------------------------- Chores

export interface ChoreRow {
  item: Item;
  list: List;
  fresh: Freshness;
  level: number;
}

export interface ChoresView {
  now: ChoreRow[];
  soon: ChoreRow[];
  fresh: ChoreRow[];
  paused: ChoreRow[];
  lists: List[];
  total: number;
}

export const choresView = memo((hub: Hub, ref: string): ChoresView => {
  const lists = hub.lists().filter((l) => l.kind === 'chores');
  const ids = new Map(lists.map((l) => [l.id, l]));
  const rows: ChoreRow[] = [];
  for (const i of hub.store.all('item')) {
    const list = ids.get(i.listId);
    if (!list || i.parentId || i.archived) continue;
    if (!i.repeat && i.done) continue;
    const fresh = freshness(i.due, ref);
    const period = i.repeat ? periodDays(i.repeat) : 7;
    const level = i.due ? Math.max(0, Math.min(1, diffDays(ref, i.due) / period)) : 1;
    rows.push({ item: i, list, fresh, level });
  }
  const byDue = (a: ChoreRow, b: ChoreRow) => (a.item.due ?? '9999').localeCompare(b.item.due ?? '9999') || byOrder(a.item, b.item);
  const active = rows.filter((r) => !r.item.paused);
  return {
    now: active.filter((r) => r.fresh === 'today' || r.fresh === 'whenever').sort(byDue),
    soon: active.filter((r) => r.fresh === 'soon').sort(byDue),
    fresh: active.filter((r) => r.fresh === 'fresh').sort(byDue),
    paused: rows.filter((r) => r.item.paused).sort(byDue),
    lists,
    total: rows.length,
  };
});

// ---------------------------------------------------------------- Ideas

/**
 * The Ideas sheet: open ideas in our order (never-arranged ones first, newest on top), then
 * the resolved ones, most recently resolved first.
 */
export const ideasView = memo((hub: Hub): { open: Idea[]; resolved: Idea[] } => {
  const all = hub.store.all('idea');
  const place = (i: Idea) => (typeof i.order === 'number' ? i.order : -Infinity);
  return {
    open: all.filter((i) => !i.resolvedAt).sort((a, b) => place(a) - place(b) || b.createdAt - a.createdAt),
    resolved: all.filter((i) => !!i.resolvedAt).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)),
  };
});

/**
 * What my partner did since `seenAt` (when I last opened the sheet on this device): added or
 * edited an idea ('new'), or resolved or reopened one of mine; null when nothing.
 */
export function ideasUnseen(hub: Hub, seenAt: number): 'new' | 'resolved' | 'reopened' | null {
  const all = hub.store.all('idea');
  const theirs = (by: string | null | undefined, at: number | null | undefined) => !!by && by !== hub.meId && (at ?? 0) > seenAt;
  if (all.some((i) => theirs(i.by, i.createdAt) || theirs(i.editedBy, i.editedAt))) return 'new';
  const mine = all.filter((i) => i.by === hub.meId);
  if (mine.some((i) => !!i.resolvedAt && theirs(i.resolvedBy, i.resolvedAt))) return 'resolved';
  if (mine.some((i) => !i.resolvedAt && theirs(i.reopenedBy, i.reopenedAt))) return 'reopened';
  return null;
}

/** The open ideas as a plain Markdown list, "- text (Hila)", to paste somewhere else. */
export function ideasMarkdown(hub: Hub): string {
  return ideasView(hub)
    .open.map((i) => {
      const who = hub.member(i.by)?.name;
      return `- ${i.text.replace(/\s*\n\s*/g, ' ')}${who ? ` (${who})` : ''}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------- Lists

/** The backlog: someday things, out of sight. One project's, or (no id) everything's. */
export function backlogOf(hub: Hub, listId?: string): Item[] {
  const lists = new Set(hub.lists().map((l) => l.id));
  return hub.store
    .all('item')
    .filter((i) => i.someday && !i.done && !i.archived && !i.parentId && lists.has(i.listId) && (!listId || i.listId === listId))
    .sort((a, b) => (b.somedayAt ?? 0) - (a.somedayAt ?? 0));
}

export function openCount(hub: Hub, listId: string): number {
  let n = 0;
  for (const i of hub.store.all('item')) if (i.listId === listId && !i.done && !i.archived && !i.someday && !i.parentId) n++;
  return n;
}

/**
 * A project's count and its words, the way its own tab counts: a chores project says how many
 * are ready ("2 ready", "All fresh"), anything else what's open ("4 open").
 */
export function projectCount(hub: Hub, list: List): { n: number; text: string } {
  if (list.kind === 'chores') {
    const n = choresView(hub, todayStr()).now.filter((r) => r.list.id === list.id).length;
    return { n, text: n ? `${n} ready` : 'All fresh' };
  }
  const n = openCount(hub, list.id);
  return { n, text: n ? `${n} open` : 'All clear' };
}

export function stepProgress(hub: Hub, id: string): { done: number; total: number } {
  const kids = hub.childrenOf(id);
  return { done: kids.filter((k) => k.done).length, total: kids.length };
}

export function todayRef(): string {
  return todayStr();
}

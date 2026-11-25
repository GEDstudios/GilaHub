import type { Hub } from '../core/actions';
import { addDays, diffDays, today as todayStr } from '../core/dates';
import type { Item, List, LogEntry } from '../core/model';
import { byOrder } from '../core/order';
import { categoryMeta, categoryOrder, type Flavor } from '../smart/categorize';
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

/** Is this mine to do (or ours)? Partner's own things stay out of my Today. */
export function isForMe(hub: Hub, item: Item): boolean {
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
  shopping: { count: number; urgent: number; names: string[]; lists: List[] };
  together: number;
  recent: Array<{ log?: LogEntry; item: Item; by: string; at: number }>;
  dueCount: number;
  /** My requests my partner says are done — waiting for my OK. */
  awaitingOk: Item[];
}

export const todayView = memo((hub: Hub, ref: string): TodayView => {
  const lists = new Map(hub.lists().map((l) => [l.id, l]));
  const away = hub.isAway();
  const open = hub.store.all('item').filter((i) => {
    const l = lists.get(i.listId);
    if (away && l?.kind === 'chores') return false;
    return l && l.kind !== 'shopping' && !i.done && !i.archived && !i.paused && !i.submittedAt && i.due;
  });
  const mine = open.filter((i) => isForMe(hub, i));
  const today = mine.filter((i) => i.due === ref).sort(byUrgentThenTime);
  const earlier = mine.filter((i) => i.due! < ref).sort((a, b) => a.due!.localeCompare(b.due!) || byUrgentThenTime(a, b));
  const end = addDays(ref, 7);
  const upcomingMap = new Map<string, Item[]>();
  for (const i of mine) {
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
      names: shopOpen.slice(0, 4).map((i) => i.title),
      lists: shopLists.filter((l) => shopOpen.some((i) => i.listId === l.id)),
    },
    together,
    recent: recent.slice(0, 3),
    dueCount: today.length + earlier.length,
    awaitingOk: hub.store
      .all('item')
      .filter((i) => i.submittedAt && !i.done && !i.archived && i.requestedBy === hub.meId && lists.has(i.listId))
      .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0)),
  };
});

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
  const lists = filter === 'all' ? all : all.filter((l) => l.id === filter);
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
      const meta = categoryMeta(flavor, category);
      g = { key, flavor, category, label: meta.en, emoji: meta.e, items: [] };
      groups.set(key, g);
    }
    g.items.push({ ...i, emoji });
  }
  const rank = (g: AisleGroup) => (g.flavor === 'grocery' ? 0 : 100) + categoryOrder(g.flavor).indexOf(g.category);
  const sorted = [...groups.values()].sort((a, b) => rank(a) - rank(b));
  for (const g of sorted) g.items.sort(byOrder);
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
    urgent: open.filter((i) => i.urgent).sort(byOrder).map(withEmoji),
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

// ---------------------------------------------------------------- Lists

export function openCount(hub: Hub, listId: string): number {
  let n = 0;
  for (const i of hub.store.all('item')) if (i.listId === listId && !i.done && !i.archived && !i.parentId) n++;
  return n;
}

export function stepProgress(hub: Hub, id: string): { done: number; total: number } {
  const kids = hub.childrenOf(id);
  return { done: kids.filter((k) => k.done).length, total: kids.length };
}

export function todayRef(): string {
  return todayStr();
}

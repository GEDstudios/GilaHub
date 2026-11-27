import type { Hub } from '../core/hub';
import { addDays, fromDateStr, today as todayStr } from '../core/dates';
import type { Idea, Item, List, LogEntry } from '../core/model';
import { byOrder } from '../core/order';
import { itemKey } from '../smart/normalize';
import { buyAgain, purchaseStats, type BuyAgainSuggestion } from '../smart/suggest';
import { isOpen, isStocked, isTodo } from '../core/model';
import { listKey } from '../core/keys';

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
  const open = hub.store.all('item').filter((i) => {
    const l = lists.get(i.listId);
    return l && isTodo(i) && !i.paused && !i.submittedAt && i.due;
  });
  const mine = open.filter((i) => isForMe(hub, i));
  const todayAll = mine.filter((i) => i.due === ref).sort(byUrgentThenTime);
  const earlierAll = mine.filter((i) => i.due! < ref).sort((a, b) => a.due!.localeCompare(b.due!) || byUrgentThenTime(a, b));
  // Requests between us: one-off things (not repeating ones).
  const partnerId = hub.partner()?.id;
  const items = hub.store.all('item');
  const live = (i: Item) => {
    const l = lists.get(i.listId);
    return !!l && isTodo(i) && !i.repeat;
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
        .filter((i) => isOpen(i) && lists.has(i.listId) && i.submittedAt && i.submittedBy === hub.meId && i.requestedBy === partnerId)
        .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0))
    : [];

  const end = addDays(ref, 7);
  const upcomingMap = new Map<string, Item[]>();
  for (const i of mine) {
    if (askedIds.has(i.id)) continue;
    if (i.due! > ref && i.due! <= end) {
      const arr = upcomingMap.get(i.due!) ?? [];
      arr.push(i);
      upcomingMap.set(i.due!, arr);
    }
  }
  const upcoming = [...upcomingMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({ date, items: items.sort(byUrgentThenTime) }));

  const weekAgo = Date.now() - 7 * 86_400_000;
  const logs = hub.store.all('log');
  const doneTasks = hub.store.all('item').filter((i) => i.done && i.doneAt && i.doneAt > weekAgo && lists.has(i.listId));

  const partner = hub.partner();
  const dayAgo = Date.now() - 36 * 3600_000;
  const recent: TodayView['recent'] = [];
  if (partner) {
    for (const l of logs) {
      if (l.kind !== 'done' || l.by !== partner.id || l.at < dayAgo) continue;
      const item = hub.item(l.itemId);
      if (item) recent.push({ log: l, item, by: l.by, at: l.at });
    }
    for (const i of doneTasks) if (i.doneBy === partner.id && i.doneAt! > dayAgo) recent.push({ log: hub.store.get('log', i.logId) ?? undefined, item: i, by: partner.id, at: i.doneAt! });
    recent.sort((a, b) => b.at - a.at);
  }

  return {
    today,
    earlier,
    upcoming,
    recent: recent.slice(0, 3),
    dueCount: today.length + earlier.length,
    awaitingOk: items
      .filter((i) => i.submittedAt && isOpen(i) && i.requestedBy === hub.meId && lists.has(i.listId))
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
    if (i.done && i.doneBy === hub.meId && within(i.doneAt) && !i.logId) n++;
  }
  for (const l of hub.store.all('log')) if (l.by === hub.meId && within(l.at)) n++;
  return n;
}

// ---------------------------------------------------------------- a folder

/** A part of a folder's page: one tag's things (an aisle), one inner folder's, or all of them. */
export interface FolderGroup {
  key: string;
  /** Grouped by tag: the tag (null: the untagged). */
  tag?: string | null;
  /** Grouped by folder: which one. */
  listId?: string;
  label: string | null;
  /** The tag's icon ("i:…", "x:…" or an emoji). */
  icon?: string | null;
  items: Item[];
}

interface FolderView {
  /** The folder, and the folders inside it when they're shown too. */
  lists: List[];
  open: Item[];
  /** Kept-stocked things with enough in: not tasks, in their own section at the foot. */
  stocked: Item[];
  /** Urgent ones, in the page's order (by tag: the walk through the store). */
  urgent: Item[];
  groups: FolderGroup[];
  /** Just done: ticked, not cleared yet. Newest first. */
  tray: Item[];
  /** Done and cleared, newest first. */
  cleared: Item[];
  /** Again? Things done here before, about due again. */
  again: BuyAgainSuggestion[];
}

/** A folder and everything inside it. */
function shopTree(hub: Hub, id: string): List[] {
  const l = hub.list(id);
  return l ? [l, ...hub.nestedLists(id)] : [];
}

/**
 * One folder's page, whatever's in it: its top-level things (and those of the folders inside,
 * with `inside`), grouped by tag (in our order, the untagged last), by folder, or not at all;
 * the tray of things just done; Again?.
 */
export const folderView = memo((hub: Hub, listId: string, inside: boolean, view: string, dismissed: Record<string, number>): FolderView => {
  const own = inside ? shopTree(hub, listId) : shopTree(hub, listId).slice(0, 1);
  // Folders it shows too (one way): their tasks are here, each in its own group.
  const lists = [...own, ...hub.shownIn(listId).filter((l) => !own.some((o) => o.id === l.id))];
  const ids = new Set(lists.map((l) => l.id));
  const items = hub.store.all('item').filter((i) => ids.has(i.listId) && !i.parentId);
  const open = items.filter(isTodo);
  const groups: FolderGroup[] = [];
  if (view === 'tags') {
    const rank = new Map(hub.tags().map((t, n) => [t.id, n]));
    const byKey = new Map<string, FolderGroup>();
    for (const i of open) {
      const tag = hub.tagsOf(i).sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9))[0] ?? null;
      const key = tag ?? 'none';
      let g = byKey.get(key);
      if (!g) {
        const t = hub.tag(tag);
        g = { key, tag, label: t?.name ?? 'No tag', icon: t ? (t.icon ?? null) : null, items: [] };
        byKey.set(key, g);
      }
      g.items.push(i);
    }
    const at = (g: FolderGroup) => (g.tag ? (rank.get(g.tag) ?? 1e9) : 2e9);
    groups.push(...[...byKey.values()].sort((a, b) => at(a) - at(b)));
  } else if (lists.length > 1) {
    for (const l of lists) groups.push({ key: listKey(l.id), listId: l.id, label: l.id === listId ? null : l.name, items: open.filter((i) => i.listId === l.id) });
  } else {
    groups.push({ key: 'all', label: null, items: open });
  }
  for (const g of groups) g.items.sort(byOrder);
  const walk = new Map<string, number>();
  groups.forEach((g, at) => g.items.forEach((i, n) => walk.set(i.id, at * 10_000 + n)));

  const logs = hub.store.all('log').filter((l) => l.kind === 'bought' && (!l.listId || ids.has(l.listId)));
  const onList = new Set(open.map((i) => itemKey(i.title)));
  return {
    lists,
    open,
    stocked: items.filter((i) => isOpen(i) && isStocked(i)).sort(byOrder),
    urgent: open.filter((i) => i.urgent).sort((a, b) => (walk.get(a.id) ?? 0) - (walk.get(b.id) ?? 0)),
    groups: groups.filter((g) => g.items.length || g.listId === listId),
    tray: items.filter((i) => i.done && !i.archived).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)),
    cleared: items
      .filter((i) => i.done && i.archived)
      .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
      .slice(0, 40),
    again: buyAgain(purchaseStats(logs), onList, { isDismissed: (key, lastAt) => dismissed[key] === lastAt }),
  };
});

// ---------------------------------------------------------------- Chores


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

export function openCount(hub: Hub, listId: string): number {
  let n = 0;
  for (const i of hub.store.all('item')) if (i.listId === listId && isTodo(i) && !i.parentId) n++;
  return n;
}

/**
 * A folder's count and its words: what's open in it and in the folders inside it ("4 open").
 */
export function folderCount(hub: Hub, list: List): { n: number; text: string } {
  const n = [list, ...hub.nestedLists(list.id)].reduce((sum, l) => sum + openCount(hub, l.id), 0);
  if (n) return { n, text: `${n} open` };
  // Nothing open: all clear when things were done here, empty when nothing ever was.
  const ids = new Set(hub.treeIds(list.id));
  const any = hub.store.all('item').some((i) => ids.has(i.listId) && !i.parentId);
  return { n, text: any ? 'All clear' : 'Empty' };
}

export function stepProgress(hub: Hub, id: string): { done: number; total: number } {
  const kids = hub.childrenOf(id);
  return { done: kids.filter((k) => k.done).length, total: kids.length };
}

export function todayRef(): string {
  return todayStr();
}

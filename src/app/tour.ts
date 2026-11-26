import type { Hub } from '../core/actions';
import { today as todayStr } from '../core/dates';
import type { Item, List } from '../core/model';

/**
 * "Start here": the way in is a small project of your own (Only me, so your person never sees
 * it) whose things say what to do with them. You learn by doing each one: the circle ticks,
 * the task opens, the row moves, + adds. Most tick themselves off the moment you've done it.
 * When all are done the project bows out. Settings > About > "Show me around" brings it back.
 */
export const TOUR_NAME = 'Start here';

export type TourKey = 'tick' | 'open' | 'add' | 'share' | 'drag' | 'bar' | 'person';

interface TourStep {
  key: TourKey;
  title: (p: string | null) => string;
  /** On Today as well (dated today), so the first screen already teaches. */
  today?: boolean;
  notes?: (p: string | null) => string;
  steps?: string[];
}

const STEPS: TourStep[] = [
  { key: 'tick', title: () => 'Tick this circle', today: true },
  {
    key: 'open',
    title: () => 'Tap me to open me',
    today: true,
    notes: () => 'Everything opens like this. Change the date, the notification, who does it, right here under the title.',
    steps: ['Subtasks live inside a task', 'Tick them off one by one'],
  },
  { key: 'add', title: () => 'Add something of yours with the black +', today: true },
  {
    key: 'share',
    title: () => 'Ours, Mine or Private?',
    notes: (p) =>
      `Ours: ${p ?? 'your person'} and you both see it and change it.\n` +
      `Mine: it's yours. ${p ?? 'Your person'} can see it and help.\n` +
      `Private: ${p ?? 'your person'} never sees it, not even that it's there.\n` +
      `Ask ${p ?? 'your person'}: pick them under Who and it lands on their Today.`,
  },
  { key: 'bar', title: () => 'Hold the bottom bar and slide' },
  { key: 'person', title: () => 'Bring your person in' },
  // Last, so moving it is the lesson.
  { key: 'drag', title: () => 'Hold me, then drag me up' },
];

export function tourList(hub: Hub): List | undefined {
  return hub.lists().find((l) => l.name === TOUR_NAME && l.kind === 'tasks' && l.visibility === 'private' && l.owner === hub.meId);
}

const titleOf = (hub: Hub, key: TourKey) => STEPS.find((s) => s.key === key)!.title(hub.partner()?.name ?? null);

export function tourItem(hub: Hub, key: TourKey): Item | undefined {
  const list = tourList(hub);
  if (!list) return undefined;
  const t = titleOf(hub, key);
  return hub.children(list.id, null).find((i) => i.title === t);
}

/** Make (or remake) the Start here project. Returns its id. */
export function startTour(hub: Hub): string {
  const old = tourList(hub);
  if (old) {
    hub.updateList(old.id, { archived: false });
    return old.id;
  }
  const p = hub.partner()?.name ?? null;
  return hub.store.batch(() => {
    const id = hub.createList({ name: TOUR_NAME, kind: 'tasks', visibility: 'private', color: 'lemon', icon: 'i:sparkle' });
    for (const s of STEPS) {
      if (s.key === 'person' && hub.partner()) continue;
      const item = hub.addItem(id, { title: s.title(p), notes: s.notes?.(p) ?? null, due: s.today ? todayStr() : null });
      for (const st of s.steps ?? []) hub.addItem(id, { title: st, parentId: item });
    }
    return id;
  });
}

/** Tick a step off (once), when it has really been done. */
export function tourDone(hub: Hub, key: TourKey): void {
  const it = tourItem(hub, key);
  if (it && !it.done) hub.toggle(it.id);
}

/** Is this item a "tap me to open me" kind of step? Opening it is doing it. */
export function tourOpened(hub: Hub, item: Item): void {
  const list = tourList(hub);
  if (!list || item.listId !== list.id) return;
  for (const k of ['open', 'share'] as const) if (item.title === titleOf(hub, k)) tourDone(hub, k);
}

/**
 * What the data already shows: something of mine added outside Start here, a partner, the
 * drag step no longer last. Returns true when every step is done (time to bow out).
 */
export function tourWatch(hub: Hub): boolean {
  const list = tourList(hub);
  if (!list || list.archived) return false;
  const since = list.createdAt ?? 0;
  if (hub.store.all('item').some((i) => i.createdBy === hub.meId && i.listId !== list.id && (i.createdAt ?? 0) > since)) tourDone(hub, 'add');
  if (hub.partner()) tourDone(hub, 'person');
  const rows = hub.children(list.id, null);
  const drag = tourItem(hub, 'drag');
  if (drag && rows.length > 1 && rows.at(-1)?.id !== drag.id) tourDone(hub, 'drag');
  return rows.length > 0 && rows.every((i) => i.done);
}

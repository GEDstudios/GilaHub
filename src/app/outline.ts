import type { Hub } from '../core/hub';
import type { Item } from '../core/model';
import { getPrefs, setPrefs } from './prefs';
import { headOf, nextRow, type GapAt } from './ui/dropMark';
import { DIST } from './ui/tokens';

/**
 * Where a dragged task or subtask lands among rows, outliner style, read from what the hand is over
 * (rows part as it moves, so it's read from where they are now; over the gap itself, nothing
 * changes). Every drag of tasks and subtasks asks this, so they all place things the same way:
 *
 * ("Pulled" is sideways from where the drag began; on the gap itself, pulled right puts it under
 * the row above the gap, pulled left takes it out of the task it's in.)
 *
 *   a subtask's upper or lower half     before or after it, among its sisters (any task's: a task
 *                                       dragged here becomes a subtask, right there)
 *   …pulled right (DIST.nest)           under that subtask, at the end
 *   …its own sister, pulled left        out: its own task, right after the one it was under
 *   a task's middle                     under it, at the end of its subtasks (folded ones unfold
 *                                       after a moment, so it can go among them)
 *   …pulled right, on a task            under it, or under the one above (its upper half)
 *   a task's lower edge, unfolded       its first subtask
 *   a task's top or bottom edge         `among`: between tasks (otherwise the list's own drag does that)
 *   its own task (a subtask's)          upper half: out, above it; lower half: its first subtask
 */
export interface Placement {
  listId: string;
  parentId: string | null;
  /** The one it goes before among its new sisters (null: at the end). */
  before: string | null;
  gap: GapAt;
  /** The task it goes under, which darkens. */
  into?: HTMLElement;
  /** A task with folded subtasks it would go under: unfold it after a moment (Dweller). */
  unfold?: string;
}

interface Point {
  x: number;
  y: number;
}

/**
 * One drag's placer. "Pulled" right or left is counted from where the drag began (`x0`): people
 * drag straight down, so going sideways on purpose is the pull.
 */
export function placer(hub: Hub, opts: { among: boolean }): (item: Item, p: Point, x0: number) => Placement | 'keep' | null {
  // A pull moves the gap and so the rows under the hand: what it chose holds until the hand
  // moves up or down a little (else the row now under the hand would undo it).
  let held: { y: number; pl: Placement } | null = null;
  const hold = (pl: Placement | null, dx: number, y: number) => {
    if (pl && Math.abs(dx) > DIST.nest) held = { y, pl };
    return pl;
  };
  return (item, p, x0) => {
    if (held && Math.abs(p.y - held.y) < 20) return held.pl;
    held = null;
    for (const e of document.elementsFromPoint(p.x, p.y)) {
      if (e.closest('.dragout, .dragwrap')) continue;
      const gap = e.closest('.dropgap');
      if (!gap) continue;
      // On the gap, pulling still works: right, under the one above it; left, out a level.
      const pl = gapPull(hub, item, gap, p.x - x0);
      return pl && !staysPut(hub, item, pl) ? hold(pl, p.x - x0, p.y) : 'keep';
    }
    const at = restRowAt(p);
    if (!at) return null;
    // Its line read where the row is drawn: the hand, moved by what the list's drag moved it by.
    const q = { x: p.x, y: p.y + at.shift };
    const pl = rowPlace(hub, item, at.row, q, p.x - x0, opts.among);
    return pl === 'keep' ? pl : pl && !staysPut(hub, item, pl) ? hold(pl, p.x - x0, p.y) : null;
  };
}

/** How far the list's own drag has slid a row (and the rows it's in) up or down, in px. */
function slid(el: HTMLElement): number {
  let dy = 0;
  for (let n: HTMLElement | null = el; n && n.matches('li.row'); n = n.parentElement?.closest<HTMLElement>('li.row') ?? null) {
    const t = getComputedStyle(n).transform;
    if (t !== 'none') dy += new DOMMatrixReadOnly(t).m42;
  }
  return dy;
}

/**
 * The row under the hand where it rests: the list's own drag slides rows out of the way (and the
 * one in the hand into its place), so they're read where they'd be without that, the deepest one
 * (a subtask over its task). Gaps are real room, so they count.
 */
function restRowAt(p: Point): { row: HTMLElement; shift: number } | null {
  let best: { row: HTMLElement; shift: number; depth: number } | null = null;
  for (const row of document.querySelectorAll<HTMLElement>('li.row[data-id]')) {
    if (row.closest('.dragout, .dragwrap')) continue;
    const r = row.getBoundingClientRect();
    if (p.x < r.left || p.x > r.right) continue;
    const shift = slid(row);
    if (p.y < r.top - shift || p.y >= r.bottom - shift) continue;
    // Where it came from: over that, it goes back.
    if (row.matches('.is-ghost, .is-lifted-out')) return null;
    const depth = row.classList.contains('row--nested') ? 1 : 0;
    if (!best || depth > best.depth) best = { row, shift, depth };
  }
  return best && { row: best.row, shift: best.shift };
}

/** Pulled while on the gap: right, under the row just above it; left, out of the task it's in, right after it. */
function gapPull(hub: Hub, item: Item, gap: Element, dx: number): Placement | null {
  if (Math.abs(dx) <= DIST.nest) return null;
  const host = gap.parentElement as HTMLElement;
  if (dx > 0) {
    let prev = gap.previousElementSibling;
    while (prev && !prev.matches('li.row[data-id]')) prev = prev.previousElementSibling;
    const x = prev ? hub.item((prev as HTMLElement).dataset.id) : undefined;
    if (!x || !prev || x.id === item.id || x.done || !hub.canEdit(x) || hub.isUnder(x.id, item.id)) return null;
    const kids = prev.querySelector<HTMLElement>(':scope > .rows--sub');
    return { listId: x.listId, parentId: x.id, before: null, into: prev as HTMLElement, gap: kids ? { host: kids, before: null } : { host: prev as HTMLElement, before: null } };
  }
  // The task it's in: the one whose subtasks these are, or the one it's inside.
  const taskRow = host.matches('li.row[data-id]') ? host : host.closest<HTMLElement>('li.row[data-id]');
  const task = taskRow ? hub.item(taskRow.dataset.id) : undefined;
  if (!task || !taskRow) return null;
  const sis = hub.siblings(task.listId, task.parentId ?? null).filter((s) => s.id !== item.id);
  return {
    listId: task.listId,
    parentId: task.parentId ?? null,
    before: sis[sis.findIndex((s) => s.id === task.id) + 1]?.id ?? null,
    gap: { host: taskRow.parentElement as HTMLElement, before: nextRow(taskRow) },
  };
}

/** Where it is now: no gap for that (where it came from is already marked). */
function staysPut(hub: Hub, item: Item, pl: Placement): boolean {
  if (pl.parentId !== (item.parentId ?? null) || pl.listId !== item.listId) return false;
  const sis = hub.siblings(item.listId, item.parentId ?? null);
  const next = sis[sis.findIndex((s) => s.id === item.id) + 1]?.id ?? null;
  return pl.before === item.id || pl.before === next;
}

function rowPlace(hub: Hub, item: Item, row: HTMLElement, p: Point, dx: number, among: boolean): Placement | 'keep' | null {
  const at = hub.item(row.dataset.id);
  if (!at || at.id === item.id || hub.isUnder(at.id, item.id)) return null;
  const list = row.parentElement as HTMLElement;
  const subs = row.querySelector<HTMLElement>(':scope > .rows--sub');
  /** The one after `x` among its sisters (not counting the one in the hand). */
  const after = (x: Item) => {
    const sis = hub.siblings(x.listId, x.parentId ?? null).filter((s) => s.id !== item.id);
    return sis[sis.findIndex((s) => s.id === x.id) + 1]?.id ?? null;
  };
  const before = (x: Item, el: HTMLElement): Placement => ({ listId: x.listId, parentId: x.parentId ?? null, before: x.id, gap: { host: list, before: el } });
  const behind = (x: Item, el: HTMLElement): Placement => ({ listId: x.listId, parentId: x.parentId ?? null, before: after(x), gap: { host: el.parentElement as HTMLElement, before: nextRow(el) } });
  const canTake = (x: Item) => !x.done && hub.canEdit(x) && !hub.isUnder(x.id, item.id);
  /** Under `x` (its row `el`), at the end: in its unfolded subtasks, or inside it. */
  const under = (x: Item = at, el: HTMLElement = row): Placement | null => {
    if (!canTake(x)) return null;
    const kids = el.querySelector<HTMLElement>(':scope > .rows--sub');
    return {
      listId: x.listId,
      parentId: x.id,
      before: null,
      into: el,
      gap: kids ? { host: kids, before: null } : { host: el, before: null },
      unfold: !kids && !el.classList.contains('row--nested') && hub.childrenOf(x.id).length ? x.id : undefined,
    };
  };
  /** Its first subtask. */
  const first = (): Placement | null => {
    if (!canTake(at)) return null;
    const kids = hub.siblings(at.listId, at.id).filter((s) => s.id !== item.id);
    const el = subs?.querySelector(`:scope > li.row[data-id="${kids[0]?.id}"]`) ?? null;
    return { listId: at.listId, parentId: at.id, before: kids[0]?.id ?? null, into: row, gap: subs ? { host: subs, before: el } : { host: row, before: null } };
  };

  if (row.classList.contains('row--nested')) {
    if (dx > DIST.nest) return under();
    // A sister pulled left: out from under their task, right after it.
    if (dx < -DIST.nest && at.parentId === item.parentId) {
      const parent = hub.item(at.parentId);
      const pRow = list.closest<HTMLElement>('li.row[data-id]');
      return parent && pRow ? behind(parent, pRow) : null;
    }
    const r = row.getBoundingClientRect();
    return p.y > r.top + r.height / 2 ? behind(at, row) : before(at, row);
  }

  const head = headOf(row);
  // Between its line and its subtasks.
  if (p.y > head.bottom) return 'keep';
  const band = (p.y - head.top) / Math.max(1, head.bottom - head.top);
  // Pulled right, as in most to-do apps: under the task above where it would go.
  if (dx > DIST.nest && at.id !== item.parentId) {
    if (band >= 0.5) return under();
    let prev = row.previousElementSibling;
    while (prev && !prev.matches('li.row[data-id]')) prev = prev.previousElementSibling;
    const above = prev ? hub.item((prev as HTMLElement).dataset.id) : undefined;
    return above && above.id !== item.id ? under(above, prev as HTMLElement) : under();
  }
  if (at.id === item.parentId) return band < 0.5 ? before(at, row) : first();
  if (band < 0.25) return among ? before(at, row) : null;
  if (band > 0.75) return subs ? first() : among ? behind(at, row) : null;
  return under();
}

/**
 * A folded task held over for a moment unfolds, so what's dragged can go among its subtasks.
 * Call it on every aim with the task to unfold (or nothing); `stop` when the drag ends.
 */
export function dweller(ms = 550): { at: (id: string | undefined) => void; stop: () => void } {
  let id: string | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    id = undefined;
  };
  return {
    at: (next) => {
      if (next === id) return;
      stop();
      id = next;
      if (!next) return;
      timer = setTimeout(() => {
        const unf = getPrefs().unfolded;
        if (!unf.includes(next)) setPrefs({ unfolded: [...unf, next].slice(-200) });
      }, ms);
    },
    stop,
  };
}

/** Show where it went: a task it went under opens its subtasks. */
export function unfoldTo(parentId: string | null): void {
  if (!parentId) return;
  const unf = getPrefs().unfolded;
  if (!unf.includes(parentId)) setPrefs({ unfolded: [...unf, parentId].slice(-200) });
}

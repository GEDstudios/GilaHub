import type { Hub } from '../core/hub';
import type { Item } from '../core/model';
import { getPrefs, setPrefs } from './prefs';
import { headOf, nextRow, type GapAt } from './ui/dropMark';
import { DIST } from './ui/tokens';

/**
 * Where a dragged task or subtask lands among rows, the way outliners and most to-do apps do it:
 * up and down is its place, right and left is its level. Moving it up or down never nests it, so a
 * hand that only reorders can't put it under something by passing over (or pausing on) a row.
 * Every drag of tasks and subtasks asks this, so they all place things the same way.
 *
 * ("Pulled" is sideways from where the drag began, DIST.nest or more. A pull lasts until the hand
 * comes back, or moves on up or down.)
 *
 *   pulled right                        under the task just above where it would land (the slot the
 *                                       list has open for it, or the nearest line between rows),
 *                                       at the end of its subtasks; folded ones unfold after a moment
 *   pulled right on a subtask           under that subtask
 *   a sister subtask, pulled left       out: its own task, right after the one it was under
 *   a subtask's upper or lower half     before or after it, among its sisters (any task's: a task
 *                                       dragged here becomes a subtask, right there)
 *   an unfolded task's lower half       its first subtask (going down through a task that shows
 *                                       its subtasks goes among them)
 *   a task's upper or lower half        `among`: before or after it (otherwise the list's own drag
 *                                       does that)
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
  // A pull moves the gap and so the rows under the hand: what it chose holds while the hand stays
  // pulled that way and about level (else the row now under the hand would undo it). Coming half
  // the way back, or moving on up or down, lets go of it.
  let held: { y: number; dir: 1 | -1; pl: Placement } | null = null;
  // Was what it chose last chosen by a pull? (Coming back undoes that, even over the gap it opened.)
  let pulled = false;
  const hold = (pl: Placement | null, dx: number, y: number) => {
    pulled = !!pl && Math.abs(dx) > DIST.nest;
    if (pl && pulled) held = { y, dir: dx > 0 ? 1 : -1, pl };
    return pl;
  };
  // Did the last answer take it out of the list's own drag? Then the rows are back at rest, and
  // there's no slot to read.
  let out = false;
  const say = <T extends Placement | 'keep' | null>(r: T): T => {
    if (r !== 'keep') out = !!r;
    return r;
  };
  return (item, p, x0) => {
    const dx = p.x - x0;
    if (held && Math.abs(p.y - held.y) < 20 && held.dir * dx > DIST.nest / 2) return held.pl;
    held = null;
    for (const e of document.elementsFromPoint(p.x, p.y)) {
      if (e.closest('.dragout, .dragwrap')) continue;
      const gap = e.closest('.dropgap');
      if (!gap) continue;
      // On the gap, pulling still works: right, under the one above it; left, out a level.
      const pl = gapPull(hub, item, gap, dx);
      if (pl && !staysPut(hub, item, pl)) return say(hold(pl, dx, p.y));
      // The pull that opened this gap was taken back: so is the gap.
      if (pulled && Math.abs(dx) <= DIST.nest / 2) return say(hold(null, dx, p.y));
      return 'keep';
    }
    const at = restRowAt(p);
    // Pulled right, over the list, while it has a slot open for it (or right where it came from):
    // under the task drawn just above that slot.
    if (dx > DIST.nest && at && (at === 'own' || (!out && slotOf(item)?.matches('.is-ghost')))) {
      const el = aboveSlot(item);
      const x = el ? hub.item(el.dataset.id) : undefined;
      const pl = x && el ? underOf(hub, item, x, el) : null;
      if (pl && !staysPut(hub, item, pl)) return say(hold(pl, dx, p.y));
      if (at === 'own') return say(null);
    }
    // A subtask pulled left right where it is: out of its task, right after it.
    if (dx < -DIST.nest && at === 'own' && item.parentId) {
      const taskRow = slotOf(item)?.parentElement?.closest<HTMLElement>('li.row[data-id]');
      const pl = taskRow ? outOf(hub, item, taskRow) : null;
      return say(hold(pl, dx, p.y));
    }
    if (!at || at === 'own') return say(null);
    // Its line read where the row is drawn: the hand, moved by what the list's drag moved it by.
    const q = { x: p.x, y: p.y + at.shift };
    const pl = rowPlace(hub, item, at.row, q, dx, opts.among);
    return pl === 'keep' ? pl : say(pl && !staysPut(hub, item, pl) ? hold(pl, dx, p.y) : null);
  };
}

/** Where the thing in the hand came from: the list's dashed slot (which follows the hand), or the row left behind. */
function slotOf(item: Item): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`li.row[data-id="${item.id}"]`)) {
    if (!el.closest('.dragout, .dragwrap') && el.matches('.is-ghost, .is-lifted-out')) return el;
  }
  return null;
}

/** The row drawn just above the slot, at the slot's own level (read as drawn: rows slide as the hand moves). */
function aboveSlot(item: Item): HTMLElement | null {
  const slot = slotOf(item);
  if (!slot) return null;
  const nested = slot.classList.contains('row--nested');
  const g = slot.getBoundingClientRect();
  const mid = g.top + Math.min(g.height, headOf(slot).bottom - g.top) / 2;
  let best: HTMLElement | null = null;
  let bestTop = -Infinity;
  for (const row of document.querySelectorAll<HTMLElement>('li.row[data-id]')) {
    if (row === slot || row.classList.contains('row--nested') !== nested || row.closest('.dragout, .dragwrap')) continue;
    if (nested && row.parentElement !== slot.parentElement) continue;
    const r = row.getBoundingClientRect();
    if (r.right <= g.left || r.left >= g.right || r.top >= mid || r.top <= bestTop) continue;
    best = row;
    bestTop = r.top;
  }
  return best;
}

/** Under `x` (its row `el`), at the end: in its unfolded subtasks, or inside it. */
function underOf(hub: Hub, item: Item, x: Item, el: HTMLElement): Placement | null {
  if (x.id === item.id || x.done || !hub.canEdit(x) || hub.isUnder(x.id, item.id)) return null;
  const kids = el.querySelector<HTMLElement>(':scope > .rows--sub');
  return {
    listId: x.listId,
    parentId: x.id,
    before: null,
    into: el,
    gap: kids ? { host: kids, before: null } : { host: el, before: null },
    unfold: !kids && !el.classList.contains('row--nested') && hub.childrenOf(x.id).length ? x.id : undefined,
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
function restRowAt(p: Point): { row: HTMLElement; shift: number } | 'own' | null {
  let best: { row: HTMLElement; shift: number; depth: number } | null = null;
  for (const row of document.querySelectorAll<HTMLElement>('li.row[data-id]')) {
    if (row.closest('.dragout, .dragwrap')) continue;
    const r = row.getBoundingClientRect();
    if (p.x < r.left || p.x > r.right) continue;
    const shift = slid(row);
    if (p.y < r.top - shift || p.y >= r.bottom - shift) continue;
    // Where it came from: over that, it goes back.
    if (row.matches('.is-ghost, .is-lifted-out')) return 'own';
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
    return x && prev ? underOf(hub, item, x, prev as HTMLElement) : null;
  }
  // The task it's in: the one whose subtasks these are, or the one it's inside.
  const taskRow = host.matches('li.row[data-id]') ? host : host.closest<HTMLElement>('li.row[data-id]');
  return taskRow ? outOf(hub, item, taskRow) : null;
}

/** Out of the task whose row this is: a level up, right after it. */
function outOf(hub: Hub, item: Item, taskRow: HTMLElement): Placement | null {
  const task = hub.item(taskRow.dataset.id);
  if (!task) return null;
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
  const under = (x: Item = at, el: HTMLElement = row) => underOf(hub, item, x, el);
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
  const lower = p.y > (head.top + head.bottom) / 2;
  // Pulled right with no slot to read (the rows are at rest): under the task above the nearest
  // line between rows.
  if (dx > DIST.nest && at.id !== item.parentId) {
    if (lower) return under();
    let prev = row.previousElementSibling;
    while (prev && !prev.matches('li.row[data-id]')) prev = prev.previousElementSibling;
    const above = prev ? hub.item((prev as HTMLElement).dataset.id) : undefined;
    return above && above.id !== item.id ? under(above, prev as HTMLElement) : under();
  }
  if (at.id === item.parentId) return lower ? first() : before(at, row);
  // Up and down only places it: before or after this task (the list's own drag does that for its
  // own rows), or, going down into a task that shows its subtasks, first among them.
  if (!lower) return among ? before(at, row) : null;
  return subs ? first() : among ? behind(at, row) : null;
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

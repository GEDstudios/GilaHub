import { haptic } from './haptics';

/**
 * Where a dragged thing lands, said the same way by every drag, in gray only (drag.css, "Landing"):
 *   into  what it goes into darkens: a task (it becomes a subtask), a group, a folder, a step of
 *         the path, a tab in the bar;
 *   gap   among rows, they part: a gray gap opens right where it lands, at that level's indent
 *         (in a task's subtasks, or inside a task that has none showing). Where it came from stays
 *         a dashed slot, so "from" and "to" never look alike.
 * A task taking one under it gets both: it darkens, and the gap opens inside it.
 */
export interface GapAt {
  /** The list it opens in (a `ul.rows`, a task's `ul.rows--sub`), or a task's row (inside it, at its foot). */
  host: HTMLElement;
  /** The row it opens before (null: at the end). */
  before: Element | null;
}

export interface Landing {
  into?: HTMLElement | null;
  gap?: GapAt | null;
}

/** A row's own line, without the subtasks unfolded under it (or a gap opened inside it). */
export function headOf(row: HTMLElement): { top: number; bottom: number } {
  const r = row.getBoundingClientRect();
  const under = row.querySelector<HTMLElement>(':scope > .rows--sub, :scope > .dropgap');
  return { top: r.top, bottom: under ? under.getBoundingClientRect().top : r.bottom };
}

/** The row after this one in its list, passing over an open gap. */
export function nextRow(el: Element): Element | null {
  let n = el.nextElementSibling;
  while (n?.classList.contains('dropgap')) n = n.nextElementSibling;
  return n;
}

/** Marks a drag's landing; call it on every aim, and with null when the drag ends. */
export function dropMarks(): (t: Landing | null) => void {
  let lit: HTMLElement | null = null;
  let gap: HTMLElement | null = null;
  let at: GapAt | null = null;
  return (t) => {
    const into = t?.into ?? null;
    const next = t?.gap ?? null;
    const moved = !!next && (!at || at.host !== next.host || at.before !== next.before);
    if ((into && into !== lit) || moved) haptic('select');
    if (into !== lit) lit?.classList.remove('is-droptarget');
    // (Again each time: a row that re-renders, unfolding say, sets its classes afresh.)
    into?.classList.add('is-droptarget');
    lit = into;
    if (!next) {
      gap?.remove();
      gap = null;
      at = null;
      return;
    }
    if (!moved && gap?.isConnected) return;
    gap?.remove();
    const inList = next.host.tagName === 'UL';
    gap = document.createElement(inList ? 'li' : 'div');
    gap.className = `dropgap${next.host.matches('.rows--sub') || !inList ? ' dropgap--sub' : ''}${inList ? '' : ' dropgap--in'}`;
    gap.setAttribute('aria-hidden', 'true');
    next.host.insertBefore(gap, next.before && next.before.parentElement === next.host ? next.before : null);
    at = next;
  };
}

/** The gap that's open now (to set the copy in the hand into it). */
export function openGap(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.dropgap');
}

import { haptic } from './haptics';

/**
 * Where a dragged thing lands, said the same way by every drag, in gray only (drag.css, "Landing"):
 *   into  what it goes into darkens: a task (it becomes a subtask), a group, a folder, a step of
 *         the path, a tab in the bar;
 *   line  a line where it lands among others, drawn above everything (even the copy in the hand).
 *         It starts where that level's rows start, so how far in it starts says how deep it goes.
 * A task taking one under it gets both: it darkens, and a line, one step in, at its foot.
 */
export interface LineAt {
  x: number;
  right: number;
  y: number;
}

export interface Landing {
  into?: HTMLElement | null;
  line?: LineAt | null;
}

/** One level deeper, in px, when a row has no title to line up with. */
const INDENT = 24;

/** A row's box where it rests, not where it slid to make room (a drag's neighbours move). */
export function restRect(el: HTMLElement): { top: number; bottom: number; left: number; right: number; height: number } {
  const r = el.getBoundingClientRect();
  const t = getComputedStyle(el).transform;
  const dy = t === 'none' ? 0 : new DOMMatrixReadOnly(t).m42;
  return { top: r.top - dy, bottom: r.bottom - dy, left: r.left, right: r.right, height: r.height };
}

/** A row's own line, without the subtasks unfolded under it. */
export function headOf(row: HTMLElement): { top: number; bottom: number } {
  const r = row.getBoundingClientRect();
  const sub = row.querySelector<HTMLElement>(':scope > .rows--sub');
  return { top: r.top, bottom: sub ? sub.getBoundingClientRect().top : r.bottom };
}

/** The line above or below a row, from where its level starts (`deeper`: one level in, under its title). */
export function lineBy(row: HTMLElement, edge: 'top' | 'bottom', deeper = false): LineAt {
  const r = row.getBoundingClientRect();
  const body = deeper ? row.querySelector<HTMLElement>(':scope > .row__body') : null;
  const x = deeper ? (body?.getBoundingClientRect().left ?? r.left + INDENT) : r.left;
  return { x, right: r.right, y: edge === 'top' ? r.top : r.bottom };
}

/** Marks a drag's landing; call it on every aim, and with null when the drag ends. */
export function dropMarks(): (t: Landing | null) => void {
  let lit: HTMLElement | null = null;
  let bar: HTMLDivElement | null = null;
  let at = '';
  return (t) => {
    const into = t?.into ?? null;
    const line = t?.line ?? null;
    const key = line ? `${Math.round(line.x)},${Math.round(line.y)}` : '';
    if ((into && into !== lit) || (line && key !== at)) haptic('select');
    if (into !== lit) {
      lit?.classList.remove('is-droptarget');
      into?.classList.add('is-droptarget');
      lit = into;
    }
    at = key;
    if (!line) {
      bar?.remove();
      bar = null;
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'dropline';
      document.body.appendChild(bar);
    }
    bar.style.transform = `translate(${Math.round(line.x)}px, ${Math.round(line.y)}px)`;
    bar.style.width = `${Math.max(24, Math.round(line.right - line.x))}px`;
  };
}

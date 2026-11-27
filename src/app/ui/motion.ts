/**
 * Pure motion math for drag and tick feedback (no DOM, no React), so it can be tested.
 * Used by ui/Sortable.tsx and ui/useSettle.ts.
 */

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The velocity tilt never leans past this, in degrees. */
export const MAX_TILT = 3;

/**
 * One animation frame of the velocity tilt: ease toward a target set by the finger's speed
 * (px/ms). Moving right leans clockwise, as if the bottom trails behind; moving down adds a
 * little of the same. With no speed it eases back to 0 (the caller adds the resting lean).
 */
export function tiltStep(vt: number, vx: number, vy: number): number {
  const target = clamp(vx * 6 + vy * 1.2, -MAX_TILT, MAX_TILT);
  return clamp(vt + (target - vt) * 0.2, -MAX_TILT, MAX_TILT);
}

/** The lean to draw: the resting lean plus the velocity tilt, kept within ±MAX_TILT when `bounded`. */
export function leanOf(rest: number, vt: number, bounded: boolean): number {
  return bounded ? clamp(rest + vt, -MAX_TILT, MAX_TILT) : rest + vt;
}

/**
 * Rubber-band `v` into [min, max]. Past an edge it starts at `give` of the finger and
 * tapers off, never going more than `reach` px past the edge.
 * Returns the drawn value and how far the finger is past the edge (0 inside).
 */
export function rubber(v: number, min: number, max: number, give = 0.25, reach = 36): { v: number; over: number } {
  if (min > max) min = max = (min + max) / 2;
  const band = (over: number) => reach * (1 - 1 / ((over * give) / reach + 1));
  if (v < min) return { v: min - band(min - v), over: min - v };
  if (v > max) return { v: max + band(v - max), over: v - max };
  return { v, over: 0 };
}

/** Move `id` to where `overId` is (dnd-kit's arrayMove, by id). Unknown ids leave the order as it is. */
export function moveId(ids: readonly string[], id: string, overId: string): string[] {
  const from = ids.indexOf(id);
  const to = ids.indexOf(overId);
  const next = [...ids];
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

// ---------------------------------------------------------------- settle

/** What a group showed last time: its order and its rows. */
export interface SettleSnap<T> {
  order: string[];
  byId: Map<string, T>;
}

/**
 * A ticked row leaves its group at once in the data, but we keep drawing it in its old spot
 * for a moment so the check, the strike and the collapse can play.
 * - Rows that are `held` and missing from `rows` come back from `prev`, flagged `settling`,
 *   right after their nearest earlier neighbour that's still here.
 * - Rows that are `held` and new to this group (they just moved here) wait until the hold ends.
 */
export function settleMerge<T>(
  rows: readonly T[],
  idOf: (t: T) => string,
  prev: SettleSnap<T> | undefined,
  held: ReadonlySet<string>,
): Array<{ row: T; settling: boolean }> {
  const before = new Set(prev?.order ?? []);
  const out = rows.filter((r) => !held.has(idOf(r)) || before.has(idOf(r))).map((row) => ({ row, settling: false }));
  if (!prev || !held.size) return out;
  const here = new Map(out.map((o, i) => [idOf(o.row), i]));
  prev.order.forEach((id, i) => {
    if (!held.has(id) || here.has(id)) return;
    const row = prev.byId.get(id);
    if (row === undefined) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((o) => idOf(o.row) === prev.order[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, { row, settling: true });
    here.set(id, at);
  });
  return out;
}

// ---------------------------------------------------------------- sheets and toasts

/** Speed (px/ms) of the last stretch of a gesture, from samples of [time ms, position px]. */
export function flickSpeed(samples: ReadonlyArray<readonly [number, number]>, window = 90): number {
  if (samples.length < 2) return 0;
  const [tEnd, pEnd] = samples[samples.length - 1];
  let i = samples.length - 2;
  while (i > 0 && tEnd - samples[i - 1][0] <= window) i--;
  const [t0, p0] = samples[i];
  return tEnd > t0 ? (pEnd - p0) / (tEnd - t0) : 0;
}

/** Where a pulled sheet sits: it follows the finger down, and only gives a little upward. */
export function sheetPull(dy: number): number {
  return dy >= 0 ? dy : Math.max(dy * 0.18, -24);
}

/** Let go of a pulled sheet: close past 28% of its height (at most 140px), or on a flick down. */
export function sheetCloses(dy: number, height: number, speed: number): boolean {
  return dy > Math.min(140, height * 0.28) || (speed > 0.55 && dy > 0);
}

/**
 * How far a finger may wander on a toast and still be a tap. A thumb landing on "Refresh" or
 * "Undo" slides a few pixels, fast: under this it's never a swipe, so the button gets its tap.
 */
export const TOAST_SLOP = 12;

/** Let go of a swiped toast: gone past 64px, or on a flick either way (once it's past a tap's wander). */
export function toastSwipedAway(dx: number, speed: number): boolean {
  return Math.abs(dx) > 64 || (Math.abs(speed) > 0.5 && Math.abs(dx) > TOAST_SLOP);
}

/** A button on a toast. */
export interface ToastAction {
  label: string;
  run: () => void;
}

/** A toast that shares a group with the next one turns into a count ("3 in the cart"). */
export interface ToastLike {
  message: string;
  group?: string;
  count: number;
  many?: (n: number) => string;
  actions: ToastAction[];
}

/**
 * Fold `next` into `prev` when they share a group: the count goes up, the message says how
 * many, and Undo undoes all of them, newest first. Returns null when they don't fold.
 */
export function foldToast<T extends ToastLike>(prev: T, next: Omit<ToastLike, 'count'> & Partial<T>): T | null {
  if (!prev.group || prev.group !== next.group) return null;
  const count = prev.count + 1;
  const many = next.many ?? prev.many;
  const actions = next.actions.length
    ? next.actions.map((b) => {
        const a = prev.actions.find((x) => x.label === b.label);
        return a
          ? {
              label: b.label,
              run: () => {
                b.run();
                a.run();
              },
            }
          : b;
      })
    : prev.actions;
  return { ...prev, ...next, count, many, message: many ? many(count) : next.message, actions } as T;
}

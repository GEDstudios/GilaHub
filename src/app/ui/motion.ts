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

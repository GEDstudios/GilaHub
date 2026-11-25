/**
 * Hold-and-scrub maths for the bottom bar (pure, for tests). TabBar.tsx owns the gesture:
 * hold still for HOLD_MS, then slide along the bar to pick a tab and let go to go there.
 */

/** How long a finger must rest on the bar before it scrubs. */
export const HOLD_MS = 240;
/** Moving further than this before the hold fires means a tap or a native scroll instead. */
export const HOLD_SLOP = 10;
/** Lifting the finger this far above the bar turns the release into a cancel. */
export const CANCEL_LIFT = 72;
/** In dock mode, the bar scrolls by itself while the finger is this close to an edge. */
export const EDGE_ZONE = 32;
/** The fastest auto-scroll, in px per frame. */
export const EDGE_SPEED = 9;

/** The index of the slot whose center is nearest to x, or -1 for none. */
export function nearestIndex(x: number, centers: readonly number[]): number {
  let best = -1;
  let bestD = Infinity;
  centers.forEach((c, i) => {
    const d = Math.abs(x - c);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** How far each slot is from the finger, in slot widths (drives the magnification, --d). */
export function slotDistance(x: number, center: number, width: number): number {
  return width > 0 ? Math.abs(x - center) / width : Infinity;
}

/** Where the bubble's center goes: under the finger, but with the whole bubble inside [left, right]. */
export function clampBubble(x: number, width: number, left: number, right: number): number {
  const half = width / 2;
  if (right - left <= width) return (left + right) / 2;
  return Math.min(Math.max(x, left + half), right - half);
}

/**
 * Auto-scroll speed near the edges of the scrolling middle: negative toward the start,
 * positive toward the end, faster the deeper the finger is in the zone, 0 elsewhere or
 * when that way is already fully scrolled. The finger past the edge (over a fixed tab) stops it.
 */
export function edgeSpeed(x: number, left: number, right: number, scrollLeft: number, maxScroll: number): number {
  if (x < left || x > right) return 0;
  if (x < left + EDGE_ZONE && scrollLeft > 0) return -Math.ceil(((left + EDGE_ZONE - x) / EDGE_ZONE) * EDGE_SPEED);
  if (x > right - EDGE_ZONE && scrollLeft < maxScroll) return Math.ceil(((x - (right - EDGE_ZONE)) / EDGE_ZONE) * EDGE_SPEED);
  return 0;
}

/** The scrollLeft that centers a slot in its scroller, kept within the scrollable range. */
export function centerScroll(slotLeft: number, slotWidth: number, viewport: number, scrollWidth: number): number {
  const max = Math.max(0, scrollWidth - viewport);
  return Math.min(Math.max(slotLeft + slotWidth / 2 - viewport / 2, 0), max);
}

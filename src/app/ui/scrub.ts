import { HOLD, SLOP } from './tokens';

/**
 * Hold-and-scrub maths for the bottom bar (pure, for tests). TabBar.tsx owns the gesture:
 * hold still for HOLD_MS, then slide along the bar to pick a tab and let go to go there.
 */

/** How long a finger must rest on the bar before it scrubs. */
export const HOLD_MS = HOLD.bar;
/** Moving further than this before the hold fires means a tap or a native scroll instead. */
export const HOLD_SLOP = SLOP.swipe;
/** Lifting the finger this far above the bar turns the release into a cancel. */
export const CANCEL_LIFT = 72;
/** In dock mode, the outer strip of the scrolling middle (under the fade) that always steps it. */
export const EDGE_ZONE = 14;
/** How long the finger rests at an edge before the dock steps: passing through never scrolls. */
export const EDGE_DWELL = 300;
/** Then one tab every this many ms, so the picks can be counted (one select haptic each). */
export const EDGE_STEP_MS = 230;

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
 * Which way the dock's middle should step while scrubbing: -1 toward the start, 1 toward the
 * end, 0 to stay. Only past the center of the outermost tab in view (`first`/`last` are the
 * centers of the first and last tabs whose centers are in view), or in the outer EDGE_ZONE, so
 * the tab at the edge can always be picked. Never once that way is fully scrolled, and never
 * with the finger past the scroller (over a fixed tab: Today or Projects is picked instead).
 */
export function edgeDir(x: number, left: number, right: number, scrollLeft: number, maxScroll: number, first: number, last: number): -1 | 0 | 1 {
  if (x < left || x > right) return 0;
  if (x < Math.max(first, left + EDGE_ZONE) && scrollLeft > 0) return -1;
  if (x > Math.min(last, right - EDGE_ZONE) && scrollLeft < maxScroll - 1) return 1;
  return 0;
}

/** The scrollLeft that centers a slot in its scroller, kept within the scrollable range. */
export function centerScroll(slotLeft: number, slotWidth: number, viewport: number, scrollWidth: number): number {
  const max = Math.max(0, scrollWidth - viewport);
  return Math.min(Math.max(slotLeft + slotWidth / 2 - viewport / 2, 0), max);
}

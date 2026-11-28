/**
 * How the app feels, in one place: how long a press-and-hold takes, how far a finger may wander
 * before a press becomes a drag, how long things take to move. Every gesture and animation in
 * the app reads these, so a hold on a row, a subtask, a note or a group header all feel the same.
 * The CSS side (tokens.css) carries the same values as custom properties: keep them in step
 * (tests/unit/tokens.test.ts checks).
 */

/** Press and hold, in ms. */
export const HOLD = {
  /** Any long-press that picks something up or opens something (rows, subtasks, notes, groups). */
  press: 350,
  /** A grip or handle, made to be held: a short touch is enough. */
  handle: 120,
  /** The tab bar's scrub (hold the bar, slide to a tab). */
  bar: 240,
  /** A card in the hand, rested on another this long: it goes under it (cards have no sideways pull). */
  nest: 700,
} as const;

/** How far (px) a pointer may move. */
export const SLOP = {
  /** A mouse drag starts once it moved this far (no hold needed with a mouse). */
  mouse: 4,
  /** A held finger may wander this much and still be holding. */
  hold: 8,
  /** A swipe starts once it moved this far sideways. */
  swipe: 10,
} as const;

/** Distances (px) that change what a drag does. */
export const DIST = {
  /** Pulled this far right while dragging: it goes under the task above where it would land; this far left, a subtask comes out. */
  nest: 48,
  /** Sliding to a choice (the +'s menu): let go this near one and it's the one. */
  reach: 28,
} as const;

/** After a drag or swipe ends, the click it would cause is swallowed for this long (ms). */
export const CLICK_SWALLOW_MS = 350;

/** Durations (ms), mirrored in tokens.css as --dur-*. */
export const DUR = {
  quick: 140,
  base: 200,
  move: 260,
  slow: 320,
  /** A row ticked stays drawn ticked, then folds away (row-fold 220ms after 300ms). */
  settle: 520,
  /** A row just added (or changed by the partner) glows this long. */
  flash: 2200,
} as const;

/** Easings, mirrored in tokens.css as --ease, --spring, --spring-soft. */
export const EASE = {
  out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  spring: 'cubic-bezier(0.34, 1.5, 0.64, 1)',
  /** A gentler overshoot: drops, sheets springing back, FLIP moves. */
  springSoft: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
} as const;

/** How long a toast stays (ms). */
export const TOAST = { short: 1800, normal: 3200, withAction: 5500 } as const;

/** Stacking, mirrored in tokens.css as --z-*. */
export const Z = { drag: 200 } as const;

/** The person asked for less motion: animations snap instead of moving. */
export const calm = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

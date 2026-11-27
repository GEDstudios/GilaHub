import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAPTIC_PATTERNS, haptic, throttled } from '../../src/app/ui/haptics';
import {
  flickSpeed,
  foldToast,
  leanOf,
  MAX_TILT,
  moveId,
  rubber,
  settleMerge,
  sheetCloses,
  sheetPull,
  tiltStep,
  toastSwipedAway,
  type SettleSnap,
  type ToastLike,
} from '../../src/app/ui/motion';
import { setPrefs } from '../../src/app/prefs';

describe('drag math', () => {
  it('rubber-bands past the edges: a quarter of the finger at first, never more than its reach', () => {
    expect(rubber(10, -50, 100)).toEqual({ v: 10, over: 0 });
    expect(rubber(100.4, -50, 100).v).toBeCloseTo(100.1, 2);
    const up = rubber(-90, -50, 100);
    expect(up.over).toBe(40);
    expect(up.v).toBeLessThan(-50);
    expect(up.v).toBeGreaterThan(-60);
    expect(rubber(140, -50, 100).v).toBeCloseTo(100 + (-50 - up.v), 6);
    expect(rubber(5000, 0, 100).v).toBeLessThan(136);
    // A list shorter than its row pins to the middle.
    expect(rubber(0, 10, -10).v).toBe(0);
  });

  it('tilts with the finger, never past ±3deg, and eases back when it rests', () => {
    let vt = 0;
    for (let i = 0; i < 60; i++) vt = tiltStep(vt, 2, 0);
    expect(vt).toBeCloseTo(MAX_TILT, 2);
    for (let i = 0; i < 60; i++) vt = tiltStep(vt, -5, -5);
    expect(vt).toBeCloseTo(-MAX_TILT, 2);
    for (let i = 0; i < 60; i++) vt = tiltStep(vt, 0, 0);
    expect(Math.abs(vt)).toBeLessThan(0.01);
    expect(tiltStep(0, 0.1, 0)).toBeGreaterThan(0);
  });

  it('keeps a row within ±3deg but lets a folder keep its own tilt', () => {
    expect(leanOf(1.5, 3, true)).toBe(3);
    expect(leanOf(1.5, -1, true)).toBe(0.5);
    expect(leanOf(5.3, 1, false)).toBeCloseTo(6.3);
  });

  it('moves an id to where another one is', () => {
    expect(moveId(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveId(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveId(['a', 'b'], 'a', 'x')).toEqual(['a', 'b']);
  });
});

describe('settle', () => {
  const id = (s: string) => s;
  const snap = (order: string[]): SettleSnap<string> => ({ order, byId: new Map(order.map((x) => [x, x])) });

  it('keeps a ticked row in its old spot, flagged as settling', () => {
    const out = settleMerge(['a', 'c'], id, snap(['a', 'b', 'c']), new Set(['b']));
    expect(out).toEqual([
      { row: 'a', settling: false },
      { row: 'b', settling: true },
      { row: 'c', settling: false },
    ]);
  });

  it('puts a held first row back at the top', () => {
    expect(settleMerge(['b'], id, snap(['a', 'b']), new Set(['a'])).map((o) => o.row)).toEqual(['a', 'b']);
  });

  it('holds back a row that just arrived in another group until it has settled', () => {
    expect(settleMerge(['x', 'b'], id, snap(['x']), new Set(['b'])).map((o) => o.row)).toEqual(['x']);
    expect(settleMerge(['b'], id, undefined, new Set(['b']))).toEqual([]);
    // Once the hold ends it shows up.
    expect(settleMerge(['x', 'b'], id, snap(['x']), new Set()).map((o) => o.row)).toEqual(['x', 'b']);
  });

  it('shows an undone row as it is, not settling', () => {
    expect(settleMerge(['a', 'b'], id, snap(['a', 'b']), new Set(['b']))).toEqual([
      { row: 'a', settling: false },
      { row: 'b', settling: false },
    ]);
  });

  it('lets a row go once the hold ends', () => {
    expect(settleMerge(['a', 'c'], id, snap(['a', 'b', 'c']), new Set()).map((o) => o.row)).toEqual(['a', 'c']);
  });
});

describe('haptics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setPrefs({ haptics: true });
  });

  it('throttles select, more on iOS', () => {
    expect(throttled('select', 100, 90, false)).toBe(true);
    expect(throttled('select', 130, 100, false)).toBe(false);
    expect(throttled('select', 130, 100, true)).toBe(true);
    expect(throttled('tick', 100, 99, true)).toBe(false);
  });

  it('plays the kind’s pattern, and nothing when switched off', () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
    haptic();
    haptic('drop');
    expect(vibrate.mock.calls).toEqual([[HAPTIC_PATTERNS.tick], [HAPTIC_PATTERNS.drop]]);
    setPrefs({ haptics: false });
    haptic('warn');
    expect(vibrate).toHaveBeenCalledTimes(2);
  });
});

describe('sheet pull', () => {
  it('follows the finger down and only gives a little upward', () => {
    expect(sheetPull(80)).toBe(80);
    expect(sheetPull(0)).toBe(0);
    expect(sheetPull(-50)).toBeCloseTo(-9);
    expect(sheetPull(-400)).toBe(-24);
  });

  it('closes past 28% of the sheet (140px at most) or on a flick down; otherwise springs back', () => {
    // A short sheet: 28% of 300 is 84.
    expect(sheetCloses(90, 300, 0)).toBe(true);
    expect(sheetCloses(80, 300, 0)).toBe(false);
    // A tall sheet caps at 140.
    expect(sheetCloses(139, 800, 0)).toBe(false);
    expect(sheetCloses(141, 800, 0)).toBe(true);
    // A quick flick closes from a short pull, but not a flick upward.
    expect(sheetCloses(30, 800, 0.6)).toBe(true);
    expect(sheetCloses(30, 800, 0.5)).toBe(false);
    expect(sheetCloses(-10, 800, 0.9)).toBe(false);
  });

  it('measures the flick from the last stretch of the gesture', () => {
    expect(flickSpeed([])).toBe(0);
    expect(flickSpeed([[0, 0]])).toBe(0);
    // Slow for a while, then fast: only the last ~90ms counts.
    const samples: Array<[number, number]> = [
      [0, 0],
      [200, 10],
      [400, 20],
      [450, 50],
      [480, 80],
    ];
    expect(flickSpeed(samples)).toBeCloseTo((80 - 20) / (480 - 400));
    expect(flickSpeed([[0, 100], [100, 40]])).toBeCloseTo(-0.6);
  });
});

describe('toasts', () => {
  it('swipe away past 64px or with a flick either way', () => {
    expect(toastSwipedAway(70, 0)).toBe(true);
    expect(toastSwipedAway(-70, 0)).toBe(true);
    expect(toastSwipedAway(40, 0.2)).toBe(false);
    expect(toastSwipedAway(-20, -0.8)).toBe(true);
    // A tap (no movement) never dismisses, whatever the timing.
    expect(toastSwipedAway(0, 3)).toBe(false);
    // A thumb landing on a toast's button slides a few pixels, fast: still a tap.
    expect(toastSwipedAway(10, 1.2)).toBe(false);
    expect(toastSwipedAway(-12, -2)).toBe(false);
  });

  it('fold into one per group: the count goes up and Undo undoes all, newest first', () => {
    const order: string[] = [];
    const many = (n: number) => `${n} in the cart`;
    const first: ToastLike = { message: 'milk is in the cart', group: 'cart', many, count: 1, actions: [{ label: 'Undo', run: () => order.push('milk') }] };
    const second = foldToast(first, { message: 'eggs is in the cart', group: 'cart', many, actions: [{ label: 'Undo', run: () => order.push('eggs') }] });
    expect(second).not.toBeNull();
    expect(second!.count).toBe(2);
    expect(second!.message).toBe('2 in the cart');
    const third = foldToast(second!, { message: 'bread is in the cart', group: 'cart', many, actions: [{ label: 'Undo', run: () => order.push('bread') }] });
    expect(third!.message).toBe('3 in the cart');
    expect(third!.actions).toHaveLength(1);
    third!.actions[0].run();
    expect(order).toEqual(['bread', 'eggs', 'milk']);
  });

  it('do not fold across groups, or without a group', () => {
    const a: ToastLike = { message: 'Done', group: 'done', count: 1, actions: [] };
    expect(foldToast(a, { message: 'milk is in the cart', group: 'cart', actions: [] })).toBeNull();
    expect(foldToast({ message: 'Saved', count: 1, actions: [] }, { message: 'Saved', actions: [] })).toBeNull();
  });

  it('keep the newest action when the labels differ', () => {
    const run = vi.fn();
    const a: ToastLike = { message: 'Done', group: 'done', count: 1, actions: [{ label: 'Undo', run: () => {} }] };
    const b = foldToast(a, { message: 'Done', group: 'done', actions: [{ label: 'Finish them', run }] });
    b!.actions[0].run();
    expect(b!.actions.map((x) => x.label)).toEqual(['Finish them']);
    expect(run).toHaveBeenCalledOnce();
    // No `many`: the newest message stays.
    expect(b!.message).toBe('Done');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAPTIC_PATTERNS, haptic, throttled } from '../../src/app/ui/haptics';
import { leanOf, MAX_TILT, moveId, rubber, settleMerge, tiltStep, type SettleSnap } from '../../src/app/ui/motion';
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

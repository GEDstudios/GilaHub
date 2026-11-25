import { describe, expect, it } from 'vitest';
import { slotFromRects, withGap, type Aim } from '../../src/app/barEdit';
import { MAX_PINS, type TabDef } from '../../src/app/tabs';

const tab = (key: string): TabDef => ({ key, label: key, path: `/${key}` });
const bar = (...keys: string[]) => [tab('today'), ...keys.map(tab), tab('projects')];
const keys = (tabs: TabDef[]) => tabs.map((t) => t.key);
const aim = (key: string, at: number | null, refusing = false): Aim => ({ key, tab: tab(key), at, refusing });

describe('aiming at the bar', () => {
  it('slotFromRects counts the tab centers left of the finger', () => {
    const centers = [100, 160, 220];
    expect(slotFromRects(20, centers)).toBe(0);
    expect(slotFromRects(130, centers)).toBe(1);
    expect(slotFromRects(200, centers)).toBe(2);
    expect(slotFromRects(400, centers)).toBe(3);
  });

  it('slotFromRects in the dock: over Today is first, over Projects is last', () => {
    // Tabs scrolled out of view still sit where they are, so they count by place.
    const centers = [-40, 20, 90, 150, 210, 270, 330];
    const view = { left: 60, right: 300 };
    expect(slotFromRects(30, centers, view)).toBe(0);
    expect(slotFromRects(120, centers, view)).toBe(3);
    expect(slotFromRects(320, centers, view)).toBe(centers.length);
  });

  it('withGap leaves the bar alone with nothing aimed', () => {
    const tabs = bar('shop', 'chores');
    expect(withGap(tabs, null)).toEqual({ tabs, gap: null });
  });

  it('withGap: a newcomer not over the bar yet shows an empty + at the end; over it, a gap where it lands', () => {
    const tabs = bar('shop', 'chores');
    const waiting = withGap(tabs, aim('l:gift', null));
    expect(keys(waiting.tabs)).toEqual(['today', 'shop', 'chores', 'projects']);
    expect(waiting.gap).toEqual({ at: 2, tab: undefined });
    const over = withGap(tabs, aim('l:gift', 1));
    expect(over.gap).toEqual({ at: 1, tab: tab('l:gift') });
  });

  it('withGap: a pinned one leaves its place, which is the gap until it moves', () => {
    const tabs = bar('shop', 'l:trip', 'chores');
    const lifted = withGap(tabs, aim('l:trip', null));
    expect(keys(lifted.tabs)).toEqual(['today', 'shop', 'chores', 'projects']);
    expect(lifted.gap).toEqual({ at: 1, tab: tab('l:trip') });
    expect(withGap(tabs, aim('l:trip', 0)).gap?.at).toBe(0);
    expect(withGap(tabs, aim('l:trip', 9)).gap?.at).toBe(2);
  });

  it('withGap: a full bar opens no gap for a newcomer, but still moves its own', () => {
    const pins = Array.from({ length: MAX_PINS }, (_, i) => `k${i}`);
    const tabs = bar(...pins);
    expect(withGap(tabs, aim('l:new', 3)).gap).toBeNull();
    expect(withGap(tabs, aim('l:new', null, true)).gap).toBeNull();
    expect(withGap(tabs, aim('k5', 3)).gap?.at).toBe(3);
  });
});

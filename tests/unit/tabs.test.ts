import { describe, expect, it } from 'vitest';
import { Hub, seedHousehold } from '../../src/core/actions';
import { MemoryPersistence } from '../../src/core/db';
import { Store } from '../../src/core/store';
import { activeTabKey, barDensity, cleanPins, DEFAULT_PINS, MAX_PINS, pinOptions, pinsOf, setPins, tabsOf, togglePin } from '../../src/app/tabs';
import { CANCEL_LIFT, centerScroll, clampBubble, EDGE_SPEED, EDGE_ZONE, edgeSpeed, HOLD_MS, HOLD_SLOP, nearestIndex, slotDistance } from '../../src/app/ui/scrub';

async function guy() {
  const store = await Store.load(new MemoryPersistence(), 'dev-guy', ['h', 'p:guy']);
  const hub = new Hub(store, 'guy');
  hub.upsertMember('guy', { name: 'Guy', color: 'lemon', createdAt: 1 });
  seedHousehold(hub, ['groceries', 'home', 'chores', 'todo']);
  return hub;
}

describe('bottom bar pins', () => {
  it('keeps every pin, in order, with no practical cap', async () => {
    const hub = await guy();
    const keys = pinOptions(hub).map((o) => o.key);
    expect(keys.length).toBeGreaterThanOrEqual(7);
    setPins(hub, keys);
    expect(pinsOf(hub)).toEqual(keys);
    expect(tabsOf(hub)).toHaveLength(keys.length + 2);
    expect(tabsOf(hub)[0].key).toBe('today');
    expect(tabsOf(hub).at(-1)!.key).toBe('projects');
  });

  it('offers Search, starts from the defaults, and lights Search on its route', async () => {
    const hub = await guy();
    expect(pinsOf(hub)).toEqual(DEFAULT_PINS);
    expect(pinOptions(hub).slice(0, 3).map((o) => o.key)).toEqual(['shop', 'chores', 'search']);
    expect(togglePin(hub, 'search')).toBe(true);
    expect(activeTabKey(hub, { name: 'search' })).toBe('search');
  });

  it('drops duplicates and unknown keys, when reading and when saving', async () => {
    const hub = await guy();
    const todo = hub.lists().find((l) => l.name === 'To do')!;
    hub.upsertMember('guy', { tabs: ['shop', 'shop', 'nope', `l:${todo.id}`, 'chores', `l:${todo.id}`] });
    expect(pinsOf(hub)).toEqual(['shop', `l:${todo.id}`, 'chores']);
    setPins(hub, ['chores', 'chores', 'bogus', 'search']);
    expect(hub.me()!.tabs).toEqual(['chores', 'search']);
  });

  it("forgets a deleted project's pin", async () => {
    const hub = await guy();
    const todo = hub.lists().find((l) => l.name === 'To do')!;
    togglePin(hub, `l:${todo.id}`);
    expect(pinsOf(hub)).toContain(`l:${todo.id}`);
    hub.deleteList(todo.id);
    expect(pinsOf(hub)).not.toContain(`l:${todo.id}`);
  });

  it('togglePin always works, even with a crowded bar, and says what it did', async () => {
    const hub = await guy();
    const projects = hub.lists().map((l) => `l:${l.id}`);
    setPins(hub, ['shop', 'chores', 'search', ...projects.slice(0, 3)]);
    expect(pinsOf(hub)).toHaveLength(6);
    const last = projects[3];
    expect(togglePin(hub, last)).toBe(true);
    expect(pinsOf(hub).at(-1)).toBe(last);
    expect(togglePin(hub, last)).toBe(false);
    expect(pinsOf(hub)).not.toContain(last);
  });

  it('keeps a sanity cap', () => {
    const many = Array.from({ length: 40 }, (_, i) => `k${i}`);
    expect(cleanPins(many, new Set(many))).toHaveLength(MAX_PINS);
    expect(MAX_PINS).toBe(24);
  });

  it('chooses the density from the tab count, Today and Projects included', () => {
    expect([3, 5].map(barDensity)).toEqual(['comfy', 'comfy']);
    expect([6, 7].map(barDensity)).toEqual(['snug', 'snug']);
    expect([8, 12, 26].map(barDensity)).toEqual(['dock', 'dock', 'dock']);
  });
});

describe('hold-and-scrub maths', () => {
  it('has the agreed timings', () => {
    expect([HOLD_MS, HOLD_SLOP, CANCEL_LIFT]).toEqual([240, 10, 72]);
  });

  it('picks the slot nearest the finger', () => {
    const centers = [30, 90, 150, 210];
    expect(nearestIndex(0, centers)).toBe(0);
    expect(nearestIndex(119, centers)).toBe(1);
    expect(nearestIndex(121, centers)).toBe(2);
    expect(nearestIndex(999, centers)).toBe(3);
    expect(nearestIndex(10, [])).toBe(-1);
  });

  it('measures distance in slot widths', () => {
    expect(slotDistance(90, 90, 60)).toBe(0);
    expect(slotDistance(30, 90, 60)).toBe(1);
    expect(slotDistance(180, 90, 60)).toBe(1.5);
    expect(slotDistance(0, 90, 0)).toBe(Infinity);
  });

  it('keeps the bubble inside the bar', () => {
    expect(clampBubble(200, 100, 12, 378)).toBe(200);
    expect(clampBubble(20, 100, 12, 378)).toBe(62);
    expect(clampBubble(370, 100, 12, 378)).toBe(328);
    expect(clampBubble(50, 400, 12, 378)).toBe(195);
  });

  it('auto-scrolls near the edges only, and only where there is more to see', () => {
    const [l, r] = [70, 320];
    expect(edgeSpeed(200, l, r, 50, 200)).toBe(0);
    expect(edgeSpeed(l + 1, l, r, 50, 200)).toBeLessThan(0);
    expect(edgeSpeed(l + 1, l, r, 0, 200)).toBe(0);
    expect(edgeSpeed(r - 1, l, r, 50, 200)).toBeGreaterThan(0);
    expect(edgeSpeed(r - 1, l, r, 200, 200)).toBe(0);
    expect(Math.abs(edgeSpeed(l, l, r, 50, 200))).toBe(EDGE_SPEED);
    expect(Math.abs(edgeSpeed(l + EDGE_ZONE - 8, l, r, 50, 200))).toBeLessThan(EDGE_SPEED);
    // Past the scroller, over Today or Projects: no scrolling.
    expect(edgeSpeed(l - 5, l, r, 50, 200)).toBe(0);
    expect(edgeSpeed(r + 5, l, r, 50, 200)).toBe(0);
  });

  it('centers a slot without scrolling past either end', () => {
    expect(centerScroll(300, 50, 200, 600)).toBe(225);
    expect(centerScroll(10, 50, 200, 600)).toBe(0);
    expect(centerScroll(560, 50, 200, 600)).toBe(400);
    expect(centerScroll(100, 50, 400, 300)).toBe(0);
  });
});

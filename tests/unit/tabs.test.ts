import { describe, expect, it } from 'vitest';
import { Hub } from '../../src/core/actions';
import { seedHousehold } from '../../src/core/seed';
import { MemoryPersistence } from '../../src/core/db';
import { Store } from '../../src/core/store';
import { activeTabKey, barDensity, cleanPins, keepDormant, MAX_PINS, pinAt, pinOptions, pinsOf, placePin, setPins, tabsOf, togglePin } from '../../src/app/tabs';
import { centerScroll, clampBubble, EDGE_ZONE, edgeDir, nearestIndex, slotDistance } from '../../src/app/ui/scrub';

async function guy() {
  const store = await Store.load(new MemoryPersistence(), 'dev-guy', ['h', 'p:guy']);
  const hub = new Hub(store, 'guy');
  hub.upsertMember('guy', { name: 'Guy', color: 'lemon', createdAt: 1 });
  seedHousehold(hub, ['groceries', 'home', 'chores', 'todo']);
  return hub;
}

/** The Shopping project's pin: what the bar starts with (a stored 'shop' is it). */
const S = (hub: Hub) => `l:${hub.shopRoot()!.id}`;
const others = (hub: Hub) => hub.lists().filter((l) => !l.shopRoot);

describe('bottom bar pins', () => {
  it('keeps every pin, in order, with no practical cap', async () => {
    const hub = await guy();
    const keys = pinOptions(hub).map((o) => o.key);
    expect(keys.length).toBeGreaterThanOrEqual(6);
    setPins(hub, keys);
    expect(pinsOf(hub)).toEqual(keys);
    expect(tabsOf(hub)).toHaveLength(keys.length + 2);
    expect(tabsOf(hub)[0].key).toBe('today');
    expect(tabsOf(hub).at(-1)!.key).toBe('projects');
  });

  it('offers Search (it opens over the page, so it never lights as a page) and starts from the defaults', async () => {
    const hub = await guy();
    expect(pinsOf(hub)).toEqual([S(hub)]);
    expect(pinOptions(hub)[0].key).toBe('search');
    expect(togglePin(hub, 'search')).toBe(true);
    expect(activeTabKey(hub, { name: 'today' })).toBe('today');
  });

  it('drops duplicates and unknown keys, when reading and when saving', async () => {
    const hub = await guy();
    const todo = hub.lists().find((l) => l.name === 'To do')!;
    hub.upsertMember('guy', { tabs: ['shop', 'shop', 'nope', `l:${todo.id}`, 'search', `l:${todo.id}`] });
    expect(pinsOf(hub)).toEqual([S(hub), `l:${todo.id}`, 'search']);
    setPins(hub, ['search', 'search', 'bogus', 'shop']);
    expect(hub.me()!.tabs).toEqual(['search', S(hub)]);
  });

  it("forgets a deleted project's pin", async () => {
    const hub = await guy();
    const todo = hub.lists().find((l) => l.name === 'To do')!;
    togglePin(hub, `l:${todo.id}`);
    expect(pinsOf(hub)).toContain(`l:${todo.id}`);
    hub.deleteList(todo.id);
    expect(pinsOf(hub)).not.toContain(`l:${todo.id}`);
  });

  it("keeps an archived project's pin through edits, in its place, so restoring brings it back", async () => {
    const hub = await guy();
    const [a, b] = others(hub);
    setPins(hub, ['shop', `l:${a.id}`, `l:${b.id}`]);
    hub.updateList(a.id, { archived: true });
    expect(pinsOf(hub)).toEqual([S(hub), `l:${b.id}`]);
    togglePin(hub, 'search');
    hub.updateList(a.id, { archived: false });
    expect(pinsOf(hub)).toEqual([S(hub), `l:${a.id}`, `l:${b.id}`, 'search']);
  });

  it('keepDormant puts what it keeps back after its old neighbour', () => {
    const keep = (k: string) => k.startsWith('x');
    expect(keepDormant(['a', 'x1', 'b', 'x2'], ['b', 'a'], (k) => k, keep)).toEqual(['b', 'x2', 'a', 'x1']);
    expect(keepDormant(['x1', 'a'], ['a'], (k) => k, keep)).toEqual(['x1', 'a']);
    expect(keepDormant(['a', 'gone'], ['a'], (k) => k, keep)).toEqual(['a']);
  });

  it('togglePin always works, even with a crowded bar, and says what it did', async () => {
    const hub = await guy();
    const projects = others(hub).map((l) => `l:${l.id}`);
    setPins(hub, ['shop', 'search', ...projects.slice(0, 3)]);
    expect(pinsOf(hub)).toHaveLength(5);
    const last = projects[3];
    expect(togglePin(hub, last)).toBe(true);
    expect(pinsOf(hub).at(-1)).toBe(last);
    expect(togglePin(hub, last)).toBe(false);
    expect(pinsOf(hub)).not.toContain(last);
  });

  it('never names two tabs the same', async () => {
    const hub = await guy();
    const labels = () => pinOptions(hub).map((o) => o.label);
    expect(new Set(labels()).size).toBe(labels().length);
  });

  it('has no Chores tab: chores are a plain project, pinned like any other', async () => {
    const hub = await guy();
    const id = (name: string) => hub.lists().find((l) => l.name === name)!.id;
    expect(pinOptions(hub).some((o) => o.key === 'chores')).toBe(false);
    // An old bar with Chores in it just loses that tab.
    setPins(hub, ['shop', 'chores']);
    expect(pinsOf(hub)).toEqual([S(hub)]);
    setPins(hub, ['shop', `l:${id('Chores')}`]);
    expect(tabsOf(hub).map((t) => t.label)).toEqual(['Today', 'Shopping', 'Chores', 'Folders']);
  });

  it('keeps a sanity cap', () => {
    const many = Array.from({ length: 40 }, (_, i) => `k${i}`);
    expect(cleanPins(many, new Set(many))).toHaveLength(MAX_PINS);
  });

  it('chooses the density from the tab count, Today and Projects included', () => {
    expect([3, 5].map((n) => barDensity(n))).toEqual(['comfy', 'comfy']);
    expect([6, 7].map((n) => barDensity(n))).toEqual(['snug', 'snug']);
    expect([8, 12, 26].map((n) => barDensity(n))).toEqual(['dock', 'dock', 'dock']);
  });

  it('keeps every label while editing: an equal grid up to 6 slots, a dock from 7', () => {
    expect([3, 5, 6].map((n) => barDensity(n, { editing: true }))).toEqual(['comfy', 'comfy', 'comfy']);
    expect([7, 8, 26].map((n) => barDensity(n, { editing: true }))).toEqual(['dock', 'dock', 'dock']);
  });

  it('placePin inserts, moves, clamps, and leaves a full bar alone', () => {
    expect(placePin(['a', 'b', 'c'], 'n', 1)).toEqual(['a', 'n', 'b', 'c']);
    // Moving: `at` counts the pins without it.
    expect(placePin(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(placePin(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(placePin(['a', 'b'], 'n', 99)).toEqual(['a', 'b', 'n']);
    expect(placePin(['a', 'b'], 'n', -3)).toEqual(['n', 'a', 'b']);
    const full = Array.from({ length: MAX_PINS }, (_, i) => `k${i}`);
    expect(placePin(full, 'n', 3)).toEqual(full);
    expect(placePin(full, 'k0', 3).slice(0, 4)).toEqual(['k1', 'k2', 'k3', 'k0']);
  });

  it('pinAt pins where it was dropped and hands back the bar before, for Undo', async () => {
    const hub = await guy();
    const todo = hub.lists().find((l) => l.name === 'To do')!;
    const before = pinAt(hub, `l:${todo.id}`, 1);
    expect(before).toEqual([S(hub)]);
    expect(pinsOf(hub)).toEqual([S(hub), `l:${todo.id}`]);
    pinAt(hub, 'search', 0);
    expect(pinsOf(hub)).toEqual(['search', S(hub), `l:${todo.id}`]);
    setPins(hub, before);
    expect(pinsOf(hub)).toEqual([S(hub)]);
  });
});

describe('hold-and-scrub maths', () => {
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

  it('steps the dock only past the outermost tab in view, so the edge tab can be picked', () => {
    const [l, r] = [70, 320];
    // The outermost tabs in view are centered at 91 and 304 (half under the fades).
    const step = (x: number, scroll = 50, max = 200) => edgeDir(x, l, r, scroll, max, 91, 304);
    expect(step(200)).toBe(0);
    // Resting on the edge tab's center picks it; nothing moves.
    expect(step(304)).toBe(0);
    expect(step(91)).toBe(0);
    // Past its center, toward the edge: step that way.
    expect(step(310)).toBe(1);
    expect(step(85)).toBe(-1);
    // Nothing more to see that way.
    expect(step(310, 200)).toBe(0);
    expect(step(85, 0)).toBe(0);
    // Past the scroller, over Today or Projects: no scrolling.
    expect(step(l - 5)).toBe(0);
    expect(step(r + 5)).toBe(0);
    // A tab well inside: only the outer strip under the fade steps.
    expect(edgeDir(r - EDGE_ZONE + 1, l, r, 50, 200, 120, 260)).toBe(1);
    expect(edgeDir(280, l, r, 50, 200, 120, 260)).toBe(1);
    expect(edgeDir(250, l, r, 50, 200, 120, 260)).toBe(0);
  });

  it('centers a slot without scrolling past either end', () => {
    expect(centerScroll(300, 50, 200, 600)).toBe(225);
    expect(centerScroll(10, 50, 200, 600)).toBe(0);
    expect(centerScroll(560, 50, 200, 600)).toBe(400);
    expect(centerScroll(100, 50, 400, 300)).toBe(0);
  });
});

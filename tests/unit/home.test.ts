import { describe, expect, it } from 'vitest';
import { Hub } from '../../src/core/hub';
import { addDays, today } from '../../src/core/dates';
import { MemoryPersistence } from '../../src/core/db';
import { Store } from '../../src/core/store';
import {
  aheadOf,
  DEFAULT_HOME,
  hiddenWidgets,
  hideHome,
  homeOf,
  homePreview,
  isDefaultHome,
  MAX_HOME_PROJECTS,
  pinnedProjects,
  reorderHome,
  resetHome,
  setHome,
  showHome,
  slotTitle,
  summaryOf,
  visibleHome,
  weekBands,
} from '../../src/app/home';
import { todayView } from '../../src/app/views';
import { couple as pair, listNamed, person, solo as alone, sync, type Side } from './_helpers';

const GUY: Side = { seed: ['groceries', 'home', 'chores', 'todo'] };
const solo = () => alone(GUY);
const couple = () => pair(GUY);

const keys = (slots: Array<{ key: string }>) => slots.map((s) => s.key);

describe('home layout', () => {
  it('starts from the defaults, and hides what needs a partner while solo', async () => {
    const hub = await solo();
    expect(homeOf(hub)).toEqual(DEFAULT_HOME);
    expect(isDefaultHome(hub)).toBe(true);
    expect(keys(visibleHome(hub))).toEqual(['today', 'quick', 'week', 'upcoming']);
    // The tray offers only what could show: never asks or partner while solo.
    expect(hiddenWidgets(hub)).toEqual([]);
  });

  it('shows the whole default page once paired', async () => {
    const { guy } = await couple();
    expect(keys(visibleHome(guy))).toEqual(['today', 'quick', 'week', 'upcoming']);
    expect(slotTitle(guy, 'week')).toBe('Us');
  });

  it('drops unknown and duplicate keys', async () => {
    const hub = await solo();
    hub.upsertMember('guy', {
      home: [
        { key: 'week', on: true },
        { key: 'mystery', on: true },
        { key: 'today', on: true },
        { key: 'week', on: false },
        null as never,
        { key: 42 as never, on: true },
      ],
    });
    const out = keys(homeOf(hub));
    expect(out).not.toContain('mystery');
    expect(out.filter((k) => k === 'week')).toHaveLength(1);
    expect(homeOf(hub).find((s) => s.key === 'week')!.on).toBe(true);
    // My order (week, then today) stands; the defaults I never stored go in after their predecessor.
    expect(out).toEqual(['week', 'upcoming', 'today', 'quick']);
  });

  it('drops a deleted or archived project, and keeps at most 3', async () => {
    const hub = await solo();
    const [a, b, c, d] = hub.lists();
    hub.upsertMember('guy', {
      home: [...DEFAULT_HOME, ...[a, b, c, d].map((l) => ({ key: `l:${l.id}`, on: true }))],
    });
    expect(pinnedProjects(hub)).toEqual([a.id, b.id, c.id]);
    expect(pinnedProjects(hub)).toHaveLength(MAX_HOME_PROJECTS);
    hub.deleteList(a.id);
    hub.updateList(b.id, { archived: true });
    expect(pinnedProjects(hub)).toEqual([c.id, d.id]);
  });

  it('keeps a pin to an archived project through edits, so restoring brings it back', async () => {
    const hub = await solo();
    const [a, b, c] = hub.lists();
    for (const l of [a, b, c]) showHome(hub, `l:${l.id}`);
    expect(pinnedProjects(hub)).toEqual([a.id, b.id, c.id]);
    hub.updateList(a.id, { archived: true });
    expect(pinnedProjects(hub)).toEqual([b.id, c.id]);
    // Editing Today meanwhile must not drop it.
    hideHome(hub, 'upcoming');
    reorderHome(hub, [...visibleHome(hub).map((s) => s.key)].reverse());
    hub.updateList(a.id, { archived: false });
    expect(pinnedProjects(hub)).toContain(a.id);
    expect(pinnedProjects(hub)).toHaveLength(3);
    // Unpinning a live project still removes it; a deleted one is let go on the next write.
    hideHome(hub, `l:${b.id}`);
    expect(pinnedProjects(hub)).not.toContain(b.id);
    hub.deleteList(c.id);
    hideHome(hub, 'upcoming');
    expect((hub.me()?.home ?? []).some((s) => s.key === `l:${c.id}`)).toBe(false);
  });

  it('a project pinned into an archived one’s slot keeps it when that one comes back', async () => {
    const hub = await solo();
    const home = hub.createList({ name: 'Home shopping', flavor: 'home' });
    const [a, b, c] = hub.lists();
    for (const l of [a, b, c]) showHome(hub, `l:${l.id}`);
    hub.updateList(c.id, { archived: true });
    expect(showHome(hub, `l:${home}`)).toBe(true);
    hub.updateList(c.id, { archived: false });
    expect(pinnedProjects(hub)).toEqual([a.id, b.id, home]);
  });

  it('"Back to the default" lets archived pins go too; Undo brings back what was stored', async () => {
    const hub = await solo();
    const [a] = hub.lists();
    showHome(hub, `l:${a.id}`);
    hideHome(hub, 'week');
    hub.updateList(a.id, { archived: true });
    const undo = resetHome(hub);
    hub.updateList(a.id, { archived: false });
    expect(isDefaultHome(hub)).toBe(true);
    expect(pinnedProjects(hub)).toEqual([]);
    hub.updateList(a.id, { archived: true });
    undo();
    hub.updateList(a.id, { archived: false });
    expect(pinnedProjects(hub)).toEqual([a.id]);
  });

  it("merges a widget I've never seen in after its predecessor, at its default", async () => {
    const hub = await solo();
    // An older build knew only these, in a custom order.
    hub.upsertMember('guy', {
      home: [
        { key: 'upcoming', on: true },
        { key: 'today', on: true },
        { key: 'asks', on: true },
      ],
    });
    // week follows its nearest known predecessor (upcoming).
    expect(keys(homeOf(hub))).toEqual(['upcoming', 'today', 'quick', 'week']);
  });

  it('keeps a hidden widget hidden', async () => {
    const hub = await solo();
    hideHome(hub, 'upcoming');
    expect(keys(visibleHome(hub))).toEqual(['today', 'quick', 'week']);
    expect(homeOf(hub).find((s) => s.key === 'upcoming')).toEqual({ key: 'upcoming', on: false });
    expect(hiddenWidgets(hub)).toContain('upcoming');
    expect(isDefaultHome(hub)).toBe(false);
  });

  it('reorders what shows and keeps hidden and unavailable entries in place', async () => {
    const hub = await solo();
    hideHome(hub, 'week');
    hideHome(hub, 'quick');
    // Visible: today, upcoming. Stored: today, quick(off), week(off), upcoming.
    reorderHome(hub, ['upcoming', 'today']);
    expect(keys(homeOf(hub))).toEqual(['upcoming', 'quick', 'week', 'today']);
    expect(homeOf(hub).find((s) => s.key === 'week')!.on).toBe(false);
    expect(keys(visibleHome(hub))).toEqual(['upcoming', 'today']);
    // Not a permutation of what shows: ignored.
    reorderHome(hub, ['today']);
    expect(keys(visibleHome(hub))).toEqual(['upcoming', 'today']);
  });

  it('brings things back right after the last visible block', async () => {
    const { guy } = await couple();
    hideHome(guy, 'week');
    expect(keys(visibleHome(guy))).toEqual(['today', 'quick', 'upcoming']);
    expect(showHome(guy, 'week')).toBe(true);
    expect(keys(visibleHome(guy)).at(-1)).toBe('week');
    expect(showHome(guy, 'nope')).toBe(false);
  });

  it('pins up to 3 projects, unpinning removes them, and old data still loads', async () => {
    const hub = await solo();
    const lists = hub.lists();
    for (const l of lists.slice(0, 3)) expect(showHome(hub, `l:${l.id}`)).toBe(true);
    expect(showHome(hub, `l:${lists[3].id}`)).toBe(false);
    expect(pinnedProjects(hub)).toHaveLength(3);
    hideHome(hub, `l:${lists[0].id}`);
    expect(homeOf(hub).some((s) => s.key === `l:${lists[0].id}`)).toBe(false);
    expect(slotTitle(hub, `l:${lists[1].id}`)).toBe(lists[1].name);
    // A member saved by an older build (no `home`) gets the defaults.
    hub.upsertMember('guy', { home: undefined });
    expect(homeOf(hub)).toEqual(DEFAULT_HOME);
    setHome(hub, DEFAULT_HOME);
    expect(isDefaultHome(hub)).toBe(true);
  });

  it('follows me to my other device', async () => {
    const { guy } = await couple();
    const phone = new Hub(guy.store, 'guy');
    hideHome(guy, 'upcoming');
    hideHome(guy, 'quick');
    reorderHome(guy, ['week', 'today']);
    expect(keys(visibleHome(phone))).toEqual(['week', 'today']);
  });
});

describe('home blocks', () => {
  it('the summary counts asks too, and names the busiest projects and the person', async () => {
    const { guy, hila } = await couple();
    const todo = listNamed(guy, 'To do').id;
    guy.addItem(todo, { title: 'Pay the bill', due: today() });
    guy.addItem(todo, { title: 'Call mum', due: today() });
    hila.addItem(listNamed(hila, 'To do').id, { title: 'Fix the kettle', assignee: 'guy' });
    sync(guy, hila);
    const s = summaryOf(guy, todayView(guy, today()));
    expect(s.n).toBe(3);
    expect(s.mood).toBe('busy');
    expect(s.person).toBe(true);
    expect(s.lists.map((l) => l.name)).toEqual(['To do']);
  });

  it('the summary counts an ask with a date on its day, not before; the person tag still shows', async () => {
    const { guy, hila } = await couple();
    const id = hila.addItem(listNamed(hila, 'To do').id, { title: 'Call the bank', assignee: 'guy', due: addDays(today(), 7) });
    sync(guy, hila);
    const s = summaryOf(guy, todayView(guy, today()));
    expect(s.n).toBe(0);
    expect(s.mood).toBe('free');
    expect(s.person).toBe(true);
    // On its day it counts (from Waiting on you).
    const due = guy.item(id)!.due!;
    expect(todayView(guy, due).asked.map((i) => i.id)).toContain(id);
  });

  it('the summary says all done once I have finished things today', async () => {
    const hub = await solo();
    const id = hub.addItem(listNamed(hub, 'To do').id, { title: 'Pay the bill', due: today() });
    expect(summaryOf(hub, todayView(hub, today())).mood).toBe('busy');
    hub.toggle(id);
    const s = summaryOf(hub, todayView(hub, today()));
    expect(s.n).toBe(0);
    expect(s.mood).toBe('done');
    expect(s.person).toBe(false);
  });

  it('week strips say "done this week" when solo, each tick counted once', async () => {
    const hub = await solo();
    hub.addShopping(listNamed(hub, 'Groceries').id, 'milk');
    const done = hub.addItem(listNamed(hub, 'To do').id, { title: 'Sweep' });
    hub.toggle(done);
    const v = todayView(hub, today());
    expect(weekBands(hub, v).map((b) => b.label)).toEqual(['done this week', 'Keep a moment']);
    expect(weekBands(hub, v)[0].num).toBe(1);
    hub.addMoment('Pancakes in bed', '🥰');
    expect(weekBands(hub, todayView(hub, today())).at(-1)).toMatchObject({ key: 'moments', num: '🥰', label: 'Pancakes in bed' });
  });

  it('chores are plain repeating tasks: due ones are in Today, mine and my partner\'s alike', async () => {
    const { guy } = await couple();
    const chores = listNamed(guy, 'Chores').id;
    expect(guy.list(chores)?.kind).toBe('tasks');
    guy.addItem(chores, { title: 'Dishes', repeat: { type: 'interval', every: 1, unit: 'day', from: 'done' }, due: today() });
    expect(todayView(guy, today()).today.map((i) => i.title)).toEqual(['Dishes']);
    expect(hiddenWidgets(guy)).not.toContain('chores');
  });

  it('coming up flattens the week ahead, and previews say what each block holds', async () => {
    const hub = await solo();
    const todo = listNamed(hub, 'To do').id;
    hub.addItem(todo, { title: 'Plumber', due: addDays(today(), 1) });
    hub.addItem(todo, { title: 'Car service', due: addDays(today(), 3), urgent: true });
    hub.addShopping(listNamed(hub, 'Groceries').id, 'milk', { urgent: true });
    hub.addShopping(listNamed(hub, 'Groceries').id, 'bread');
    const v = todayView(hub, today());
    expect(aheadOf(v).map((i) => i.title)).toEqual(['Plumber', 'Car service']);
    expect(homePreview('upcoming', hub, v)).toEqual({ text: '2 in the next 7 days', empty: false });
    expect(homePreview('today', hub, v)).toEqual({ text: 'Nothing due today', empty: true });
    expect(homePreview(`l:${todo}`, hub, v).text).toBe('2 open');
    expect(homePreview('asks', hub, v).empty).toBe(true);
  });

});

describe('Start here', () => {
  it('teaches by doing: steps tick themselves off, then it bows out', async () => {
    const { startTour, tourList, tourItem, tourDone, tourOpened, tourWatch } = await import('../../src/app/tour');
    const store = await Store.load(new MemoryPersistence(), 'dev-t', ['h', 'p:guy']);
    const hub = new Hub(store, 'guy');
    hub.upsertMember('guy', { name: 'Guy', color: 'lemon' });
    const todo = hub.createList({ name: 'To do', kind: 'tasks' });
    const id = startTour(hub);
    const list = tourList(hub)!;
    expect(list.id).toBe(id);
    expect(list.visibility).toBe('private');
    expect(startTour(hub)).toBe(id);
    const open = tourItem(hub, 'open')!;
    expect(hub.childrenOf(open.id).length).toBe(2);
    expect(tourWatch(hub)).toBe(false);
    tourOpened(hub, open);
    expect(hub.item(open.id)!.done).toBe(true);
    hub.addItem(todo, { title: 'Call mom' });
    tourWatch(hub);
    expect(tourItem(hub, 'add')!.done).toBe(true);
    const drag = tourItem(hub, 'drag')!;
    const first = hub.children(id, null)[0];
    hub.reorder(drag.id, null, first.id);
    tourWatch(hub);
    expect(tourItem(hub, 'drag')!.done).toBe(true);
    for (const k of ['tick', 'share', 'bar', 'person'] as const) tourDone(hub, k);
    expect(tourWatch(hub)).toBe(true);
  });
});


describe('My Highlights on Today', () => {
  it('holds the tasks I put there, open ones only; Undo takes it out again', async () => {
    const { setQuick, quickItems, isQuick } = await import('../../src/app/quick');
    const guy = await person('guy');
    const l = guy.createList({ name: 'Home' });
    const a = guy.addItem(l, { title: 'Book the dentist' });
    const b = guy.addItem(l, { title: 'Renew passport' });
    setQuick(a, true);
    const undo = setQuick(b, true);
    expect(quickItems(guy).map((i) => i.title)).toEqual(['Book the dentist', 'Renew passport']);
    undo();
    expect(isQuick(b)).toBe(false);
    guy.toggle(a);
    expect(quickItems(guy)).toEqual([]);
    setQuick(a, false);
  });
});

describe('Moments and the week', () => {
  it('finds the same day a year or a month ago', async () => {
    const { onThisDay } = await import('../../src/app/moments');
    const m = (day: string, text: string) => ({ id: day, day, text, feel: '🥰', by: 'g', createdAt: 0 });
    expect(onThisDay([m('2025-11-25', 'Snow!')], '2026-11-25')?.ago).toBe('A year ago today');
    expect(onThisDay([m('2026-09-25', 'Picnic')], '2026-11-25')?.ago).toBe('2 months ago today');
    expect(onThisDay([m('2026-11-24', 'x')], '2026-11-25')).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hub, seedHousehold } from '../../src/core/actions';
import { MemoryPersistence } from '../../src/core/db';
import { Store } from '../../src/core/store';
import { parseQuickAdd, type ParseContext } from '../../src/smart/parse';
import { addLabel, registerAdd, runAdd } from '../../src/app/addAction';
import {
  CHORE_REPEAT,
  composeDraft,
  composerPlaceholder,
  modeOf,
  overriddenTokens,
  parsedDraft,
} from '../../src/app/compose';
import { isFresh, markFresh } from '../../src/app/ui/fresh';
import { itemVisChoice, visFields } from '../../src/app/privacy';

const ctx: ParseContext = {
  now: new Date(2026, 10, 25, 9, 0), // a Wednesday morning
  members: [
    { id: 'guy', name: 'Guy' },
    { id: 'hila', name: 'Hila' },
  ],
  meId: 'guy',
  weekStart: 0,
};
const parse = (s: string, extra: Partial<ParseContext> = {}) => parseQuickAdd(s, { ...ctx, ...extra });

describe('New: one action per screen', () => {
  it('runs what the screen registered, with its label, and falls back when it leaves', () => {
    const fallback = vi.fn();
    const shop = vi.fn();
    expect(addLabel()).toBe('New');
    const off = registerAdd({ fn: shop, label: 'Add an item' });
    expect(addLabel()).toBe('Add an item');
    runAdd(fallback);
    expect(shop).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    off();
    expect(addLabel()).toBe('New');
    runAdd(fallback);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('a screen that leaves late never clears the next screen’s action', () => {
    const offA = registerAdd({ fn: () => {}, label: 'New chore' });
    const offB = registerAdd({ fn: () => {}, label: 'New project' });
    offA();
    expect(addLabel()).toBe('New project');
    offB();
    expect(addLabel()).toBe('New');
  });
});

describe('Adding: words, chips and modes', () => {
  it('the project kind picks the mode', () => {
    expect(modeOf('tasks')).toBe('task');
    expect(modeOf('chores')).toBe('chore');
    expect(modeOf('shopping')).toBe('shopping');
    expect(modeOf(undefined)).toBe('task');
  });

  it('a chore repeats every week from when it’s done unless the words say otherwise', () => {
    const plain = parsedDraft(parse('Dishes', { repeatFrom: 'done' }), { mode: 'chore', visibility: 'ours' });
    expect(plain.repeat).toEqual(CHORE_REPEAT);
    const said = parsedDraft(parse('Water plants every 3 days', { repeatFrom: 'done' }), { mode: 'chore', visibility: 'ours' });
    expect(said.repeat).toMatchObject({ type: 'interval', every: 3, unit: 'day' });
    expect(parsedDraft(parse('Call mom'), { mode: 'task', visibility: 'ours' }).repeat).toBeNull();
  });

  it('a screen’s default date holds until the words name one', () => {
    expect(parsedDraft(parse('Pay the bill'), { mode: 'task', defaultDue: '2026-11-25', visibility: 'ours' }).due).toBe('2026-11-25');
    expect(parsedDraft(parse('Pay the bill friday'), { mode: 'task', defaultDue: '2026-11-25', visibility: 'ours' }).due).toBe('2026-11-27');
  });

  it('chips win over words; a privacy the project doesn’t allow falls back', () => {
    const base = parsedDraft(parse('Call mom tomorrow'), { mode: 'task', visibility: 'ours' });
    const d = composeDraft(base, { due: '2026-12-01', visibility: 'private' }, ['ours', 'mine', 'private']);
    expect(d.due).toBe('2026-12-01');
    expect(d.visibility).toBe('private');
    expect(composeDraft(base, { visibility: 'theirs' }, ['ours', 'mine', 'private']).visibility).toBe('ours');
  });

  it('changing a chip the words also set turns those words back into text', () => {
    const p = parse('Call mom tomorrow 6pm @hila !');
    const d = parsedDraft(p, { mode: 'task', visibility: 'ours' });
    // A new date: only the date word goes back to text (the time stays understood).
    const keys = overriddenTokens(p, d, { due: '2026-12-01', dueTime: d.dueTime });
    expect(keys).toHaveLength(1);
    expect(p.tokens.find((t) => t.key === keys[0])?.kind).toBe('date');
    expect(parse('Call mom tomorrow 6pm @hila !', { ignore: new Set(keys) }).title).toBe('Call mom tomorrow');
    // Who and urgent.
    expect(overriddenTokens(p, d, { assignee: null }).map((k) => p.tokens.find((t) => t.key === k)?.kind)).toEqual(['assignee']);
    expect(overriddenTokens(p, d, { urgent: false }).map((k) => p.tokens.find((t) => t.key === k)?.kind)).toEqual(['urgent']);
    // Same value, or a field words can't set: nothing changes.
    expect(overriddenTokens(p, d, { due: d.due })).toEqual([]);
    expect(overriddenTokens(p, d, { visibility: 'mine', remind: 30 })).toEqual([]);
  });

  it('placeholders: one sentence per mode, "@P" only when paired', () => {
    expect(composerPlaceholder('shopping', 'Hila')).toBe('milk x2');
    expect(composerPlaceholder('chore', null)).toBe('Water plants every 3 days');
    expect(composerPlaceholder('task', 'Hila', 0.99)).toBe('Fix the tap @Hila');
    expect(composerPlaceholder('task', null, 0.99)).toBe('Pay rent every 1st');
    expect(composerPlaceholder('task', null, 0)).toBe('Call mom tomorrow 6pm');
  });
});

describe('Just added', () => {
  afterEach(() => vi.useRealTimers());

  it('a new row is fresh for a moment, then calm again', () => {
    vi.useFakeTimers();
    markFresh('a');
    expect(isFresh('a')).toBe(true);
    markFresh('b');
    expect(isFresh('a')).toBe(false);
    expect(isFresh('b')).toBe(true);
    vi.advanceTimersByTime(2300);
    expect(isFresh('b')).toBe(false);
  });
});

describe('Shopping adds carry who it’s for', () => {
  it('New on Shopping can make an item Hila’s; it stays one row', async () => {
    const guy = new Hub(await Store.load(new MemoryPersistence(), 'dev-guy', ['h', 'p:guy']), 'guy');
    guy.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    guy.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    seedHousehold(guy, ['groceries']);
    const groceries = guy.shoppingLists()[0];
    const f = visFields(guy, 'theirs');
    const res = guy.addShopping(groceries.id, 'eggs', { qty: '2', visibility: f.visibility, owner: f.owner });
    expect(res.kind).toBe('added');
    const eggs = guy.item(res.id)!;
    expect(eggs.qty).toBe('2');
    expect(eggs.owner).toBe('hila');
    expect(itemVisChoice(guy, eggs)).toBe('theirs');
    expect(guy.addShopping(groceries.id, 'Eggs', { qty: null }).kind).toBe('exists');
  });
});

describe('a date turns the notification on', () => {
  it('parsed or screen dates notify when due; undated stays off', async () => {
    const { withNotification } = await import('../../src/app/compose');
    expect(parsedDraft(parseQuickAdd('Call mom tomorrow 6pm', ctx), { mode: 'task', visibility: 'ours' }).remind).toBe(0);
    expect(parsedDraft(parseQuickAdd('Call mom', ctx), { mode: 'task', visibility: 'ours', defaultDue: '2026-11-25' }).remind).toBe(0);
    expect(parsedDraft(parseQuickAdd('Call mom', ctx), { mode: 'task', visibility: 'ours' }).remind).toBeNull();
    expect(withNotification({ remind: null }, '2026-11-26')).toEqual({ remind: 0 });
    expect(withNotification({ remind: 60 }, '2026-11-26')).toEqual({});
    expect(withNotification({ remind: null }, null)).toEqual({});
  });
});

describe('subtasks in the words', () => {
  it('"Task: a, b and c" is a task with subtasks; one thing after the colon stays one task', async () => {
    const { splitSteps } = await import('../../src/app/compose');
    expect(splitSteps('Pack for Eilat tomorrow: towels, sunscreen and hats')).toEqual({ head: 'Pack for Eilat tomorrow', steps: ['towels', 'sunscreen', 'hats'] });
    expect(splitSteps('Call mom: about Friday')).toEqual({ head: 'Call mom: about Friday', steps: [] });
    expect(splitSteps('Buy milk')).toEqual({ head: 'Buy milk', steps: [] });
    expect(splitSteps('קניות לשבת: חלה, יין')).toEqual({ head: 'קניות לשבת', steps: ['חלה', 'יין'] });
  });
});

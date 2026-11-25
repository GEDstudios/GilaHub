import { describe, expect, it } from 'vitest';
import { addMonths } from '../../src/core/dates';
import { itemKey, parseQuantity, splitPasted } from '../../src/smart/normalize';
import { parseQuickAdd, type ParseContext } from '../../src/smart/parse';
import { freshness, nextDue, shiftForAway, skipDue } from '../../src/smart/recurrence';
import { buyAgain, purchaseStats } from '../../src/smart/suggest';
import type { LogEntry, RepeatRule } from '../../src/core/model';

// Wednesday 25 Nov 2026, 10:00 local
const NOW = new Date(2026, 10, 25, 10, 0);
const ctx: ParseContext = {
  now: NOW,
  dayFirst: true,
  weekStart: 0,
  workdays: [0, 1, 2, 3, 4],
  meId: 'g',
  members: [
    { id: 'g', name: 'Guy' },
    { id: 'h', name: 'Hila' },
  ],
  lists: [
    { id: 'L1', name: 'Groceries' },
    { id: 'L2', name: 'Home stuff' },
  ],
};

describe('quick add parser', () => {
  it('parses date + time', () => {
    const r = parseQuickAdd('Call the plumber tomorrow 6pm', ctx);
    expect(r).toMatchObject({ title: 'Call the plumber', due: '2026-11-26', dueTime: '18:00' });
    expect(r.tokens.map((t) => t.kind).sort()).toEqual(['date', 'time']);
  });

  it('parses weekdays, assignees and urgency', () => {
    const r = parseQuickAdd('Book dinner friday @hila !', ctx);
    expect(r).toMatchObject({ title: 'Book dinner', due: '2026-11-27', assignee: 'h', urgent: true });
  });

  it('parses "next week" by the local week start', () => {
    expect(parseQuickAdd('Renew passport next week', ctx).due).toBe('2026-11-29');
  });

  it('parses day-first numeric dates and bare hours', () => {
    expect(parseQuickAdd('Dentist 5/12 at 10', ctx)).toMatchObject({ title: 'Dentist', due: '2026-12-05', dueTime: '10:00' });
    expect(parseQuickAdd('Dentist 5/12', { ...ctx, dayFirst: false }).due).toBe('2027-05-12');
  });

  it('rolls past times to tomorrow and reads evening hours', () => {
    expect(parseQuickAdd('Call mom at 8am', ctx)).toMatchObject({ due: '2026-11-26', dueTime: '08:00' });
    expect(parseQuickAdd('Meet at 5:30', ctx)).toMatchObject({ title: 'Meet', due: '2026-11-25', dueTime: '17:30' });
  });

  it('parses repeats with the right anchor', () => {
    expect(parseQuickAdd('Pay rent every month', ctx).repeat).toEqual({ type: 'interval', every: 1, unit: 'month', from: 'schedule' });
    expect(parseQuickAdd('Water plants every 3 days', { ...ctx, repeatFrom: 'done' }).repeat).toEqual({
      type: 'interval',
      every: 3,
      unit: 'day',
      from: 'done',
    });
    expect(parseQuickAdd('Bins every sun and wed', ctx)).toMatchObject({ title: 'Bins', repeat: { type: 'weekdays', days: [0, 3] }, due: '2026-11-25' });
    expect(parseQuickAdd('Standup every weekday', ctx).repeat).toEqual({ type: 'weekdays', days: [0, 1, 2, 3, 4] });
  });

  it('speaks basic Hebrew', () => {
    expect(parseQuickAdd('להתקשר לאמא מחר בשעה 5', ctx)).toMatchObject({ title: 'להתקשר לאמא', due: '2026-11-26', dueTime: '17:00' });
    expect(parseQuickAdd('לנקות מקרר כל שבועיים', ctx).repeat).toMatchObject({ type: 'interval', every: 2, unit: 'week' });
    expect(parseQuickAdd('ארוחת שישי בשישי', ctx)).toMatchObject({ title: 'ארוחת שישי', due: '2026-11-27' });
    expect(parseQuickAdd('לשלם חשבון חשמל דחוף', ctx)).toMatchObject({ title: 'לשלם חשבון חשמל', urgent: true });
  });

  it('stays conservative with ambiguous words', () => {
    expect(parseQuickAdd('Morning run', ctx)).toMatchObject({ title: 'Morning run', tokens: [] });
    expect(parseQuickAdd('Buy 1.5 liters of paint', ctx).due).toBeUndefined();
    expect(parseQuickAdd('Call mom!', ctx).urgent).toBeUndefined();
  });

  it('matches #lists by prefix', () => {
    expect(parseQuickAdd('Light bulbs #home', ctx)).toMatchObject({ title: 'Light bulbs', listId: 'L2' });
  });

  it('lets the user undo a token', () => {
    const r = parseQuickAdd('Pay tomorrow', { ...ctx, ignore: new Set(['date:tomorrow']) });
    expect(r).toMatchObject({ title: 'Pay tomorrow', tokens: [] });
  });

  it('parses quantities only in shopping mode', () => {
    expect(parseQuickAdd('2 milk !', { ...ctx, mode: 'shopping' })).toMatchObject({ title: 'milk', qty: '2', urgent: true });
    expect(parseQuickAdd('Milk tomorrow', { ...ctx, mode: 'shopping' })).toMatchObject({ title: 'Milk tomorrow' });
  });
});

describe('quantities & normalization', () => {
  it.each([
    ['2 milk', 'milk', '2'],
    ['milk x2', 'milk', '2'],
    ['eggs (12)', 'eggs', '12'],
    ['500g cheese', 'cheese', '500 g'],
    ['1 ק"ג עגבניות', 'עגבניות', '1 kg'],
    ['חצי קילו גבינה צהובה', 'גבינה צהובה', '½ kg'],
    ['Coca cola 1.5 L', 'Coca cola', '1.5 L'],
    ['3 tomatoes', 'tomatoes', '3'],
    ['7up', '7up', null],
    ['Bread', 'Bread', null],
  ])('%s', (input, name, qty) => {
    expect(parseQuantity(input)).toEqual({ name, qty });
  });

  it('folds Hebrew spelling variants and plurals to one key', () => {
    expect(itemKey('עגבנייה')).toBe(itemKey('עגבניות'));
    expect(itemKey("קוטג'")).toBe(itemKey('קוטג'));
    expect(itemKey('ביצים')).toBe(itemKey('ביצה'));
    expect(itemKey('Tomatoes')).toBe(itemKey('tomato'));
    expect(itemKey('Berries')).toBe(itemKey('berry'));
  });

  it('splits pasted lists from chats', () => {
    expect(splitPasted('- milk\n- 2 eggs\n• bread, butter\n\n1. jam')).toEqual(['milk', '2 eggs', 'bread', 'butter', 'jam']);
  });
});

describe('recurrence (two repeat types)', () => {
  const flexible: RepeatRule = { type: 'interval', every: 3, unit: 'day', from: 'done' };
  const weekly: RepeatRule = { type: 'interval', every: 1, unit: 'week', from: 'schedule' };
  const thursdays: RepeatRule = { type: 'weekdays', days: [4] };

  it('"after it\'s done" restarts from the completion day, early or late', () => {
    expect(nextDue(flexible, '2026-11-20', '2026-11-25')).toBe('2026-11-28');
    expect(nextDue(flexible, '2026-11-30', '2026-11-25')).toBe('2026-11-28');
  });

  it('"on set days": early completion counts for the coming occurrence', () => {
    expect(nextDue(weekly, '2026-11-26', '2026-11-25')).toBe('2026-12-03');
    expect(nextDue(thursdays, '2026-11-26', '2026-11-25')).toBe('2026-12-03');
  });

  it('"on set days": late completion collapses missed occurrences', () => {
    expect(nextDue(weekly, '2026-11-12', '2026-11-25')).toBe('2026-11-26');
    expect(nextDue(thursdays, '2026-11-12', '2026-11-25')).toBe('2026-11-26');
  });

  it('skips without recording', () => {
    expect(skipDue(thursdays, '2026-11-26')).toBe('2026-12-03');
  });

  it('clamps month ends', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('uses words for freshness', () => {
    expect(freshness('2026-12-05', '2026-11-25')).toBe('fresh');
    expect(freshness('2026-11-27', '2026-11-25')).toBe('soon');
    expect(freshness('2026-11-25', '2026-11-25')).toBe('today');
    expect(freshness('2026-11-20', '2026-11-25')).toBe('whenever');
  });

  it('away mode shifts flexible chores and collapses fixed ones', () => {
    expect(shiftForAway(flexible, '2026-11-20', 10, '2026-11-30')).toBe('2026-11-30');
    expect(shiftForAway(thursdays, '2026-11-12', 10, '2026-11-25')).toBe('2026-11-26');
  });
});

describe('buy again', () => {
  const DAY = 86_400_000;
  const t0 = new Date(2026, 9, 1).getTime();
  const logs: LogEntry[] = [0, 5, 10, 15].map((d, i) => ({
    id: `l${i}`,
    itemId: `i${i}`,
    kind: 'bought',
    key: 'milk',
    name: 'Milk',
    at: t0 + d * DAY,
    by: 'g',
  }));
  logs.push({ id: 'x', itemId: 'y', kind: 'bought', key: 'saffron', name: 'Saffron', at: t0, by: 'h' });
  const stats = purchaseStats(logs);

  it('suggests items whose usual interval has passed', () => {
    const out = buyAgain(stats, new Set(), { now: t0 + 20 * DAY });
    expect(out.map((s) => s.name)).toEqual(['Milk']);
    expect(Math.round(out[0].avgDays!)).toBe(5);
  });

  it('stays quiet when the item is already on the list or not yet due', () => {
    expect(buyAgain(stats, new Set(['milk']), { now: t0 + 20 * DAY })).toEqual([]);
    expect(buyAgain(stats, new Set(), { now: t0 + 16 * DAY })).toEqual([]);
  });
});

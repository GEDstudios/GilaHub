import { describe, expect, it } from 'vitest';
import { addMonths } from '../../src/core/dates';
import { itemKey, parseQuantity, splitPasted } from '../../src/smart/normalize';
import { parseQuickAdd, type ParseContext } from '../../src/smart/parse';
import { describeRule, firstDue, nextDue, shiftForAway, skipDue } from '../../src/smart/recurrence';
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

  it('keeps a little word that is the title\'s own ("ב", "on"), and drops one left before a date', () => {
    expect(parseQuickAdd('להתקשר לדנה ב', ctx).title).toBe('להתקשר לדנה ב');
    expect(parseQuickAdd('Put the kettle on', ctx).title).toBe('Put the kettle on');
    expect(parseQuickAdd('On call week', ctx).title).toBe('On call week');
    const he = parseQuickAdd('להתקשר לדנה ב 5/12', ctx);
    expect(he).toMatchObject({ title: 'להתקשר לדנה', due: '2026-12-05' });
    expect(parseQuickAdd('Dentist on friday', ctx)).toMatchObject({ title: 'Dentist', due: '2026-11-27' });
    expect(parseQuickAdd('tomorrow at the bank', ctx).title).toBe('the bank');
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

  it('hears urgency in words', () => {
    for (const s of ['Call the plumber urgent', 'Call the plumber urgently', 'URGENT Call the plumber', 'Call the plumber asap']) {
      expect(parseQuickAdd(s, ctx)).toMatchObject({ title: 'Call the plumber', urgent: true });
    }
    for (const s of ['להזמין אינסטלטור דחוף', 'להזמין אינסטלטור דחוףףףף', 'להזמין אינסטלטור בדחיפות', 'להזמין אינסטלטור מהר', 'דחוףף להזמין אינסטלטור']) {
      expect(parseQuickAdd(s, ctx)).toMatchObject({ title: 'להזמין אינסטלטור', urgent: true });
    }
    expect(parseQuickAdd('Read about urgency', ctx).urgent).toBeUndefined();
    expect(parseQuickAdd('לקנות מהרהר', ctx).urgent).toBeUndefined();
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

  it('reads quantities the same everywhere, but never a bare number at the end', () => {
    expect(parseQuickAdd('2 milk !', ctx)).toMatchObject({ title: 'milk', qty: '2', urgent: true });
    expect(parseQuickAdd('milk x3', ctx)).toMatchObject({ title: 'milk', qty: '3' });
    const rent = parseQuickAdd('Pay rent 3500', ctx);
    expect(rent.title).toBe('Pay rent 3500');
    expect(rent.qty ?? null).toBeNull();
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

  it('shifting by a pause moves a flexible chore by the days missed; a fixed one only catches up to its next day', () => {
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

describe('repeat on days of the month', () => {
  const firstAndFifteenth: RepeatRule = { type: 'monthdays', days: [1, 15] };
  const lastDay: RepeatRule = { type: 'monthdays', days: [-1] };

  it('describes itself in plain words', () => {
    expect(describeRule(firstAndFifteenth, String)).toBe('Every month on the 1st & 15th');
    expect(describeRule(lastDay, String)).toBe('Every month on the last day');
    expect(describeRule({ type: 'monthdays', days: [-1, 2, 23] }, String)).toBe('Every month on the 2nd, 23rd & last day');
  });

  it('starts on the next matching day (today counts) and folds short months', () => {
    expect(firstDue(firstAndFifteenth, '2026-11-25')).toBe('2026-12-01');
    expect(firstDue({ type: 'monthdays', days: [25] }, '2026-11-25')).toBe('2026-11-25');
    expect(firstDue({ type: 'monthdays', days: [31] }, '2027-02-01')).toBe('2027-02-28');
    expect(firstDue(lastDay, '2026-11-25')).toBe('2026-11-30');
  });

  it('early counts for the coming one; late collapses missed ones', () => {
    expect(nextDue(firstAndFifteenth, '2026-12-15', '2026-12-10')).toBe('2027-01-01');
    expect(nextDue(firstAndFifteenth, '2026-11-01', '2026-11-25')).toBe('2026-12-01');
    expect(skipDue(firstAndFifteenth, '2026-12-01')).toBe('2026-12-15');
    expect(nextDue(lastDay, '2027-01-31', '2027-01-31')).toBe('2027-02-28');
  });

  it('parses English and Hebrew', () => {
    expect(parseQuickAdd('Pay rent every month on the 1st', ctx)).toMatchObject({ title: 'Pay rent', repeat: { type: 'monthdays', days: [1] }, due: '2026-12-01' });
    expect(parseQuickAdd('Salary on the 10th of every month', ctx).repeat).toEqual({ type: 'monthdays', days: [10] });
    expect(parseQuickAdd('Water bill every 1st and 15th', ctx)).toMatchObject({ title: 'Water bill', repeat: { type: 'monthdays', days: [1, 15] } });
    expect(parseQuickAdd('Card payment last day of the month', ctx).repeat).toEqual({ type: 'monthdays', days: [-1] });
    expect(parseQuickAdd('ארנונה כל 1 ו-15 לחודש', ctx)).toMatchObject({ title: 'ארנונה', repeat: { type: 'monthdays', days: [1, 15] } });
    expect(parseQuickAdd('Water plants every 3 days', ctx).repeat?.type).toBe('interval');
  });
});

describe('#: a folder or a tag', () => {
  const lists = [
    { id: 'l1', name: 'Home shopping' },
    { id: 'l2', name: 'Chores' },
  ];
  const tags = [
    { id: 't1', name: 'Home' },
    { id: 't2', name: 'Money matters' },
  ];
  it('an exact name wins: a folder, then a tag', () => {
    expect(parseQuickAdd('Sweep #chores', { lists, tags })).toMatchObject({ title: 'Sweep', listId: 'l2' });
    const r = parseQuickAdd('Fix the shelf #home', { lists, tags });
    expect(r.title).toBe('Fix the shelf');
    expect(r.listId).toBeUndefined();
    expect(r.tagIds).toEqual(['t1']);
  });
  it('then a folder it starts, then a tag it starts, else a new tag', () => {
    expect(parseQuickAdd('Bulbs #home', { lists, tags: [] }).listId).toBe('l1');
    expect(parseQuickAdd('Pay rent #money', { lists, tags }).tagIds).toEqual(['t2']);
    const r = parseQuickAdd('Call the bank #errands #money', { lists, tags });
    expect(r).toMatchObject({ title: 'Call the bank', tagIds: ['t2'], newTags: ['errands'] });
    expect(parseQuickAdd('Room #12', { lists, tags }).newTags).toBeUndefined();
  });
});

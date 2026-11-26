import { describe, expect, it } from 'vitest';
import { addDays, today } from '../../src/core/dates';
import { dueMatches, parseSearch, runQuery } from '../../src/app/query';
import { person } from './_helpers';

describe('Search words and filters', () => {
  it('reads #tags, urgent, due words and the rest as words', async () => {
    const guy = await person('guy');
    const work = guy.createTag('Work')!;
    const { query, parts } = parseSearch(guy, '#wo urgent this week report');
    expect(query).toEqual({ tags: [work], urgent: true, due: 'thisweek', text: 'report' });
    expect(parts.map((p) => p.label)).toEqual(['#Work', 'Urgent', 'This week']);
    expect(parseSearch(guy, 'next week').query.due).toBe('nextweek');
    expect(parseSearch(guy, 'no date mine').query).toEqual({ due: 'nodate', side: 'mine' });
  });

  it('finds by tag, folder (and inside), due window and urgency, together', async () => {
    const guy = await person('guy');
    const home = guy.createList({ name: 'Home' });
    const kitchen = guy.createList({ name: 'Kitchen', parentId: home });
    const other = guy.createList({ name: 'Work' });
    const fix = guy.createTag('Fix')!;
    const ref = today();
    const a = guy.addItem(kitchen, { title: 'Fix the tap', due: addDays(ref, 1), urgent: true });
    guy.setTags(a, [fix]);
    const b = guy.addItem(home, { title: 'Fix the door', due: addDays(ref, 20) });
    guy.setTags(b, [fix]);
    const c = guy.addItem(other, { title: 'Fix the report', due: addDays(ref, 1) });
    guy.setTags(c, [fix]);
    const titles = (q: Parameters<typeof runQuery>[1]) => runQuery(guy, q, ref).map((i) => i.title).sort();
    expect(titles({ tags: [fix], listId: home })).toEqual(['Fix the door', 'Fix the tap']);
    expect(titles({ tags: [fix], due: 'next7' })).toEqual(['Fix the report', 'Fix the tap']);
    expect(titles({ urgent: true })).toEqual(['Fix the tap']);
    expect(titles({ text: 'fix door' })).toEqual(['Fix the door']);
    guy.toggle(a);
    expect(titles({ urgent: true })).toEqual([]);
    expect(titles({ urgent: true, done: true })).toEqual(['Fix the tap']);
  });

  it('weeks follow my week start', () => {
    // Thu 26 Nov 2026; week from Sunday: this week ends Sat 28, next week is 29 Nov – 5 Dec.
    const it = (due: string) => ({ due }) as never;
    expect(dueMatches(it('2026-11-28'), 'thisweek', '2026-11-26', 0)).toBe(true);
    expect(dueMatches(it('2026-11-29'), 'thisweek', '2026-11-26', 0)).toBe(false);
    expect(dueMatches(it('2026-11-29'), 'nextweek', '2026-11-26', 0)).toBe(true);
    expect(dueMatches(it('2026-12-05'), 'nextweek', '2026-11-26', 0)).toBe(true);
    expect(dueMatches(it('2026-12-06'), 'nextweek', '2026-11-26', 0)).toBe(false);
    expect(dueMatches(it('2026-11-25'), 'overdue', '2026-11-26', 0)).toBe(true);
  });
});

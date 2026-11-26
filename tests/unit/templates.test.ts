import { describe, expect, it } from 'vitest';
import { person } from './_helpers';

describe('A folder’s task template', () => {
  it('merges what’s set, clears with null, and has an Undo', async () => {
    const guy = await person('guy');
    const l = guy.createList({ name: 'Work' });
    const tag = guy.createTag('Work')!;
    guy.setListTemplate(l, { urgent: true, tags: [tag] });
    const undo = guy.setListTemplate(l, { remind: 30 });
    expect(guy.list(l)?.template).toEqual({ urgent: true, tags: [tag], remind: 30 });
    undo();
    expect(guy.list(l)?.template).toEqual({ urgent: true, tags: [tag] });
    guy.setListTemplate(l, null);
    expect(guy.list(l)?.template ?? null).toBeNull();
  });
});

describe('A task moved into a folder with a template', () => {
  it('takes it only when asked: tags added, the rest set; Undo puts it all back', async () => {
    const { applyTemplate } = await import('../../src/app/template');
    const guy = await person('guy');
    const from = guy.createList({ name: 'Home' });
    const to = guy.createList({ name: 'Work' });
    const work = guy.createTag('Work')!;
    const mine = guy.createTag('Calls')!;
    guy.setListTemplate(to, { urgent: true, tags: [work], remind: 30 });
    const id = guy.addItem(from, { title: 'Call the bank' });
    guy.setTags(id, [mine]);
    guy.move(id, { listId: to, parentId: null });
    expect(guy.item(id)?.urgent ?? false).toBe(false);
    const undo = applyTemplate(guy, id, to);
    expect(guy.item(id)).toMatchObject({ urgent: true, remind: 30 });
    expect(guy.tagsOf(guy.item(id)!).sort()).toEqual([mine, work].sort());
    undo();
    expect(guy.item(id)).toMatchObject({ urgent: false, remind: null });
    expect(guy.tagsOf(guy.item(id)!)).toEqual([mine]);
  });
});

describe('A template’s day, note and subtasks', () => {
  it('gives a new task its day and time, its note and subtasks; moving one in asks and Undo takes them off', async () => {
    const { templateDay, startFromTemplate, applyTemplate, templateSummary } = await import('../../src/app/template');
    const { addDays, today } = await import('../../src/core/dates');
    const guy = await person('guy');
    const l = guy.createList({ name: 'Bills' });
    guy.setListTemplate(l, { dueIn: 3, dueTime: '09:00', notes: 'Pay from the joint account', steps: ['Find the invoice', 'Pay it'] });
    const t = guy.list(l)!.template!;
    expect(templateDay(t, { due: null, dueTime: null })).toEqual({ due: addDays(today(), 3), dueTime: '09:00' });
    // A day typed or picked wins.
    expect(templateDay(t, { due: '2026-12-24', dueTime: null }).due).toBe('2026-12-24');
    const id = guy.addItem(l, { title: 'Electricity' });
    startFromTemplate(guy, id, t);
    expect(guy.item(id)?.notes).toBe('Pay from the joint account');
    expect(guy.childrenOf(id).map((c) => c.title)).toEqual(['Find the invoice', 'Pay it']);
    // Not twice.
    startFromTemplate(guy, id, t);
    expect(guy.childrenOf(id)).toHaveLength(2);
    expect(templateSummary(guy, t)).toContain('2 subtasks');
    // One moved in from elsewhere.
    const other = guy.createList({ name: 'Home' });
    const w = guy.addItem(other, { title: 'Water bill' });
    guy.move(w, { listId: l, parentId: null });
    const undo = applyTemplate(guy, w, l);
    expect(guy.item(w)).toMatchObject({ due: addDays(today(), 3), dueTime: '09:00', notes: 'Pay from the joint account' });
    expect(guy.childrenOf(w)).toHaveLength(2);
    undo();
    expect(guy.item(w)).toMatchObject({ due: null, notes: '' });
    expect(guy.childrenOf(w)).toHaveLength(0);
  });
});

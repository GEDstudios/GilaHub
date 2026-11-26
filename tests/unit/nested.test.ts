import { describe, expect, it } from 'vitest';
import { Hub } from '../../src/core/actions';
import { MemoryPersistence } from '../../src/core/db';
import { Store } from '../../src/core/store';

async function person(member: string) {
  const store = await Store.load(new MemoryPersistence(), `dev-${member}`, ['h', `p:${member}`]);
  return new Hub(store, member);
}

describe('projects inside projects', () => {
  it('sits a project inside another, all the way down', async () => {
    const hub = await person('guy');
    const house = hub.createList({ name: 'House', kind: 'tasks' });
    const kitchen = hub.createList({ name: 'Kitchen', kind: 'tasks', parentId: house });
    const drawers = hub.createList({ name: 'Drawers', kind: 'tasks', parentId: kitchen });
    const garden = hub.createList({ name: 'Garden', kind: 'tasks', parentId: house });
    expect(hub.topLists().map((l) => l.name)).toEqual(['House']);
    expect(hub.subLists(house).map((l) => l.name)).toEqual(['Kitchen', 'Garden']);
    expect(hub.nestedLists(house).map((l) => l.name)).toEqual(['Kitchen', 'Drawers', 'Garden']);
    expect(hub.listPath(drawers).map((l) => l.name)).toEqual(['House', 'Kitchen']);
    expect(hub.parentOf(garden)?.id).toBe(house);
  });

  it('never puts a project inside itself or its own insides', async () => {
    const hub = await person('guy');
    const house = hub.createList({ name: 'House', kind: 'tasks' });
    const kitchen = hub.createList({ name: 'Kitchen', kind: 'tasks', parentId: house });
    expect(hub.setListParent(house, house)).toBe(false);
    expect(hub.setListParent(house, kitchen)).toBe(false);
    expect(hub.topLists().map((l) => l.name)).toEqual(['House']);
    expect(hub.setListParent(kitchen, null)).toBe(true);
    expect(hub.topLists().map((l) => l.name)).toEqual(['House', 'Kitchen']);
  });

  it('surfaces at the top when its folder is archived or deleted, and goes back in after', async () => {
    const hub = await person('guy');
    const house = hub.createList({ name: 'House', kind: 'tasks' });
    hub.createList({ name: 'Kitchen', kind: 'tasks', parentId: house });
    hub.updateList(house, { archived: true });
    expect(hub.topLists().map((l) => l.name)).toEqual(['Kitchen']);
    hub.updateList(house, { archived: false });
    expect(hub.topLists().map((l) => l.name)).toEqual(['House']);
    const undo = hub.deleteList(house);
    expect(hub.topLists().map((l) => l.name)).toEqual(['Kitchen']);
    undo();
    expect(hub.subLists(house).map((l) => l.name)).toEqual(['Kitchen']);
  });

  it('reorders among its neighbours only', async () => {
    const hub = await person('guy');
    const house = hub.createList({ name: 'House', kind: 'tasks' });
    const a = hub.createList({ name: 'A', kind: 'tasks', parentId: house });
    hub.createList({ name: 'Top', kind: 'tasks' });
    const b = hub.createList({ name: 'B', kind: 'tasks', parentId: house });
    hub.moveList(b, a);
    expect(hub.subLists(house).map((l) => l.name)).toEqual(['B', 'A']);
    expect(hub.topLists().map((l) => l.name)).toEqual(['House', 'Top']);
  });
});

describe('a project for my person', () => {
  it('gives a project to my partner, keeps it in sight, and either of us can say whose it is', async () => {
    const hub = await person('guy');
    hub.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    hub.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    const id = hub.createList({ name: 'Her garden', kind: 'tasks', visibility: 'visible', owner: 'hila' });
    expect(hub.list(id)).toMatchObject({ visibility: 'visible', owner: 'hila' });
    expect(hub.store.scopeOf('list', id)).toBe('h');
    // One of hers that we both see can be made Private: it becomes mine, sealed with my key.
    hub.setListVisibility(id, 'private');
    expect(hub.list(id)).toMatchObject({ visibility: 'private', owner: 'guy' });
    expect(hub.store.scopeOf('list', id)).toBe('p:guy');
    hub.setListVisibility(id, 'visible', 'guy');
    expect(hub.list(id)?.owner).toBe('guy');
    hub.setListVisibility(id, 'visible', 'hila');
    hub.setListVisibility(id, 'shared');
    expect(hub.list(id)).toMatchObject({ visibility: 'shared', owner: null });
  });
});

describe('pictures on ideas', () => {
  it('stores a big picture in parts and puts it back together; a new one never mixes with the old', async () => {
    const hub = await person('guy');
    const id = hub.addIdea('The cart is confusing')!;
    const big = `data:image/jpeg;base64,${'A'.repeat(70_000)}`;
    hub.setIdeaShot(id, big);
    expect(hub.idea(id)?.shotN).toBe(3);
    expect(hub.ideaShot(id)).toBe(big);
    const small = `data:image/jpeg;base64,${'B'.repeat(100)}`;
    hub.setIdeaShot(id, small);
    expect(hub.ideaShot(id)).toBe(small);
    // A part from another picture (half-synced) isn't glued on.
    hub.store.mutate('idea', id, { shot0: 'zzzzzz:BBBB' });
    expect(hub.ideaShot(id)).toBeNull();
    hub.setIdeaShot(id, null);
    expect(hub.ideaShot(id)).toBeNull();
  });
});

describe('sticky notes', () => {
  it('stays where it was put, and a ticked one joins the collection', async () => {
    const hub = await person('guy');
    hub.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    hub.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    const id = hub.addNote('shop', 'Milk 💛', 'lemon')!;
    hub.placeNote(id, { x: 0.41234, y: 300.7, rot: -12.345 });
    expect(hub.store.get('note', id)).toMatchObject({ x: 0.412, y: 301, rot: -12.3 });
    expect(hub.notesOn('shop')).toHaveLength(1);
    // Hila ticks it (same store, her eyes)
    const hila = new Hub(hub.store, 'hila');
    hila.peelNote(id);
    expect(hub.notesOn('shop')).toHaveLength(0);
    expect(hub.collectedNotes().map((n) => n.text)).toEqual(['Milk 💛']);
    const undo = hub.deleteNote(id);
    expect(hub.collectedNotes()).toEqual([]);
    undo();
    expect(hub.collectedNotes()).toHaveLength(1);
  });
});

describe('notify again until done', () => {
  it('keeps notifying on its rhythm while it is open, and stops when it is done', async () => {
    const { desiredReminders } = await import('../../src/app/reminders');
    const { atLocal } = await import('../../src/core/dates');
    const hub = await person('guy');
    hub.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    const l = hub.createList({ name: 'Home', kind: 'tasks' });
    // Due Mon 23 Nov at 18:00, nagging every day; now is Thu 26 Nov, noon.
    const now = atLocal('2026-11-26', '12:00');
    const id = hub.addItem(l, { title: 'Call the bank', due: '2026-11-23', dueTime: '18:00', remind: 0, nag: { type: 'interval', every: 1, unit: 'day', from: 'schedule' } });
    const days = desiredReminders(hub, now)
      .filter((r) => r.id.startsWith(`${id}.n`))
      .map((r) => r.id.slice(-10));
    expect(days).toEqual(['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01']);
    expect(desiredReminders(hub, now).find((r) => r.id === `${id}.n2026-11-26`)?.note.body).toMatch(/^Still to do · was due/);
    // On set days only (Mon, Thu).
    hub.updateItem(id, { nag: { type: 'weekdays', days: [1, 4] } });
    expect(desiredReminders(hub, now).filter((r) => r.id.startsWith(`${id}.n`)).map((r) => r.id.slice(-10)).slice(0, 3)).toEqual(['2026-11-26', '2026-11-30', '2026-12-03']);
    hub.toggle(id);
    expect(desiredReminders(hub, now).filter((r) => r.id.startsWith(id))).toEqual([]);
  });

  it('on a repeating task: every day until this time is done, never twice on a day it is due anyway', async () => {
    const { desiredReminders } = await import('../../src/app/reminders');
    const { atLocal } = await import('../../src/core/dates');
    const hub = await person('guy');
    const l = hub.createList({ name: 'Home', kind: 'tasks' });
    // Rent: monthly on the 1st; a nudge every day until it's paid.
    const id = hub.addItem(l, { title: 'Pay rent', due: '2026-11-01', remind: 0, repeat: { type: 'monthdays', days: [1] }, nag: { type: 'interval', every: 1, unit: 'day', from: 'schedule' } });
    expect(hub.item(id)?.nag).toMatchObject({ unit: 'day' });
    const now = atLocal('2026-11-26', '12:00');
    const ids = desiredReminders(hub, now).filter((r) => r.id.startsWith(id)).map((r) => r.id);
    expect(ids.filter((x) => x.includes('.n'))).toEqual(['27', '28', '29', '30'].map((d) => `${id}.n2026-11-${d}`).concat([`${id}.n2026-12-02`, `${id}.n2026-12-03`]));
    expect(ids).toContain(`${id}.1`);
    hub.toggle(id);
    // Paid: this month's nagging stops; next month's starts after the 1st.
    expect(hub.item(id)?.due).toBe('2026-12-01');
    expect(desiredReminders(hub, now).filter((r) => r.id.includes('.n'))[0].id).toBe(`${id}.n2026-12-02`);
  });
});

describe('sticky notes, sized', () => {
  it('keeps a size between the smallest and biggest, and either of us can tick it', async () => {
    const { NOTE_MAX, NOTE_MIN } = await import('../../src/core/actions');
    const hub = await person('guy');
    hub.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    hub.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    const id = hub.addNote('shop', 'Milk', 'lemon')!;
    hub.placeNote(id, { x: 0.5, y: 100, rot: 0, scale: 9 });
    expect(hub.store.get('note', id)?.scale).toBe(NOTE_MAX);
    hub.placeNote(id, { x: 0.5, y: 100, rot: 0, scale: 0.1 });
    expect(hub.store.get('note', id)?.scale).toBe(NOTE_MIN);
    // The one who left it ticks it: collected, not gone.
    hub.peelNote(id);
    expect(hub.collectedNotes().map((n) => n.id)).toEqual([id]);
  });
});

describe('editing a note', () => {
  it('lets me change my own note’s words and paper, never my person’s', async () => {
    const hub = await person('guy');
    hub.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    hub.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    const id = hub.addNote('shop', 'Milk', 'lemon')!;
    hub.editNote(id, { text: '  Oat milk 💛 ', color: 'pink' });
    expect(hub.store.get('note', id)).toMatchObject({ text: 'Oat milk 💛', color: 'pink' });
    hub.editNote(id, { text: '   ' });
    expect(hub.store.get('note', id)?.text).toBe('Oat milk 💛');
    const hila = new Hub(hub.store, 'hila');
    hila.editNote(id, { text: 'Soy' });
    expect(hub.store.get('note', id)?.text).toBe('Oat milk 💛');
  });
});

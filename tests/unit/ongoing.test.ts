import { describe, expect, it } from 'vitest';
import { Hub } from '../../src/core/actions';
import { MemoryPersistence } from '../../src/core/db';
import { Store } from '../../src/core/store';

async function person(member: string) {
  const store = await Store.load(new MemoryPersistence(), `dev-${member}`, ['h', `p:${member}`]);
  return new Hub(store, member);
}

function sync(...hubs: Hub[]) {
  for (let round = 0; round < 3; round++) {
    for (const from of hubs) {
      const entries = from.store.pendingOutbox();
      for (const to of hubs) {
        if (to === from) continue;
        to.store.applyRemoteBatch(entries.filter((e) => to.store.canRead(e.s)).map((e) => e.op));
      }
      from.store.ack(entries.map((e) => e.cid));
    }
  }
}

describe('Ongoing (swiped right)', () => {
  it('puts an open top-level task in and takes it out; Undo puts it back', async () => {
    const guy = await person('guy');
    const l = guy.createList({ name: 'To do' });
    const id = guy.addItem(l, { title: 'Paint the hall' });
    const step = guy.addItem(l, { title: 'Buy paint', parentId: id });
    const undo = guy.setOngoing(id, true);
    expect(guy.item(id)).toMatchObject({ ongoingBy: 'guy' });
    expect(guy.item(id)?.ongoingAt).toBeGreaterThan(0);
    undo();
    expect(guy.item(id)?.ongoingAt).toBeNull();
    // A subtask doesn't go in by itself.
    guy.setOngoing(step, true);
    expect(guy.item(step)?.ongoingAt ?? null).toBeNull();
  });

  it('a ticked one stays in until cleared; Clear files it away', async () => {
    const guy = await person('guy');
    const l = guy.createList({ name: 'To do' });
    const id = guy.addItem(l, { title: 'Call the bank' });
    guy.setOngoing(id, true);
    guy.toggle(id);
    expect(guy.item(id)).toMatchObject({ done: true });
    expect(guy.item(id)?.ongoingAt).toBeGreaterThan(0);
    guy.clearDone([l], [id]);
    expect(guy.item(id)?.archived).toBe(true);
  });

  it('a repeating one done this time leaves Ongoing (it is back for next time)', async () => {
    const guy = await person('guy');
    const l = guy.createList({ name: 'Chores' });
    const id = guy.addItem(l, { title: 'Water the plants', due: '2026-11-26', repeat: { type: 'interval', every: 3, unit: 'day', from: 'done' } as never });
    guy.setOngoing(id, true);
    const undo = guy.toggle(id);
    expect(guy.item(id)?.ongoingAt ?? null).toBeNull();
    undo();
    expect(guy.item(id)?.ongoingAt).toBeGreaterThan(0);
  });
});

describe('Photos', () => {
  it('on a shared task, both of us see it; on an Only me task, only I do', async () => {
    const guy = await person('guy');
    const hila = await person('hila');
    const shared = guy.createList({ name: 'Home' });
    const mine = guy.createList({ name: 'Secret', visibility: 'private' });
    const a = guy.addItem(shared, { title: 'Fix the shelf' });
    const b = guy.addItem(mine, { title: 'Gift for Hila' });
    const url = `data:image/jpeg;base64,${'x'.repeat(70_000)}`;
    guy.addPhoto(`item:${a}`, url);
    guy.addPhoto(`item:${b}`, url);
    guy.addPhoto(`list:${shared}`, url);
    sync(guy, hila);
    const seen = (h: Hub, on: string) => h.photosOf(on).map((p) => h.shotOf('photo', p.id));
    expect(seen(hila, `item:${a}`)).toEqual([url]);
    expect(seen(hila, `list:${shared}`)).toEqual([url]);
    expect(seen(hila, `item:${b}`)).toEqual([]);
    expect(seen(guy, `item:${b}`)).toEqual([url]);
  });

  it('a task made Only me takes its photos with it; removing one has an Undo', async () => {
    const guy = await person('guy');
    const hila = await person('hila');
    const l = guy.createList({ name: 'Home' });
    const id = guy.addItem(l, { title: 'Surprise' });
    const p = guy.addPhoto(`item:${id}`, 'data:image/jpeg;base64,abc');
    expect(guy.store.scopeOf('photo', p)).toBe('h');
    guy.store.mutate('item', id, { private: true, owner: 'guy' });
    guy.rescope(id);
    expect(guy.store.scopeOf('photo', p)).toBe('p:guy');
    sync(guy, hila);
    expect(hila.photosOf(`item:${id}`)).toEqual([]);
    const undo = guy.removePhoto(p);
    expect(guy.photosOf(`item:${id}`)).toEqual([]);
    undo();
    expect(guy.photosOf(`item:${id}`).length).toBe(1);
  });
});

describe('Recent tags', () => {
  it('lists the tags set last first', async () => {
    const guy = await person('guy');
    const l = guy.createList({ name: 'To do' });
    const work = guy.createTag('Work')!;
    const garden = guy.createTag('Garden')!;
    const fun = guy.createTag('Fun')!;
    const a = guy.addItem(l, { title: 'Report' });
    const b = guy.addItem(l, { title: 'Weeds' });
    guy.setTags(a, [work]);
    guy.setTags(b, [garden]);
    expect(guy.recentTags().slice(0, 2)).toEqual([garden, work]);
    guy.setTags(a, [fun, work]);
    expect(guy.recentTags().slice(0, 3)).toEqual([fun, work, garden]);
  });
});

describe('How each of us looks at a folder', () => {
  it('is mine: my cards view does not change my partner’s list view', async () => {
    const guy = await person('guy');
    const hila = await person('hila');
    guy.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    hila.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    const l = guy.createList({ name: 'Trip' });
    sync(guy, hila);
    guy.setListView(l, 'cards');
    hila.setListView(l, 'tags');
    sync(guy, hila);
    expect(guy.viewOf(guy.list(l))).toBe('cards');
    expect(hila.viewOf(hila.list(l))).toBe('tags');
  });

  it('starts from the folder’s own default (Shopping is by tag for both)', async () => {
    const guy = await person('guy');
    const l = guy.createList({ name: 'Groceries', view: 'tags' });
    expect(guy.viewOf(guy.list(l))).toBe('tags');
    expect(guy.byAisle(l)).toBe(true);
  });
});

describe('Notes kept, and brought back', () => {
  it('a kept note comes back to its screen; Undo keeps it again', async () => {
    const guy = await person('guy');
    const id = guy.addNote('shop', 'Milk 💛', 'pink')!;
    guy.peelNote(id);
    expect(guy.collectedNotes().map((n) => n.id)).toEqual([id]);
    expect(guy.notesOn('shop')).toEqual([]);
    const undo = guy.unpeelNote(id);
    expect(guy.collectedNotes()).toEqual([]);
    expect(guy.notesOn('shop').map((n) => n.id)).toEqual([id]);
    undo();
    expect(guy.collectedNotes().map((n) => n.id)).toEqual([id]);
  });
});

describe('My private To-Do', () => {
  it('is made once per person, Private, first, with its description; my person never sees it', async () => {
    const guy = await person('guy');
    const hila = await person('hila');
    guy.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    hila.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    guy.createList({ name: 'Shopping' });
    const id = guy.ensurePersonalFolder()!;
    expect(id).toBe('todoguy');
    expect(guy.list(id)).toMatchObject({ name: 'To-Do', visibility: 'private', personal: true, description: 'My default private folder' });
    expect(guy.topLists()[0].id).toBe(id);
    // Not twice (another device of mine, or after a delete).
    expect(guy.ensurePersonalFolder()).toBeNull();
    guy.deleteList(id);
    expect(guy.ensurePersonalFolder()).toBeNull();
    sync(guy, hila);
    expect(hila.list(id)).toBeUndefined();
    // Hila gets her own.
    expect(hila.ensurePersonalFolder()).toBe('todohila');
  });
});

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

describe('Kept stocked', () => {
  it('goes on Shopping when low, turns urgent when very low, and is stocked up when bought', async () => {
    const guy = await person('guy');
    const shop = guy.createList({ name: 'Shopping' });
    guy.store.mutate('list', shop, { shopRoot: true });
    const pantry = guy.createList({ name: 'Pantry' });
    const oil = guy.addItem(pantry, { title: 'Olive oil' });
    guy.setStock(oil, { stock: 3, stockAddAt: 1, stockUrgentAt: 0 });
    const onList = () => guy.children(shop, null).filter((i) => !i.done && i.title === 'Olive oil');
    expect(onList()).toHaveLength(0);
    guy.useOne(oil);
    expect(onList()).toHaveLength(0);
    const undo = guy.useOne(oil);
    expect(guy.item(oil)?.stock).toBe(1);
    expect(onList()).toHaveLength(1);
    expect(onList()[0].urgent ?? false).toBe(false);
    // Undo takes it back off.
    undo();
    expect(guy.item(oil)?.stock).toBe(2);
    expect(onList()).toHaveLength(0);
    guy.useOne(oil);
    guy.useOne(oil);
    expect(guy.item(oil)?.stock).toBe(0);
    expect(onList()).toHaveLength(1);
    expect(onList()[0].urgent).toBe(true);
    // Bought two: stocked up by two, and off the list.
    const entry = onList()[0].id;
    guy.updateItem(entry, { qty: '2' });
    guy.toggle(entry);
    expect(guy.item(oil)).toMatchObject({ stock: 2, stockLink: null });
  });

  it('stocked again by hand: its entry leaves the list; one that was already there stays', async () => {
    const guy = await person('guy');
    const shop = guy.createList({ name: 'Shopping' });
    guy.store.mutate('list', shop, { shopRoot: true });
    const pantry = guy.createList({ name: 'Pantry' });
    const rice = guy.addItem(pantry, { title: 'Rice' });
    guy.setStock(rice, { stock: 1 });
    expect(guy.children(shop, null).filter((i) => i.title === 'Rice')).toHaveLength(1);
    guy.setStock(rice, { stock: 5 });
    expect(guy.children(shop, null).filter((i) => i.title === 'Rice')).toHaveLength(0);
    // Already on the list before it ran low: left alone.
    guy.addItem(shop, { title: 'Pasta' });
    const pasta = guy.addItem(pantry, { title: 'Pasta' });
    guy.setStock(pasta, { stock: 0 });
    guy.setStock(pasta, { stock: 4 });
    expect(guy.children(shop, null).filter((i) => i.title === 'Pasta')).toHaveLength(1);
  });
});

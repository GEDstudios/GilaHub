import { describe, expect, it } from 'vitest';
import { Hub, seedHousehold } from '../../src/core/actions';
import { addDays, today } from '../../src/core/dates';
import { MemoryPersistence } from '../../src/core/db';
import { Store } from '../../src/core/store';

async function person(member: string) {
  const store = await Store.load(new MemoryPersistence(), `dev-${member}`, ['h', `p:${member}`]);
  return new Hub(store, member);
}

/** Relay everything each hub may read, both ways, until quiet. */
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

async function couple() {
  const guy = await person('guy');
  const hila = await person('hila');
  guy.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
  seedHousehold(guy, ['groceries', 'home', 'chores', 'todo']);
  guy.createList({ name: "Guy's things", kind: 'tasks', color: 'sky', visibility: 'visible' });
  guy.createList({ name: 'Notes to self', kind: 'tasks', color: 'ink', visibility: 'private' });
  sync(guy, hila);
  hila.upsertMember('hila', { name: 'Hila', color: 'orange', createdAt: 2 });
  hila.createList({ name: 'Notes to self', kind: 'tasks', color: 'pink', visibility: 'private' });
  sync(guy, hila);
  return { guy, hila };
}

const listNamed = (hub: Hub, name: string) => hub.lists().find((l) => l.name === name)!;

describe('Hub: household & privacy', () => {
  it('creates only the picked projects, plus each person’s private ones', async () => {
    const { guy, hila } = await couple();
    expect(hila.lists().map((l) => l.name)).toEqual(expect.arrayContaining(['To do', 'Groceries', 'Home shopping', 'Chores', "Guy's things", 'Notes to self']));
    expect(hila.lists().filter((l) => l.kind === 'shopping')).toHaveLength(2);
    // Each sees exactly one "Notes to self": their own.
    expect(guy.lists().filter((l) => l.name === 'Notes to self')).toHaveLength(1);
    expect(hila.lists().filter((l) => l.name === 'Notes to self')).toHaveLength(1);
    const mine = listNamed(guy, 'Notes to self');
    const secret = guy.addItem(mine.id, { title: 'Therapy notes' });
    sync(guy, hila);
    expect(hila.item(secret)).toBeUndefined();
  });

  it('"Mine" items: the partner sees and can help, but privacy stays the owner\'s call', async () => {
    const { guy, hila } = await couple();
    const list = listNamed(guy, "Guy's things");
    const id = guy.addItem(list.id, { title: 'Supper: lentil soup' });
    sync(guy, hila);
    const seen = hila.item(id)!;
    expect(seen.title).toBe('Supper: lentil soup');
    expect(hila.canEdit(seen)).toBe(true);
    expect(hila.canSetPrivacy(seen)).toBe(false);
    expect(guy.canEdit(guy.item(id)!)).toBe(true);
    expect(guy.canSetPrivacy(guy.item(id)!)).toBe(true);
  });

  it('per-item privacy inside a shared list (gift surprise)', async () => {
    const { guy, hila } = await couple();
    const groceries = listNamed(guy, 'Groceries');
    const res = guy.addShopping(groceries.id, 'Chocolate for Hila', { visibility: 'private' });
    sync(guy, hila);
    expect(hila.item(res.id)).toBeUndefined();
    expect(guy.item(res.id)?.title).toBe('Chocolate for Hila');
    // Make it shared later → it appears for her.
    guy.setItemVisibility(res.id, 'ours');
    sync(guy, hila);
    expect(hila.item(res.id)?.title).toBe('Chocolate for Hila');
  });

  it('making a whole list private removes it and its items from the partner', async () => {
    const { guy, hila } = await couple();
    const id = guy.createList({ name: 'Plans', kind: 'tasks', color: 'lilac' });
    const a = guy.addItem(id, { title: 'Anniversary' });
    const b = guy.addItem(id, { title: 'Book the place', parentId: a });
    sync(guy, hila);
    expect(hila.item(b)?.title).toBe('Book the place');
    guy.setListVisibility(id, 'private');
    sync(guy, hila);
    expect(hila.list(id)).toBeUndefined();
    expect(hila.item(a)).toBeUndefined();
    expect(hila.item(b)).toBeUndefined();
    expect(guy.item(b)?.title).toBe('Book the place');
  });

  it('steps inherit privacy from their parent', async () => {
    const { guy, hila } = await couple();
    const todo = listNamed(guy, 'To do');
    const parent = guy.addItem(todo.id, { title: 'Surprise party', visibility: 'private' });
    const step = guy.addItem(todo.id, { title: 'Invite friends', parentId: parent });
    sync(guy, hila);
    expect(hila.item(parent)).toBeUndefined();
    expect(hila.item(step)).toBeUndefined();
    expect(guy.visibilityOf(guy.item(step)!)).toBe('private');
  });
});

describe('Hub: shopping', () => {
  it('never duplicates: exists → reported, crossed off → brought back', async () => {
    const { guy, hila } = await couple();
    const g = listNamed(guy, 'Groceries');
    const first = guy.addShopping(g.id, '2 milk');
    expect(first.kind).toBe('added');
    expect(guy.item(first.id)?.qty).toBe('2');
    sync(guy, hila);
    expect(hila.addShopping(g.id, 'Milk').kind).toBe('exists');
    hila.toggle(first.id);
    sync(guy, hila);
    const again = guy.addShopping(g.id, 'milk');
    expect(again).toMatchObject({ kind: 'revived', id: first.id });
  });

  it('logs purchases and files the cart on finish', async () => {
    const { guy } = await couple();
    const g = listNamed(guy, 'Groceries');
    const { id } = guy.addShopping(g.id, 'Eggs');
    guy.toggle(id);
    expect(guy.store.all('log').some((l) => l.kind === 'bought' && l.key === 'egg')).toBe(true);
    guy.finishTrip([g.id]);
    expect(guy.item(id)?.archived).toBe(true);
  });

  it('learns an aisle correction for both partners', async () => {
    const { guy, hila } = await couple();
    const g = listNamed(guy, 'Groceries');
    const { id } = guy.addShopping(g.id, 'Zaatar crackers');
    guy.setCategory(id, 'snacks');
    sync(guy, hila);
    const res = hila.addShopping(g.id, 'zaatar crackers ');
    expect(res.kind).toBe('exists');
    const fresh = hila.addItem(g.id, { title: 'Zaatar Crackers' });
    expect(hila.categoryFor(hila.item(fresh)!).category).toBe('snacks');
  });
});

describe('Hub: chores', () => {
  it('take turns passes the turn to the other person, whoever did it', async () => {
    const { guy, hila } = await couple();
    const chores = listNamed(guy, 'Chores');
    const id = guy.addItem(chores.id, { title: 'Bins', repeat: { type: 'interval', every: 3, unit: 'day', from: 'done' }, assignee: 'turns' });
    sync(guy, hila);
    hila.completeRepeating(id);
    sync(guy, hila);
    expect(guy.item(id)?.turn).toBe('guy');
    expect(guy.item(id)?.due).toBe(addDays(today(), 3));
    expect(guy.logsFor(id)[0]?.by).toBe('hila');
  });

  it('done yesterday counts from yesterday', async () => {
    const { guy } = await couple();
    const chores = listNamed(guy, 'Chores');
    const id = guy.addItem(chores.id, { title: 'Vacuum', repeat: { type: 'interval', every: 7, unit: 'day', from: 'done' } });
    guy.completeRepeating(id, addDays(today(), -1));
    expect(guy.item(id)?.due).toBe(addDays(today(), 6));
  });

  it('thanks travel to the partner', async () => {
    const { guy, hila } = await couple();
    const chores = listNamed(guy, 'Chores');
    const id = guy.addItem(chores.id, { title: 'Dishes', repeat: { type: 'interval', every: 1, unit: 'day', from: 'done' } });
    guy.completeRepeating(id);
    sync(guy, hila);
    const log = hila.logsFor(id)[0];
    hila.thank(log.id);
    sync(guy, hila);
    expect(guy.logsFor(id)[0].thankedBy).toBe('hila');
  });
});

describe('Hub: backup import', () => {
  it('re-imports private items under the personal key, never shared', async () => {
    const { guy, hila } = await couple();
    const todo = listNamed(guy, 'To do');
    const secret = guy.addItem(todo.id, { title: 'Proposal plan', visibility: 'private' });
    const step = guy.addItem(todo.id, { title: 'Call her parents', parentId: secret });
    sync(guy, hila);
    const backup = Object.fromEntries((['member', 'list', 'item', 'log', 'memory', 'store', 'settings'] as const).map((t) => [t, guy.store.all(t)]));

    // Guy restores the backup on a brand-new phone (same member and keys).
    const phone = await person('guy');
    const n = phone.importBackup(JSON.parse(JSON.stringify(backup)));
    expect(n).toBeGreaterThan(5);
    expect(phone.store.scopeOf('item', secret)).toBe('p:guy');
    expect(phone.store.scopeOf('item', step)).toBe('p:guy');

    // Even if the restored phone's ops reached Hila, she can't read them.
    const fresh = await person('hila');
    sync(phone, fresh);
    expect(fresh.item(secret)).toBeUndefined();
    expect(fresh.item(step)).toBeUndefined();
    expect(fresh.lists().some((l) => l.name === 'To do')).toBe(true);
  });
});

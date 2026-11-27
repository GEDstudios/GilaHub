import { describe, expect, it } from 'vitest';
import { Hub } from '../../src/core/hub';
import { seedHousehold } from '../../src/core/seed';
import { isForMe, projectView } from '../../src/app/views';
import { addDays, today } from '../../src/core/dates';
import { MemoryPersistence } from '../../src/core/db';
import { Store } from '../../src/core/store';
import { couple as pair, listNamed, person, sync, type Side } from './_helpers';

const GUY: Side = {
  seed: ['groceries', 'home', 'chores', 'todo'],
  lists: [
    { name: "Guy's things", kind: 'tasks', color: 'sky', visibility: 'visible' },
    { name: 'Notes to self', kind: 'tasks', color: 'ink', visibility: 'private' },
  ],
};
const HILA: Side = { color: 'orange', lists: [{ name: 'Notes to self', kind: 'tasks', color: 'pink', visibility: 'private' }] };
const couple = () => pair(GUY, HILA);

describe('Hub: household & privacy', () => {
  it('creates only the picked projects, plus each person’s private ones', async () => {
    const { guy, hila } = await couple();
    expect(hila.lists().map((l) => l.name)).toEqual(expect.arrayContaining(['Shopping', 'To do', 'Groceries', 'Home shopping', 'Chores', "Guy's things", 'Notes to self']));
    // The two shopping lists are projects inside Shopping.
    expect(hila.nestedLists(hila.shopRoot()!.id).map((l) => l.name)).toEqual(['Groceries', 'Home shopping']);
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
    // Either of us can make a shared thing ours, mine or theirs again; Only me stays the owner's alone.
    expect(hila.canSetPrivacy(seen)).toBe(true);
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

  it('a "Mine" project can hold things for both of us, steps included', async () => {
    const { guy, hila } = await couple();
    const list = listNamed(guy, "Guy's things");
    const task = guy.addItem(list.id, { title: 'Plan the weekend' });
    expect(guy.visibilityOf(guy.item(task)!)).toBe('mine');
    const step = guy.addItem(list.id, { title: 'Pick a hike', parentId: task, visibility: 'ours' });
    const secret = guy.addItem(list.id, { title: 'Book the surprise', parentId: task, visibility: 'private' });
    guy.setItemVisibility(task, 'ours');
    sync(guy, hila);
    expect(hila.visibilityOf(hila.item(task)!)).toBe('ours');
    expect(hila.visibilityOf(hila.item(step)!)).toBe('ours');
    expect(hila.ownerOf(hila.item(step)!)).toBeNull();
    expect(hila.item(secret)).toBeUndefined();
    // Back to Mine: it belongs to the project's owner, whoever sets it.
    hila.setItemVisibility(task, 'mine');
    sync(guy, hila);
    expect(guy.ownerOf(guy.item(task)!)).toBe('guy');
  });

  it('I can make something my partner\'s: theirs, on their Today, and I can still change it', async () => {
    const { guy, hila } = await couple();
    const todo = listNamed(guy, 'To do');
    const id = guy.addItem(todo.id, { title: 'Call your mom', visibility: 'mine', owner: 'hila' });
    sync(guy, hila);
    const seen = hila.item(id)!;
    expect(hila.ownerOf(seen)).toBe('hila');
    expect(hila.visibilityOf(seen)).toBe('mine');
    expect(guy.canSetPrivacy(guy.item(id)!)).toBe(true);
    expect(isForMe(hila, seen)).toBe(true);
    expect(isForMe(guy, guy.item(id)!)).toBe(false);
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

  it('logs every tick, and Clear files the tray away', async () => {
    const { guy } = await couple();
    const g = listNamed(guy, 'Groceries');
    const { id } = guy.addShopping(g.id, 'Eggs');
    guy.toggle(id);
    expect(guy.store.all('log').some((l) => l.kind === 'bought' && l.key === 'egg')).toBe(true);
    guy.clearDone([g.id]);
    expect(guy.item(id)?.archived).toBe(true);
  });

  it('learns an aisle correction for both partners', async () => {
    const { guy, hila } = await couple();
    const g = listNamed(guy, 'Groceries');
    const { id } = guy.addShopping(g.id, 'Zaatar crackers');
    guy.setTags(id, ['g:snacks']);
    sync(guy, hila);
    const res = hila.addShopping(g.id, 'zaatar crackers ');
    expect(res.kind).toBe('exists');
    const fresh = hila.addItem(g.id, { title: 'Zaatar Crackers' });
    expect(hila.tagsOf(hila.item(fresh)!)).toEqual(['g:snacks']);
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

  it('a new chore starts fresh: due one period from now, not today', async () => {
    const { guy } = await couple();
    const chores = listNamed(guy, 'Chores');
    const weekly = guy.addItem(chores.id, { title: 'Laundry', repeat: { type: 'interval', every: 1, unit: 'week', from: 'done' } });
    const daily = guy.addItem(chores.id, { title: 'Dishes', repeat: { type: 'interval', every: 1, unit: 'day', from: 'done' } });
    expect(guy.item(weekly)?.due).toBe(addDays(today(), 7));
    expect(guy.item(daily)?.due).toBe(addDays(today(), 1));
    const dated = guy.addItem(chores.id, { title: 'Bins', due: today(), repeat: { type: 'interval', every: 1, unit: 'week', from: 'done' } });
    expect(guy.item(dated)?.due).toBe(today());
  });

  it('skipping one that is weeks behind skips what was missed too: the next one is not in the past', async () => {
    const { guy } = await couple();
    const chores = listNamed(guy, 'Chores');
    const id = guy.addItem(chores.id, { title: 'Bins', due: addDays(today(), -15), repeat: { type: 'interval', every: 1, unit: 'week', from: 'schedule' } });
    const undo = guy.skip(id);
    expect(guy.item(id)?.due).toBe(addDays(today(), 6));
    undo();
    expect(guy.item(id)?.due).toBe(addDays(today(), -15));
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

  it('restoring my own backup on a new device makes nobody new, no second projects, and my private things mine', async () => {
    const old = await person('old');
    old.upsertMember('old', { name: 'Guy', color: 'sky', createdAt: 1 });
    seedHousehold(old, ['groceries', 'chores', 'todo']);
    const secret = old.addItem(listNamed(old, 'To do').id, { title: 'Ring', visibility: 'private' });
    const milk = old.addItem(listNamed(old, 'Groceries').id, { title: 'milk' });
    old.addIdea('Bigger fonts');
    const data = JSON.parse(JSON.stringify(Object.fromEntries((['member', 'list', 'item', 'log', 'memory', 'store', 'settings', 'idea'] as const).map((t) => [t, old.store.all(t)]))));

    for (const me of ['old', undefined]) {
      // A fresh device: a new member id, the same starter projects.
      const phone = await person('new');
      phone.upsertMember('new', { name: 'Guy', color: 'lemon', createdAt: 5 });
      seedHousehold(phone, ['groceries', 'chores', 'todo']);
      phone.importBackup(data, { me });
      expect(phone.partner()).toBeUndefined();
      expect(phone.members()).toHaveLength(1);
      expect(phone.lists()).toHaveLength(4);
      expect(phone.item(secret)?.title).toBe('Ring');
      expect(phone.store.scopeOf('item', secret)).toBe('p:new');
      expect(phone.item(milk)?.listId).toBe(listNamed(phone, 'Groceries').id);
      expect(phone.item(milk)?.createdBy).toBe('new');
      expect(phone.store.all('idea')[0]?.by).toBe('new');
    }
  });

  it('an older paired backup (no `me`) restores my Only-me things as mine and keeps asks pointing the right way', async () => {
    const { guy, hila } = await couple();
    const todo = listNamed(guy, 'To do').id;
    const secret = guy.addItem(todo, { title: 'Secret surprise', visibility: 'private' });
    const ask = guy.addItem(todo, { title: 'Renew passports', assignee: 'hila' });
    sync(guy, hila);
    const tables = ['member', 'list', 'item', 'log', 'memory', 'store', 'settings', 'idea'] as const;
    const data = JSON.parse(JSON.stringify(Object.fromEntries(tables.map((t) => [t, guy.store.all(t)]))));
    expect(data.member).toHaveLength(2);

    // A new phone, alone; and a new phone already paired again with Hila.
    const solo = await person('new');
    solo.upsertMember('new', { name: 'Guy', color: 'lemon', createdAt: 5 });
    const paired = await person('new2');
    paired.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    paired.upsertMember('new2', { name: 'Guy', color: 'lemon', createdAt: 5 });
    for (const phone of [solo, paired]) {
      expect(phone.backupOwner(data)).toBe('guy');
      phone.importBackup(data);
      expect(phone.item(secret)?.title).toBe('Secret surprise');
      expect(phone.store.scopeOf('item', secret)).toBe(`p:${phone.meId}`);
      expect(phone.item(ask)?.requestedBy).toBe(phone.meId);
      expect(phone.item(ask)?.assignee).toBe('hila');
    }
  });

  it('a restore that sealed things under an old me can be run again to repair them', async () => {
    const old = await person('old');
    old.upsertMember('old', { name: 'Guy', color: 'sky', createdAt: 1 });
    seedHousehold(old, ['todo']);
    const secret = old.addItem(listNamed(old, 'To do').id, { title: 'Ring', visibility: 'private' });
    const data = JSON.parse(JSON.stringify(Object.fromEntries((['member', 'list', 'item'] as const).map((t) => [t, old.store.all(t)]))));
    const phone = await person('new');
    phone.upsertMember('new', { name: 'Guy', color: 'lemon', createdAt: 5 });
    // What an older build did: nobody mapped, so the ring sits under p:old, unreadable here.
    phone.importBackup(data, { me: 'new' });
    expect(phone.item(secret)).toBeUndefined();
    phone.importBackup(data);
    expect(phone.item(secret)?.title).toBe('Ring');
    expect(phone.store.scopeOf('item', secret)).toBe('p:new');
  });

  it('asks whose an older backup is when nothing in it tells', async () => {
    const { guy } = await couple();
    const data = JSON.parse(JSON.stringify(Object.fromEntries((['member', 'list', 'item'] as const).map((t) => [t, guy.store.all(t).filter((r) => !('visibility' in r) || r.visibility !== 'private')]))));
    const phone = await person('new');
    phone.upsertMember('new', { name: 'Guy', color: 'lemon', createdAt: 5 });
    expect(phone.backupOwner(data)).toBeNull();
    expect(phone.backupStrangers(data).map((m) => m.name)).toEqual(['Guy', 'Hila']);
  });

  it('a restore never adds the partner on a device that isn’t paired', async () => {
    const { guy } = await couple();
    const data = JSON.parse(JSON.stringify(Object.fromEntries((['member', 'list', 'item'] as const).map((t) => [t, guy.store.all(t)]))));
    const phone = await person('new');
    phone.upsertMember('new', { name: 'Guy', color: 'lemon', createdAt: 5 });
    phone.importBackup(data);
    expect(phone.partner()).toBeUndefined();
  });
});

describe('Shopping: urgent', () => {
  it('the Urgent card reads in walking order, and arranging an aisle is what moves it', async () => {
    const guy = await person('guy');
    seedHousehold(guy, ['groceries', 'home']);
    const g = listNamed(guy, 'Groceries').id;
    const h = listNamed(guy, 'Home shopping').id;
    const batteries = guy.addShopping(h, 'batteries', { urgent: true }).id;
    const shampoo = guy.addShopping(g, 'shampoo', { urgent: true }).id;
    const milk = guy.addShopping(g, 'milk', { urgent: true }).id;
    const cream = guy.addShopping(g, 'sour cream', { urgent: true }).id;
    const apples = guy.addShopping(g, 'apples', { urgent: true }).id;
    const root = guy.shopRoot()!.id;
    const urgent = () => projectView(guy, root, true, 'tags', {}).urgent.map((i) => i.id);
    // Fruit & Veg, Dairy, Personal care, then the home departments.
    expect(urgent()).toEqual([apples, milk, cream, shampoo, batteries]);
    // Arranging Dairy is the one way to change where sour cream sits in the walk.
    guy.reorder(cream, null, milk);
    const dairy = projectView(guy, root, true, 'tags', {}).groups.find((x) => x.tag === 'g:dairy')!.items.map((i) => i.id);
    expect(dairy).toEqual([cream, milk]);
    expect(urgent()).toEqual([apples, cream, milk, shampoo, batteries]);
  });

  it('an aisle mixing two lists puts a dropped row exactly where it was dropped', async () => {
    const guy = await person('guy');
    seedHousehold(guy, ['groceries']);
    const g = listNamed(guy, 'Groceries').id;
    const root = guy.shopRoot()!.id;
    const m = guy.createList({ name: 'Market', flavor: 'grocery', parentId: root });
    // Each list numbers its own keys from the start, so the two lists tie row for row.
    for (const t of ['milk', 'yogurt', 'cottage']) guy.addShopping(g, t);
    for (const t of ['butter', 'cream cheese', 'kefir']) guy.addShopping(m, t);
    const dairy = () => projectView(guy, root, true, 'tags', {}).groups.find((x) => x.tag === 'g:dairy')!.items.map((i) => i.id);
    const before = dairy();
    expect(new Set(before.map((id) => guy.item(id)!.order)).size).toBe(3);
    // Every row into every slot reads back as dropped, one drop after another.
    for (const id of before) {
      for (let to = 0; to < before.length; to++) {
        const seq = dairy().filter((x) => x !== id);
        seq.splice(to, 0, id);
        guy.reorderIn(seq, id);
        expect(dairy()).toEqual(seq);
      }
    }
    // With no ties, it's one write: just the row that moved.
    const seq = dairy();
    const [first] = seq.splice(0, 1);
    seq.push(first);
    const others = seq.slice(0, -1).map((id) => guy.item(id)!.order);
    guy.reorderIn(seq, first);
    expect(seq.slice(0, -1).map((id) => guy.item(id)!.order)).toEqual(others);
  });

  it('remembers who turned urgent on', async () => {
    const { guy, hila } = await couple();
    const g = listNamed(guy, 'Groceries').id;
    const milk = guy.addShopping(g, 'milk').id;
    expect(guy.item(milk)?.urgentBy).toBeNull();
    sync(guy, hila);
    hila.updateItem(milk, { urgent: true });
    sync(guy, hila);
    expect(guy.item(milk)?.urgentBy).toBe('hila');
    expect(guy.item(guy.addShopping(g, 'bread', { urgent: true }).id)?.urgentBy).toBe('guy');
  });
});

describe('renameOldDefaults', () => {
  it('turns old chores projects into plain ones (renaming "Housework" to "Chores"), once, keeping each chore\'s repeat', async () => {
    const store = await Store.load(new MemoryPersistence(), 'dev-x', ['h', 'p:m1']);
    const hub = new Hub(store, 'm1');
    const old = (name: string) => {
      const id = hub.createList({ name, kind: 'tasks' });
      store.mutate('list', id, { kind: 'chores' as never });
      return id;
    };
    const a = old('Housework');
    const b = old('Garden');
    const c = hub.createList({ name: 'Housework', kind: 'tasks' });
    const water = hub.addItem(b, { title: 'Water the plants', repeat: { type: 'interval', every: 1, unit: 'week', from: 'done' } });
    hub.renameOldDefaults();
    hub.renameOldDefaults();
    expect(hub.list(a)).toMatchObject({ name: 'Chores', kind: 'tasks' });
    expect(hub.list(b)).toMatchObject({ name: 'Garden', kind: 'tasks' });
    expect(hub.list(c)?.name).toBe('Housework');
    expect(hub.item(water)?.repeat).toMatchObject({ every: 1, unit: 'week', from: 'done' });
  });
});

describe('one thing, two places', () => {
  it('"Buy a doorknob" under a chore lands on Home shopping, and ticking either ticks both', async () => {
    const { buyWords, toBuy } = await import('../../src/core/hub');
    expect(buyWords('Buy a new doorknob')).toBe(true);
    expect(toBuy('Buy a new doorknob')).toBe('new doorknob');
    expect(buyWords('Replace the doorknob')).toBe(false);
    const guy = await person('guy');
    guy.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    seedHousehold(guy, ['groceries', 'home', 'chores']);
    const chores = guy.lists().find((l) => l.name === 'Chores')!;
    const task = guy.addItem(chores.id, { title: 'Replace the doorknob' });
    const sub = guy.addItem(chores.id, { title: 'Buy a doorknob', parentId: task });
    const shop = guy.linkIfShopping(sub)!;
    expect(guy.list(guy.item(shop)!.listId)!.name).toBe('Home shopping');
    expect(guy.item(shop)!.title).toBe('doorknob');
    guy.toggle(shop);
    expect(guy.item(sub)!.done).toBe(true);
    guy.toggle(sub);
    expect(guy.item(shop)!.done).toBe(false);
    // Taking it off the shopping list leaves no copy behind.
    const undo = guy.removeTwin(sub);
    expect(guy.item(shop)).toBeUndefined();
    expect(guy.linked(guy.item(sub))).toBeUndefined();
    undo();
    expect(guy.linked(guy.item(sub))!.id).toBe(shop);
    // Deleting it takes it from both places.
    guy.delete(sub);
    expect(guy.item(shop)).toBeUndefined();
  });
});

describe('undo a tick of one thing in two places', () => {
  it('takes back what was written down for both, and an untick undone brings the memory back', async () => {
    const guy = await person('guy');
    guy.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    seedHousehold(guy, ['todo', 'chores']);
    const todo = guy.lists().find((l) => l.name === 'To do')!.id;
    const chores = guy.lists().find((l) => l.name === 'Chores')!.id;
    const a = guy.addItem(todo, { title: 'Paint the door' });
    const b = guy.alsoIn(a, chores)!;
    const live = () => guy.store.all('log').length;
    const before = live();
    const undoTick = guy.toggle(a);
    expect(guy.item(b)!.done).toBe(true);
    expect(live()).toBe(before + 2);
    undoTick();
    expect(guy.item(a)!.done).toBe(false);
    expect(guy.item(b)!.done).toBe(false);
    expect(live()).toBe(before);
    // Ticked, then unticked by mistake: undoing the untick brings back what was remembered.
    guy.toggle(a);
    const ticked = live();
    const undoUntick = guy.toggle(a);
    expect(live()).toBe(ticked - 2);
    undoUntick();
    expect(live()).toBe(ticked);
    expect(guy.item(a)!.logId && guy.store.get('log', guy.item(a)!.logId!)).toBeTruthy();
  });
});

describe('also inside a task', () => {
  it('a twin can live as a subtask of another task, never inside itself', async () => {
    const guy = await person('guy');
    guy.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    seedHousehold(guy, ['todo', 'chores']);
    const todo = guy.lists().find((l) => l.name === 'To do')!.id;
    const chores = guy.lists().find((l) => l.name === 'Chores')!.id;
    const fix = guy.addItem(chores, { title: 'Fix the shelf' });
    const buy = guy.addItem(todo, { title: 'Buy brackets' });
    const twin = guy.alsoIn(buy, chores, fix)!;
    expect(guy.item(twin)!.parentId).toBe(fix);
    expect(guy.alsoIn(fix, chores, fix)).toBeNull();
  });
});

describe('remove from here', () => {
  it('taking it out of this place keeps the other one', async () => {
    const guy = await person('guy');
    guy.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    seedHousehold(guy, ['todo', 'chores']);
    const todo = guy.lists().find((l) => l.name === 'To do')!.id;
    const chores = guy.lists().find((l) => l.name === 'Chores')!.id;
    const a = guy.addItem(todo, { title: 'Paint the door' });
    const b = guy.alsoIn(a, chores)!;
    guy.removeTwin(b);
    expect(guy.item(a)).toBeUndefined();
    expect(guy.item(b)).toBeDefined();
    expect(guy.linked(guy.item(b))).toBeUndefined();
  });
});

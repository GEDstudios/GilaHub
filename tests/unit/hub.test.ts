import { describe, expect, it, vi } from 'vitest';
import { Hub } from '../../src/core/hub';
import { seedHousehold } from '../../src/core/seed';
import { isForMe, folderView } from '../../src/app/views';
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
    const first = guy.addShopping(g.id, 'milk');
    expect(first.kind).toBe('added');
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

describe('Hub: a loop of folders', () => {
  it('two folders nested into each other at once come back into Folders', async () => {
    const { guy, hila } = await couple();
    const one = guy.createList({ name: 'Trip' });
    const two = guy.createList({ name: 'Packing' });
    sync(guy, hila);
    guy.setListParent(one, two);
    hila.setListParent(two, one);
    sync(guy, hila);
    expect(guy.topLists().some((l) => l.id === one || l.id === two)).toBe(false);
    expect(guy.nestedLists(one).map((l) => l.id)).toEqual([two]);
    expect(guy.mendFolders()).toBe(1);
    hila.mendFolders();
    sync(guy, hila);
    const head = one < two ? one : two;
    for (const hub of [guy, hila]) {
      expect(hub.topLists().map((l) => l.id)).toContain(head);
      expect(hub.list(head)?.parentId ?? null).toBeNull();
    }
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

  it('a backup carries everything, and what was private comes back private: preferences, notes, photos', async () => {
    const { guy, hila } = await couple();
    const todo = listNamed(guy, 'To do');
    const secret = guy.addItem(todo.id, { title: 'Ring', visibility: 'private' });
    const open = guy.addItem(todo.id, { title: 'Book dinner' });
    guy.addPhoto(`item:${secret}`, 'data:image/jpeg;base64,RING');
    guy.addPhoto(`item:${open}`, 'data:image/jpeg;base64,MENU');
    const note = guy.addNote('today', 'Back at six', 'lemon');
    // My preferences: one record, sealed with my key.
    guy.store.init('settings', 'prefs:guy', 'p:guy');
    guy.store.mutate('settings', 'prefs:guy', { todayScope: 'mine' } as never);
    sync(guy, hila);
    const backup = JSON.parse(JSON.stringify(guy.exportBackup()));
    expect(Object.keys(backup)).toEqual(expect.arrayContaining(['note', 'photo', 'settings', 'tag', 'moment']));

    const phone = await person('guy');
    phone.importBackup(backup);
    expect(phone.store.scopeOf('settings', 'prefs:guy')).toBe('p:guy');
    expect(phone.store.get('settings', 'prefs:guy')).toMatchObject({ todayScope: 'mine' });
    expect(phone.store.get('note', note!)?.text).toBe('Back at six');
    const [ring] = phone.photosOf(`item:${secret}`);
    const [menu] = phone.photosOf(`item:${open}`);
    expect(phone.store.scopeOf('photo', ring.id)).toBe('p:guy');
    expect(phone.store.scopeOf('photo', menu.id)).toBe('h');

    // What the restored phone sends on: my person gets the shared photo and the note, nothing private.
    const fresh = await person('hila');
    sync(phone, fresh);
    expect(fresh.store.get('settings', 'prefs:guy')).toBeUndefined();
    expect(fresh.photosOf(`item:${secret}`)).toHaveLength(0);
    expect(fresh.photosOf(`item:${open}`)).toHaveLength(1);
    expect(fresh.store.get('note', note!)?.text).toBe('Back at six');
  });

  it('someone else’s preferences in a backup are not mine to bring in', async () => {
    const phone = await person('guy');
    phone.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    phone.importBackup({ member: [{ id: 'guy', name: 'Guy' }], settings: [{ id: 'prefs:hila', todayScope: 'mine' }] });
    expect(phone.store.record('settings', 'prefs:hila')).toBeUndefined();
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
    const urgent = () => folderView(guy, root, true, 'tags', {}).urgent.map((i) => i.id);
    // Fruit & Veg, Dairy, Personal care, then the home departments.
    expect(urgent()).toEqual([apples, milk, cream, shampoo, batteries]);
    // Arranging Dairy is the one way to change where sour cream sits in the walk.
    guy.reorder(cream, null, milk);
    const dairy = folderView(guy, root, true, 'tags', {}).groups.find((x) => x.tag === 'g:dairy')!.items.map((i) => i.id);
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
    const dairy = () => folderView(guy, root, true, 'tags', {}).groups.find((x) => x.tag === 'g:dairy')!.items.map((i) => i.id);
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

describe('two tasks nested under each other at once', () => {
  /** Guy puts X under Y while Hila puts Y under X; then each hears of the other's move. */
  const crossed = async () => {
    const { guy, hila } = await couple();
    const todo = listNamed(guy, 'To do').id;
    const x = guy.addItem(todo, { title: 'Paint the fence' });
    const y = guy.addItem(todo, { title: 'Buy paint' });
    const z = guy.addItem(todo, { title: 'Garden' });
    sync(guy, hila);
    guy.move(x, { parentId: y });
    hila.move(y, { parentId: x });
    sync(guy, hila);
    return { guy, hila, todo, x, y, z };
  };
  const moved = (hub: Hub, id: string) => hub.store.record('item', id)!.c.parentId;
  const tree = (hub: Hub, ids: string[]) => ids.map((id) => [id, hub.item(id)!.parentId ?? null]);

  it('walking the loop ends, each task once', async () => {
    const { guy, hila, x, y } = await crossed();
    for (const hub of [guy, hila]) {
      expect(hub.item(x)!.parentId).toBe(y);
      expect(hub.item(y)!.parentId).toBe(x);
      expect(hub.descendants(x).map((d) => d.id)).toEqual([y]);
      expect(hub.descendants(y).map((d) => d.id)).toEqual([x]);
      expect(hub.ancestors(hub.item(x)!).map((a) => a.id)).toEqual([y]);
      expect(hub.childrenOf(x).map((c) => c.id)).toEqual([y]);
      expect(hub.isUnder(x, x)).toBe(false);
      // Ordinary things that walk the tree: ticking, privacy, deleting.
      hub.toggle(x);
      expect(hub.visibilityOf(hub.item(x)!)).toBe('ours');
    }
    guy.delete(x)();
    expect(guy.item(y)).toBeDefined();
  });

  it('the older move gives way: that task comes out to the top, the same on both devices', async () => {
    const { guy, hila, todo, x, y } = await crossed();
    const [out, kept] = moved(guy, x) < moved(guy, y) ? [x, y] : [y, x];
    expect(guy.mendTree()).toBe(1);
    expect(hila.mendTree()).toBe(1);
    // Before either has heard from the other, they already agree.
    for (const hub of [guy, hila]) {
      expect(hub.item(out)!.parentId).toBeNull();
      expect(hub.item(kept)!.parentId).toBe(out);
      // Both can be reached again: one in the folder, the other under it.
      expect(hub.children(todo, null).map((i) => i.id)).toContain(out);
      expect(hub.descendants(out).map((d) => d.id)).toEqual([kept]);
      expect(hub.isUnder(kept, out)).toBe(true);
      expect(hub.isUnder(out, kept)).toBe(false);
      expect(hub.ancestors(hub.item(kept)!).map((a) => a.id)).toEqual([out]);
    }
    sync(guy, hila);
    expect(tree(guy, [x, y])).toEqual(tree(hila, [x, y]));
    expect(guy.item(out)!.parentId).toBeNull();
    // Mended once: nothing more to write, nothing more to send.
    expect(guy.mendTree()).toBe(0);
    expect(hila.mendTree()).toBe(0);
    expect(guy.store.outboxSize() + hila.store.outboxSize()).toBe(0);
  });

  it('a move made since the mend stands, even when the other device mends late', async () => {
    const { guy, hila, x, y, z } = await crossed();
    const out = moved(guy, x) < moved(guy, y) ? x : y;
    guy.mendTree();
    guy.move(out, { parentId: z });
    // Hila's phone still shows the loop; a minute on, it mends before hearing what Guy did next.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 60_000 });
    try {
      hila.mendTree();
    } finally {
      vi.useRealTimers();
    }
    sync(guy, hila);
    expect(guy.item(out)!.parentId).toBe(z);
    expect(tree(hila, [x, y])).toEqual(tree(guy, [x, y]));
    expect(guy.mendTree() + hila.mendTree()).toBe(0);
  });

  it('the mend is not a step to undo', async () => {
    const { guy } = await crossed();
    const steps: string[] = [];
    guy.store.onWrite = (_t, id) => steps.push(id);
    guy.mendTree();
    expect(steps).toEqual([]);
  });

  it('steps of an Only-me task stay Only me when one comes out', async () => {
    const { guy, hila } = await couple();
    const tablet = await person('guy', { device: 'dev-guy-tablet' });
    sync(guy, tablet, hila);
    const todo = listNamed(guy, 'To do').id;
    const party = guy.addItem(todo, { title: 'Surprise party', visibility: 'private' });
    const x = guy.addItem(todo, { title: 'Invite friends', parentId: party });
    const y = guy.addItem(todo, { title: 'Order the cake', parentId: party });
    sync(guy, tablet, hila);
    guy.move(x, { parentId: y });
    tablet.move(y, { parentId: x });
    sync(guy, tablet, hila);
    const [out, kept] = moved(guy, x) < moved(guy, y) ? [x, y] : [y, x];
    guy.mendTree();
    tablet.mendTree();
    sync(guy, tablet, hila);
    for (const hub of [guy, tablet]) {
      expect(hub.item(out)!.parentId).toBeNull();
      expect(hub.item(kept)!.parentId).toBe(out);
      expect(hub.visibilityOf(hub.item(out)!)).toBe('private');
      expect(hub.visibilityOf(hub.item(kept)!)).toBe('private');
      expect(hub.ownerOf(hub.item(out)!)).toBe('guy');
      expect(hub.store.scopeOf('item', out)).toBe('p:guy');
    }
    expect(hila.item(x)).toBeUndefined();
    expect(hila.item(y)).toBeUndefined();
    // Moving it later reseals it by what it says: still Only me.
    guy.move(out, { before: party });
    sync(guy, tablet, hila);
    expect(hila.item(out)).toBeUndefined();
    expect(hila.item(kept)).toBeUndefined();
  });

  it('a task under itself, and a longer loop, come apart too', async () => {
    const { guy, hila } = await couple();
    const todo = listNamed(guy, 'To do').id;
    const [a, b, c, d] = ['Sand', 'Prime', 'Paint', 'Varnish'].map((title) => guy.addItem(todo, { title }));
    guy.store.mutate('item', a, { parentId: a });
    guy.store.mutate('item', b, { parentId: c });
    guy.store.mutate('item', c, { parentId: d });
    guy.store.mutate('item', d, { parentId: b });
    sync(guy, hila);
    expect(guy.descendants(a)).toEqual([]);
    expect(guy.descendants(b).map((i) => i.id).sort()).toEqual([c, d].sort());
    expect(hila.mendTree()).toBe(2);
    expect(guy.mendTree()).toBe(2);
    sync(guy, hila);
    for (const hub of [guy, hila]) {
      expect(tree(hub, [a, b, c, d])).toEqual([
        [a, null],
        [b, null],
        [c, d],
        [d, b],
      ]);
      expect(hub.descendants(b).map((i) => i.id)).toEqual([d, c]);
      expect(hub.mendTree()).toBe(0);
    }
  });
});

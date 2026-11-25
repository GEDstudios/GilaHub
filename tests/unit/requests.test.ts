import { describe, expect, it } from 'vitest';
import { Hub, seedHousehold } from '../../src/core/actions';
import { addDays, today } from '../../src/core/dates';
import { MemoryPersistence } from '../../src/core/db';
import { Store } from '../../src/core/store';
import {
  allowedVis,
  doerOf,
  itemVisChoice,
  listDefaultVis,
  reqLabel,
  requestState,
  visHint,
  visLabel,
  visTagFor,
} from '../../src/app/privacy';
import { isForMe, todayView } from '../../src/app/views';

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

async function solo() {
  const guy = await person('guy');
  guy.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
  seedHousehold(guy, ['groceries', 'chores', 'todo']);
  guy.createList({ name: "Guy's things", kind: 'tasks', color: 'sky', visibility: 'visible' });
  return guy;
}

async function couple() {
  const guy = await solo();
  const hila = await person('hila');
  sync(guy, hila);
  hila.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
  hila.createList({ name: "Hila's things", kind: 'tasks', color: 'pink', visibility: 'visible' });
  hila.createList({ name: 'Notes', kind: 'tasks', color: 'lilac', visibility: 'private' });
  sync(guy, hila);
  return { guy, hila };
}

const listNamed = (hub: Hub, name: string) => hub.lists().find((l) => l.name === name)!;
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);

describe('Today: requests between us', () => {
  it('an undated request from Hila lands in Guy’s "asked", tagged "Hila asked"', async () => {
    const { guy, hila } = await couple();
    const id = hila.addItem(listNamed(hila, 'To do').id, { title: 'Call the landlord', assignee: 'guy' });
    sync(guy, hila);
    const v = todayView(guy, today());
    expect(ids(v.asked)).toEqual([id]);
    expect(ids(v.today)).not.toContain(id);
    const s = requestState(guy, guy.item(id)!)!;
    expect(s.kind).toBe('they-asked');
    expect(reqLabel(s)).toBe('Hila asked');
    // Hila sees it as her open ask.
    const hv = todayView(hila, today());
    expect(ids(hv.outgoing)).toEqual([id]);
    expect(reqLabel(requestState(hila, hila.item(id)!)!)).toBe('Asked Guy');
    expect(hv.asked).toHaveLength(0);
  });

  it('a request dated today stays in Today (with its tag); a later one is asked, not upcoming', async () => {
    const { guy, hila } = await couple();
    const todo = listNamed(hila, 'To do').id;
    const now = hila.addItem(todo, { title: 'Pay the bill', assignee: 'guy', due: today() });
    const later = hila.addItem(todo, { title: 'Book the plumber', assignee: 'guy', due: addDays(today(), 2) });
    sync(guy, hila);
    const v = todayView(guy, today());
    expect(ids(v.today)).toContain(now);
    expect(ids(v.asked)).toEqual([later]);
    expect(v.upcoming.flatMap((g) => ids(g.items))).not.toContain(later);
    expect(requestState(guy, guy.item(now)!)?.kind).toBe('they-asked');
  });

  it('repeating asks and chores are not asks', async () => {
    const { guy, hila } = await couple();
    const rep = hila.addItem(listNamed(hila, 'To do').id, { title: 'Water plants', assignee: 'guy', repeat: { type: 'interval', every: 1, unit: 'week', from: 'schedule' } });
    const chore = hila.addItem(listNamed(hila, 'Housework').id, { title: 'Bins', assignee: 'guy' });
    sync(guy, hila);
    const v = todayView(guy, today());
    expect(ids(v.asked)).not.toContain(rep);
    expect(ids(v.asked)).not.toContain(chore);
    expect(requestState(guy, guy.item(rep)!)).toBeNull();
    expect(ids(todayView(hila, today()).outgoing)).not.toContain(chore);
  });

  it('something Hila made Guy’s is an ask too', async () => {
    const { guy, hila } = await couple();
    const id = hila.addItem(listNamed(hila, 'To do').id, { title: 'Renew your passport', visibility: 'mine', owner: 'guy' });
    sync(guy, hila);
    expect(ids(todayView(guy, today()).asked)).toEqual([id]);
    expect(itemVisChoice(guy, guy.item(id)!)).toBe('mine');
    expect(itemVisChoice(hila, hila.item(id)!)).toBe('theirs');
  });

  it('a request inside Hila’s own project still reaches Guy', async () => {
    const { guy, hila } = await couple();
    const id = hila.addItem(listNamed(hila, "Hila's things").id, { title: 'Pick up my parcel', assignee: 'guy' });
    sync(guy, hila);
    expect(isForMe(guy, guy.item(id)!)).toBe(true);
    expect(ids(todayView(guy, today()).asked)).toEqual([id]);
  });

  it('waiting for their OK: I did Hila’s ask, she OKs it', async () => {
    const { guy, hila } = await couple();
    const id = hila.addItem(listNamed(hila, 'To do').id, { title: 'Fix the shelf', assignee: 'guy', needsOk: true });
    sync(guy, hila);
    guy.toggle(id);
    sync(guy, hila);
    const v = todayView(guy, today());
    expect(ids(v.waitingTheirOk)).toEqual([id]);
    expect(v.asked).toHaveLength(0);
    expect(reqLabel(requestState(guy, guy.item(id)!)!)).toBe('Waiting for Hila’s OK');
    const hv = todayView(hila, today());
    expect(ids(hv.awaitingOk)).toEqual([id]);
    expect(hv.outgoing).toHaveLength(0);
    expect(reqLabel(requestState(hila, hila.item(id)!)!)).toBe('Guy did it · OK?');
    hila.confirm(id);
    sync(guy, hila);
    expect(todayView(guy, today()).waitingTheirOk).toHaveLength(0);
    expect(requestState(guy, guy.item(id)!)).toBeNull();
  });

  it('"Not yet" shows the doer "Hila said not yet" until they tick again; their own un-tick does not', async () => {
    const { guy, hila } = await couple();
    const id = hila.addItem(listNamed(hila, 'To do').id, { title: 'Fix the shelf', assignee: 'guy', needsOk: true });
    sync(guy, hila);
    guy.toggle(id);
    sync(guy, hila);
    const undo = hila.sendBack(id);
    sync(guy, hila);
    expect(reqLabel(requestState(guy, guy.item(id)!)!)).toBe('Hila said not yet');
    expect(ids(todayView(guy, today()).asked)).toEqual([id]);
    undo();
    sync(guy, hila);
    expect(requestState(guy, guy.item(id)!)?.kind).toBe('waiting-ok');
    hila.sendBack(id);
    sync(guy, hila);
    // Ticking again clears it, and so does Hila's OK.
    guy.toggle(id);
    sync(guy, hila);
    expect(requestState(guy, guy.item(id)!)?.kind).toBe('waiting-ok');
    // Guy taking his tick back is not a "not yet".
    guy.toggle(id);
    sync(guy, hila);
    expect(requestState(guy, guy.item(id)!)?.kind).toBe('they-asked');
    guy.toggle(id);
    hila.sendBack(id);
    sync(guy, hila);
    guy.toggle(id);
    sync(guy, hila);
    hila.confirm(id);
    sync(guy, hila);
    expect(guy.item(id)?.sentBackAt).toBeNull();
  });

  it('asks a needs-OK request with its label, and nothing request-related while solo', async () => {
    const { guy, hila } = await couple();
    const id = guy.addItem(listNamed(guy, 'To do').id, { title: 'Clean the car', assignee: 'hila', needsOk: true });
    sync(guy, hila);
    expect(reqLabel(requestState(guy, guy.item(id)!)!)).toBe('Asked Hila · needs OK');
    const alone = await solo();
    const v = todayView(alone, today());
    expect([v.asked, v.outgoing, v.waitingTheirOk].flat()).toHaveLength(0);
  });

  it('upcoming skips chores', async () => {
    const guy = await solo();
    const chore = guy.addItem(listNamed(guy, 'Housework').id, { title: 'Bins', due: addDays(today(), 1) });
    const task = guy.addItem(listNamed(guy, 'To do').id, { title: 'Dentist', due: addDays(today(), 1) });
    const up = todayView(guy, today()).upcoming.flatMap((g) => ids(g.items));
    expect(up).toContain(task);
    expect(up).not.toContain(chore);
  });

  it('counts what I finished today', async () => {
    const guy = await solo();
    const a = guy.addItem(listNamed(guy, 'To do').id, { title: 'A' });
    const r = guy.addItem(listNamed(guy, 'To do').id, { title: 'R', repeat: { type: 'interval', every: 1, unit: 'day', from: 'done' } });
    guy.addShopping(listNamed(guy, 'Groceries').id, 'milk');
    expect(todayView(guy, today()).doneToday).toBe(0);
    guy.toggle(a);
    guy.completeRepeating(r);
    const milk = guy.findOnList([listNamed(guy, 'Groceries').id], 'milk')!;
    guy.toggle(milk.id);
    expect(todayView(guy, today()).doneToday).toBe(2);
  });
});

describe('privacy helpers', () => {
  it('defaults and allowed choices follow the project', async () => {
    const { guy } = await couple();
    const todo = listNamed(guy, 'To do');
    const mine = listNamed(guy, "Guy's things");
    const hers = listNamed(guy, "Hila's things");
    expect(listDefaultVis(guy, todo)).toBe('ours');
    expect(listDefaultVis(guy, mine)).toBe('mine');
    expect(listDefaultVis(guy, hers)).toBe('theirs');
    expect(allowedVis(guy, todo)).toEqual(['ours', 'mine', 'theirs', 'private']);
    expect(allowedVis(guy, mine)).toEqual(['mine', 'ours', 'theirs', 'private']);
    expect(allowedVis(guy, hers)).toEqual(['theirs', 'ours', 'mine']);
    const secret = guy.addItem(todo.id, { title: 'Gift', visibility: 'private' });
    expect(allowedVis(guy, todo, guy.item(secret))).toEqual(['private']);
    const alone = await solo();
    expect(allowedVis(alone, listNamed(alone, 'To do'))).toEqual(['ours', 'mine', 'private']);
  });

  it('a row tag shows only when the item differs from its project (or parent)', async () => {
    const { guy } = await couple();
    const todo = listNamed(guy, 'To do');
    const mineList = listNamed(guy, "Guy's things");
    const plain = guy.addItem(todo.id, { title: 'Plain' });
    const mine = guy.addItem(todo.id, { title: 'Mine', visibility: 'mine' });
    const hers = guy.addItem(todo.id, { title: 'Hers', visibility: 'mine', owner: 'hila' });
    const secret = guy.addItem(todo.id, { title: 'Secret', visibility: 'private' });
    const step = guy.addItem(todo.id, { title: 'Step', parentId: secret });
    const inMine = guy.addItem(mineList.id, { title: 'Mine by default' });
    const oursInMine = guy.addItem(mineList.id, { title: 'For both', visibility: 'ours' });
    const tag = (id: string) => visTagFor(guy, guy.item(id)!);
    expect(tag(plain)).toBeNull();
    expect(tag(mine)).toBe('mine');
    expect(tag(hers)).toBe('theirs');
    expect(tag(secret)).toBe('private');
    expect(tag(step)).toBeNull();
    expect(tag(inMine)).toBeNull();
    expect(tag(oursInMine)).toBe('ours');
  });

  it('labels and hints, paired and solo', () => {
    expect(['ours', 'mine', 'theirs', 'private'].map((v) => visLabel(v as never, 'Hila'))).toEqual(['Ours', 'Mine', 'Hila’s', 'Only me']);
    expect(visHint('mine', 'Hila')).toBe('Yours. Hila can see it and help.');
    expect(visHint('private', 'Hila')).toBe('Hidden from Hila. Encrypted.');
    expect(visHint('theirs', 'Hila')).toContain('Who → Ask Hila');
    expect(visHint('ours', null)).toBe('Shared with your person once they join.');
    expect(visHint('private', null)).toBe('Never shared, even after your person joins.');
  });

  it('the row avatar is the doer, never an ask or the owner', async () => {
    const { guy } = await couple();
    const todo = listNamed(guy, 'To do').id;
    const asked = guy.addItem(todo, { title: 'Asked', assignee: 'hila' });
    const mineToDo = guy.addItem(todo, { title: 'Me', assignee: 'guy' });
    const hers = guy.addItem(todo, { title: 'Hers', visibility: 'mine', owner: 'hila' });
    const turns = guy.addItem(todo, { title: 'Turns', assignee: 'turns', repeat: { type: 'interval', every: 1, unit: 'week', from: 'done' } });
    expect(doerOf(guy, guy.item(asked)!)).toBeUndefined();
    expect(doerOf(guy, guy.item(mineToDo)!)?.id).toBe('guy');
    expect(doerOf(guy, guy.item(hers)!)).toBeUndefined();
    expect(doerOf(guy, guy.item(turns)!)?.id).toBe('guy');
  });
});

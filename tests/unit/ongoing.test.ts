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

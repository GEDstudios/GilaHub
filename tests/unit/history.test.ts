import { describe, expect, it } from 'vitest';
import { Hub } from '../../src/core/hub';
import { MemoryPersistence } from '../../src/core/db';
import { History } from '../../src/core/history';
import { Store } from '../../src/core/store';

async function setup(member = 'guy') {
  const store = await Store.load(new MemoryPersistence(), `dev-${member}`, ['h', `p:${member}`]);
  const hub = new Hub(store, member);
  // Steps closed by hand, so each test says where one ends.
  let close: (() => void) | null = null;
  const history = new History(store, { record: (t) => t !== 'settings', group: (c) => (close = c) });
  const step = () => close?.();
  return { hub, history, step };
}

describe('Undo and redo', () => {
  it('takes back a new task, and brings it back', async () => {
    const { hub, history, step } = await setup();
    const l = hub.createList({ name: 'Home' });
    step();
    const id = hub.addItem(l, { title: 'Fix the shelf' });
    step();
    expect(history.undo()).toBe(true);
    expect(hub.item(id)).toBeUndefined();
    expect(hub.list(l)).toBeDefined();
    expect(history.redo()).toBe(true);
    expect(hub.item(id)?.title).toBe('Fix the shelf');
  });

  it('puts edits back field by field, a whole step at a time', async () => {
    const { hub, history, step } = await setup();
    const l = hub.createList({ name: 'Home' });
    const id = hub.addItem(l, { title: 'Call mum' });
    step();
    hub.updateItem(id, { title: 'Call mum back', urgent: true });
    step();
    hub.toggle(id);
    step();
    history.undo();
    expect(hub.item(id)?.done).toBe(false);
    history.undo();
    expect(hub.item(id)).toMatchObject({ title: 'Call mum', urgent: false });
    history.redo();
    expect(hub.item(id)).toMatchObject({ title: 'Call mum back', urgent: true });
    // Something new after an undo: the redo is gone.
    hub.updateItem(id, { notes: 'after 6' });
    step();
    expect(history.canRedo()).toBe(false);
  });

  it('brings back a deleted folder', async () => {
    const { hub, history, step } = await setup();
    const l = hub.createList({ name: 'Trip' });
    step();
    hub.deleteList(l);
    step();
    expect(hub.list(l)).toBeUndefined();
    history.undo();
    expect(hub.list(l)?.name).toBe('Trip');
  });

  it('undoes a move into Private, scope and all', async () => {
    const { hub, history, step } = await setup();
    const l = hub.createList({ name: 'Home' });
    const id = hub.addItem(l, { title: 'Gift' });
    step();
    expect(hub.store.scopeOf('item', id)).toBe('h');
    hub.setItemVisibility(id, 'private', 'guy');
    step();
    expect(hub.store.scopeOf('item', id)).toBe('p:guy');
    history.undo();
    expect(hub.store.scopeOf('item', id)).toBe('h');
    expect(hub.item(id)?.private ?? false).toBe(false);
  });

  it("never takes back my person's changes, nor its own undo", async () => {
    const { hub, history, step } = await setup();
    const l = hub.createList({ name: 'Home' });
    step();
    // A remote write doesn't come through mutate.
    hub.store.applyRemote({ t: 'item', id: 'remote1', f: { listId: l, title: 'From Hila', order: 'a', createdAt: 1, createdBy: 'hila' }, h: '9999999999999:0000:zz' } as never);
    history.undo();
    expect(hub.list(l)).toBeUndefined();
    expect(hub.item('remote1')?.title).toBe('From Hila');
    expect(history.canUndo()).toBe(false);
  });
});

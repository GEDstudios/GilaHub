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

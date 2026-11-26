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
    // Hiding is never done to someone else's.
    hub.setListVisibility(id, 'private');
    expect(hub.list(id)).toMatchObject({ visibility: 'visible', owner: 'hila' });
    hub.setListVisibility(id, 'visible', 'guy');
    expect(hub.list(id)?.owner).toBe('guy');
    hub.setListVisibility(id, 'visible', 'hila');
    hub.setListVisibility(id, 'shared');
    expect(hub.list(id)).toMatchObject({ visibility: 'shared', owner: null });
  });
});

describe('the backlog', () => {
  it('keeps someday things out of Today and the counts, all in one place, till they come back', async () => {
    const { backlogOf, openCount, todayView } = await import('../../src/app/views');
    const { today } = await import('../../src/core/dates');
    const hub = await person('guy');
    hub.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    const l = hub.createList({ name: 'House', kind: 'tasks' });
    const a = hub.addItem(l, { title: 'Paint the fence', due: today() });
    hub.addItem(l, { title: 'Fix the tap' });
    expect(openCount(hub, l)).toBe(2);
    const undo = hub.setSomeday(a, true);
    expect(openCount(hub, l)).toBe(1);
    expect(backlogOf(hub).map((i) => i.title)).toEqual(['Paint the fence']);
    expect(backlogOf(hub, l)).toHaveLength(1);
    expect(todayView(hub, today()).today.map((i) => i.title)).not.toContain('Paint the fence');
    undo();
    expect(backlogOf(hub)).toEqual([]);
    expect(openCount(hub, l)).toBe(2);
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

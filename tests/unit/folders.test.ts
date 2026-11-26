import { describe, expect, it } from 'vitest';
import { person, sync } from './_helpers';

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

describe('A filtered list on Today', () => {
  it('shows as a block while it exists, and goes when it is deleted', async () => {
    const { setPrefs, getPrefs } = await import('../../src/app/prefs');
    const { showHome, visibleHome, queryKey } = await import('../../src/app/home');
    const guy = await person('guy');
    guy.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    setPrefs({ savedLists: { a1: { name: 'Work, next week', query: { due: 'nextweek' } } } });
    expect(showHome(guy, queryKey('a1'))).toBe(true);
    expect(visibleHome(guy).map((s) => s.key)).toContain('q:a1');
    setPrefs({ savedLists: {} });
    expect(visibleHome(guy).map((s) => s.key)).not.toContain('q:a1');
    expect(showHome(guy, queryKey('nope'))).toBe(false);
    void getPrefs;
  });
});

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

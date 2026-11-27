import { describe, expect, it } from 'vitest';
import type { Hub } from '../../src/core/hub';
import { person, sync } from './_helpers';

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

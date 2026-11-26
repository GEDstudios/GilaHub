import { describe, expect, it } from 'vitest';
import { Hub, seedHousehold } from '../../src/core/actions';
import { shoppingView } from '../../src/app/views';
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

/** A household from before: two shopping lists of their own kind, aisles renamed, one taken away, one of ours. */
async function oldHousehold() {
  const guy = await person('guy');
  guy.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
  const todo = guy.createList({ name: 'To do' });
  const g = guy.createList({ name: 'Groceries' });
  const h = guy.createList({ name: 'Home shopping' });
  const milk = guy.addItem(g, { title: 'milk' });
  const chips = guy.addItem(g, { title: 'balloons' });
  guy.store.mutate('item', chips, { category: 'c:party' });
  const bulbs = guy.addItem(h, { title: 'light bulbs' });
  const thing = guy.addItem(g, { title: 'zzzz' });
  guy.store.mutate('list', g, { kind: 'shopping', flavor: 'grocery' });
  guy.store.mutate('list', h, { kind: 'shopping', flavor: 'home' });
  guy.store.mutate('settings', 'house', {
    groceryAisles: [{ id: 'dairy', name: 'Milk & cheese' }, { id: 'produce' }, { id: 'c:party', name: 'Party', icon: '🎉' }, { id: 'snacks', hidden: true }],
  });

  // Written by the app before tags: none at all.
  for (const id of [milk, chips, bulbs, thing]) guy.store.mutate('item', id, { tags: null });
  return { guy, todo, g, h, milk, chips, bulbs, thing };
}

describe('Shopping lists become projects inside Shopping, and aisles become tags', () => {
  it('moves the lists into one Shopping project and keeps our aisles as tags', async () => {
    const { guy, g, h, milk, chips, bulbs, thing } = await oldHousehold();
    guy.uniformProjects();
    const root = guy.shopRoot()!;
    expect(root.name).toBe('Shopping');
    expect(guy.list(g)!.parentId).toBe(root.id);
    expect(guy.list(h)!.parentId).toBe(root.id);
    expect(guy.lists().every((l) => l.kind === 'tasks')).toBe(true);
    expect(guy.isShop(g) && guy.isShop(h) && guy.isShop(root)).toBe(true);
    // Our names and our own aisle; the walk as we had it; the one we took away stays away.
    const names = guy.tags().map((t) => t.name);
    expect(names.slice(0, 3)).toEqual(['Milk & cheese', 'Fruit & Veg', 'Party']);
    expect(guy.tag('g:snacks')).toBeUndefined();
    expect(guy.tag('h:electrical')).toBeDefined();
    expect(guy.item(milk)!.tags).toEqual(['g:dairy']);
    expect(guy.item(chips)!.tags).toEqual(['c:party']);
    expect(guy.item(bulbs)!.tags).toEqual(['h:electrical']);
    expect(guy.item(thing)!.tags).toEqual([]);
    // Once only.
    const n = guy.store.all('tag').length;
    guy.uniformProjects();
    expect(guy.store.all('tag').length).toBe(n);
  });

  it('two phones moving at once end up with one Shopping and one set of tags', async () => {
    const { guy } = await oldHousehold();
    const hila = await person('hila');
    sync(guy, hila);
    guy.uniformProjects();
    hila.uniformProjects();
    sync(guy, hila);
    expect(guy.lists().filter((l) => l.shopRoot)).toHaveLength(1);
    expect(hila.lists().filter((l) => l.shopRoot)).toHaveLength(1);
    expect(hila.tags().map((t) => t.id)).toEqual(guy.tags().map((t) => t.id));
  });
});

describe('Tags', () => {
  it('a thing to buy wears its aisle by itself; a task is only offered it', async () => {
    const guy = await person('guy');
    seedHousehold(guy, ['groceries', 'todo']);
    const groceries = guy.lists().find((l) => l.name === 'Groceries')!;
    expect(guy.list(groceries.parentId)?.shopRoot).toBe(true);
    const todo = guy.lists().find((l) => l.name === 'To do')!;
    const milk = guy.addItem(groceries.id, { title: 'milk' });
    expect(guy.tagsOf(guy.item(milk)!)).toEqual(['g:dairy']);
    const task = guy.addItem(todo.id, { title: 'milk' });
    expect(guy.tagsOf(guy.item(task)!)).toEqual([]);
    expect(guy.suggestTags('milk', todo.id).more).toContain('g:dairy');
  });

  it('remembers what we tag, for the same words next time, anywhere', async () => {
    const guy = await person('guy');
    seedHousehold(guy, ['todo']);
    const todo = guy.lists()[0];
    const work = guy.createTag('Work', 'i:briefcase')!;
    const a = guy.addItem(todo.id, { title: 'Send the invoice' });
    guy.setTags(a, [work]);
    const b = guy.addItem(todo.id, { title: 'send the invoice' });
    expect(guy.tagsOf(guy.item(b)!)).toEqual([work]);
    // Named in the words: offered.
    expect(guy.suggestTags('work drinks', todo.id).more).toContain(work);
  });

  it('a tag taken away comes off everything, and Undo puts it back', async () => {
    const guy = await person('guy');
    seedHousehold(guy, ['todo']);
    const todo = guy.lists()[0];
    const t = guy.createTag('Car')!;
    const a = guy.addItem(todo.id, { title: 'Oil', tags: [t] });
    const undo = guy.deleteTag(t);
    expect(guy.tag(t)).toBeUndefined();
    expect(guy.tagsOf(guy.item(a)!)).toEqual([]);
    undo();
    expect(guy.tagsOf(guy.item(a)!)).toEqual([t]);
  });

  it('Shopping groups by the first tag in our order, the untagged last; moving a thing changes its aisle', async () => {
    const guy = await person('guy');
    seedHousehold(guy, ['groceries']);
    const root = guy.shopRoot()!;
    const groceries = guy.lists().find((l) => l.name === 'Groceries')!;
    const milk = guy.addItem(groceries.id, { title: 'milk' });
    guy.addItem(groceries.id, { title: 'tomatoes' });
    guy.addItem(root.id, { title: 'zzzz' });
    const v = shoppingView(guy, root.id, 'all', {});
    expect(v.groups.map((g) => g.label)).toEqual(['Fruit & Veg', 'Dairy & Eggs', 'Other']);
    guy.moveToTag(milk, 'g:dairy', 'g:produce');
    expect(shoppingView(guy, root.id, 'all', {}).groups.map((g) => g.label)).toEqual(['Fruit & Veg', 'Other']);
    // Learned: milk goes to Produce next time.
    guy.toggle(milk);
    guy.finishTrip([groceries.id]);
    const again = guy.addItem(groceries.id, { title: 'milk' });
    expect(guy.tagsOf(guy.item(again)!)).toEqual(['g:produce']);
    // Arranging the tags is arranging the walk.
    guy.arrangeTags(['g:dairy', ...guy.tags().map((t) => t.id).filter((id) => id !== 'g:dairy')]);
    guy.setTags(again, ['g:dairy']);
    expect(shoppingView(guy, root.id, 'all', {}).groups[0].label).toBe('Dairy & Eggs');
  });
});

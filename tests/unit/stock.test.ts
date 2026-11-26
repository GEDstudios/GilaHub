import { describe, expect, it } from 'vitest';
import { person } from './_helpers';

describe('Kept stocked', () => {
  it('goes on Shopping when low, turns urgent when very low, and is stocked up when bought', async () => {
    const guy = await person('guy');
    const shop = guy.createList({ name: 'Shopping' });
    guy.store.mutate('list', shop, { shopRoot: true });
    const pantry = guy.createList({ name: 'Pantry' });
    const oil = guy.addItem(pantry, { title: 'Olive oil' });
    guy.setStock(oil, { stock: 3, stockAddAt: 1, stockUrgentAt: 0 });
    const onList = () => guy.children(shop, null).filter((i) => !i.done && i.title === 'Olive oil');
    expect(onList()).toHaveLength(0);
    guy.setStock(oil, { stock: Math.max(0, (guy.item(oil)!.stock ?? 0) - 1) });
    expect(onList()).toHaveLength(0);
    const undo = guy.setStock(oil, { stock: Math.max(0, (guy.item(oil)!.stock ?? 0) - 1) });
    expect(guy.item(oil)?.stock).toBe(1);
    expect(onList()).toHaveLength(1);
    expect(onList()[0].urgent ?? false).toBe(false);
    // Undo takes it back off.
    undo();
    expect(guy.item(oil)?.stock).toBe(2);
    expect(onList()).toHaveLength(0);
    guy.setStock(oil, { stock: Math.max(0, (guy.item(oil)!.stock ?? 0) - 1) });
    guy.setStock(oil, { stock: Math.max(0, (guy.item(oil)!.stock ?? 0) - 1) });
    expect(guy.item(oil)?.stock).toBe(0);
    expect(onList()).toHaveLength(1);
    expect(onList()[0].urgent).toBe(true);
    // Bought two: stocked up by two, and off the list.
    const entry = onList()[0].id;
    guy.updateItem(entry, { qty: '2' });
    guy.toggle(entry);
    expect(guy.item(oil)).toMatchObject({ stock: 2, stockLink: null });
  });

  it('stocked again by hand: its entry leaves the list; one that was already there stays', async () => {
    const guy = await person('guy');
    const shop = guy.createList({ name: 'Shopping' });
    guy.store.mutate('list', shop, { shopRoot: true });
    const pantry = guy.createList({ name: 'Pantry' });
    const rice = guy.addItem(pantry, { title: 'Rice' });
    guy.setStock(rice, { stock: 1 });
    expect(guy.children(shop, null).filter((i) => i.title === 'Rice')).toHaveLength(1);
    guy.setStock(rice, { stock: 5 });
    expect(guy.children(shop, null).filter((i) => i.title === 'Rice')).toHaveLength(0);
    // Already on the list before it ran low: left alone.
    guy.addItem(shop, { title: 'Pasta' });
    const pasta = guy.addItem(pantry, { title: 'Pasta' });
    guy.setStock(pasta, { stock: 0 });
    guy.setStock(pasta, { stock: 4 });
    expect(guy.children(shop, null).filter((i) => i.title === 'Pasta')).toHaveLength(1);
  });
});

describe('Stock going under a task', () => {
  it('puts its entry under the task picked in the tree', async () => {
    const guy = await person('guy');
    const party = guy.createList({ name: 'Party' });
    const shopFor = guy.addItem(party, { title: 'Shop for the party' });
    const pantry = guy.createList({ name: 'Pantry' });
    const cups = guy.addItem(pantry, { title: 'Paper cups' });
    guy.setStock(cups, { stock: 5, stockTo: party, stockUnder: shopFor });
    guy.setStock(cups, { stock: 1 });
    expect(guy.childrenOf(shopFor).map((c) => c.title)).toEqual(['Paper cups']);
    expect(guy.stockPlace(guy.item(cups)!)).toEqual({ listId: party, parentId: shopFor });
  });
});

describe('Counted things stay', () => {
  it('a counted thing is never ticked done (so never cleared away)', async () => {
    const guy = await person('guy');
    const l = guy.createList({ name: 'Pantry' });
    const id = guy.addItem(l, { title: 'Rice' });
    guy.setStock(id, { stock: 4 });
    guy.toggle(id);
    expect(guy.item(id)?.done).toBe(false);
    guy.clearDone([l]);
    expect(guy.item(id)?.archived ?? false).toBe(false);
    expect(guy.stockItems().map((i) => i.title)).toEqual(['Rice']);
  });
});

describe('Stock with how many we like to have', () => {
  it('asks the list for what is missing, and buying it fills back up', async () => {
    const guy = await person('guy');
    const shop = guy.createList({ name: 'Shopping' });
    guy.store.mutate('list', shop, { shopRoot: true });
    const pantry = guy.createList({ name: 'Pantry' });
    const eggs = guy.addItem(pantry, { title: 'Eggs' });
    guy.setStock(eggs, { stock: 6, stockFull: 6, stockAddAt: 2 });
    guy.setStock(eggs, { stock: 2 });
    const entry = () => guy.children(shop, null).find((i) => i.title === 'Eggs' && !i.done);
    expect(entry()?.qty).toBe('4');
    guy.setStock(eggs, { stock: Math.max(0, (guy.item(eggs)!.stock ?? 0) - 1) });
    expect(entry()?.qty).toBe('5');
    guy.toggle(entry()!.id);
    expect(guy.item(eggs)?.stock).toBe(6);
  });
});

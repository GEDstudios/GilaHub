import { describe, expect, it } from 'vitest';
import { isStocked, isTodo } from '../../src/core/model';
import { openCount, projectView } from '../../src/app/views';
import { person } from './_helpers';

const page = (hub: Awaited<ReturnType<typeof person>>, listId: string) => projectView(hub, listId, false, 'list', {});

describe('Kept stocked: one item, in its own folder', () => {
  it('waits in "In stock" while there are enough, and is one of the tasks at its buy-at count', async () => {
    const guy = await person('guy');
    const pantry = guy.createList({ name: 'Pantry' });
    const oil = guy.addItem(pantry, { title: 'Olive oil' });
    guy.setStock(oil, { stock: 3, stockAddAt: 1, stockUrgentAt: 0 });
    expect(isStocked(guy.item(oil)!)).toBe(true);
    expect(page(guy, pantry).stocked.map((i) => i.id)).toEqual([oil]);
    expect(page(guy, pantry).open).toHaveLength(0);
    expect(openCount(guy, pantry)).toBe(0);

    guy.setStock(oil, { stock: 2 });
    expect(page(guy, pantry).open).toHaveLength(0);
    const undo = guy.setStock(oil, { stock: 1 });
    expect(isTodo(guy.item(oil)!)).toBe(true);
    expect(page(guy, pantry).open.map((i) => i.id)).toEqual([oil]);
    expect(page(guy, pantry).stocked).toHaveLength(0);
    expect(openCount(guy, pantry)).toBe(1);
    // No second item anywhere: the thing itself is the task.
    expect(guy.store.all('item').filter((i) => i.title === 'Olive oil')).toHaveLength(1);

    undo();
    expect(guy.item(oil)?.stock).toBe(2);
    expect(page(guy, pantry).stocked).toHaveLength(1);
  });

  it('turns urgent at its urgent count, and back off when stocked up again; urgent by hand stays', async () => {
    const guy = await person('guy');
    const pantry = guy.createList({ name: 'Pantry' });
    const oil = guy.addItem(pantry, { title: 'Olive oil' });
    guy.setStock(oil, { stock: 2, stockAddAt: 1, stockUrgentAt: 0 });
    guy.setStock(oil, { stock: 1 });
    expect(guy.item(oil)?.urgent ?? false).toBe(false);
    const undo = guy.setStock(oil, { stock: 0 });
    expect(guy.item(oil)?.urgent).toBe(true);
    undo();
    expect(guy.item(oil)?.urgent ?? false).toBe(false);
    guy.setStock(oil, { stock: 0 });
    guy.setStock(oil, { stock: 4 });
    expect(guy.item(oil)?.urgent).toBe(false);

    // Made urgent by hand, while there are some: a count that doesn't cross the line leaves it.
    guy.updateItem(oil, { urgent: true });
    guy.setStock(oil, { stock: 3 });
    expect(guy.item(oil)?.urgent).toBe(true);
  });

  it('is never ticked done (it is counted, so never cleared away)', async () => {
    const guy = await person('guy');
    const pantry = guy.createList({ name: 'Pantry' });
    const oil = guy.addItem(pantry, { title: 'Olive oil' });
    guy.setStock(oil, { stock: 0 });
    guy.toggle(oil);
    expect(guy.item(oil)?.done).toBe(false);
  });

  it('added again by name while stocked up: it comes down to its buy-at count, one to buy now', async () => {
    const guy = await person('guy');
    const pantry = guy.createList({ name: 'Pantry' });
    const oil = guy.addItem(pantry, { title: 'Olive oil' });
    guy.setStock(oil, { stock: 5, stockAddAt: 2 });
    const res = guy.add(pantry, { title: 'olive oil' });
    expect(res).toMatchObject({ kind: 'exists', id: oil });
    expect(guy.item(oil)?.stock).toBe(2);
    expect(page(guy, pantry).open.map((i) => i.id)).toEqual([oil]);
  });

  it('older data: what it had put on a shopping list goes, and the old fields are cleared', async () => {
    const guy = await person('guy');
    const pantry = guy.createList({ name: 'Pantry' });
    const shop = guy.createList({ name: 'Shopping' });
    const oil = guy.addItem(pantry, { title: 'Olive oil' });
    const entry = guy.addItem(shop, { title: 'Olive oil' });
    const kept = guy.addItem(shop, { title: 'Rice' });
    const rice = guy.addItem(pantry, { title: 'Rice' });
    guy.store.mutate('item', oil, { stock: 0, stockLink: entry, stockMade: true, stockFull: 4, stockTo: shop } as never);
    // One that was on the list already (not made by it) stays.
    guy.store.mutate('item', rice, { stock: 0, stockLink: kept, stockMade: false } as never);
    guy.stockInPlace();
    expect(guy.item(entry)).toBeUndefined();
    expect(guy.item(kept)).toBeDefined();
    expect(guy.item(oil)).toMatchObject({ stock: 0, stockLink: null, stockFull: null, stockTo: null });
    guy.stockInPlace();
  });
});


import { isOpen, type Item } from '../model';
import { Hub, type AddResult, type Undo } from './base';

/** Things we count: how many are in, and putting them on a list when they run low. */

declare module './base' {
  interface Hub {
    /** Everything we count the stock of, from every folder. */
    stockItems(): Item[];

    /** As many as we want (or more). */
    stockFull(item: Item): boolean;

    /** It's running low (at or under where it goes on the list). */
    stockLow(item: Item): boolean;

    /** Where exactly: a folder, or under a task in one (the tree picker's choice). */
    stockPlace(item: Item): { listId: string; parentId: string | null };

    /**
     * Change how many are in, or its levels (`stock: null` stops keeping it stocked). Then it checks
     * itself: low → on the list (urgent when very low); stocked again by hand → off the list, if it
     * put it there. Returns the undo.
     */
    setStock(id: string, patch: Partial<Pick<Item, 'stock' | 'stockFull' | 'stockAddAt' | 'stockUrgentAt' | 'stockTo' | 'stockUnder'>>): Undo;

    /** @internal */
    stockChange(id: string, fn: () => void): Undo;

    /** Puts it on its list when low, makes that urgent when very low, takes it off when it's stocked again. Returns an entry it made. (internal) */
    stockCheck(id: string): string | null;
  }
}

Hub.prototype.stockItems = function (this: Hub): Item[] {
  const lists = new Set(this.lists().map((l) => l.id));
  return this.store.all('item').filter((i) => i.stock != null && !i.archived && lists.has(i.listId));
};

Hub.prototype.stockFull = function (this: Hub, item: Item): boolean {
  return item.stock != null && item.stockFull != null && item.stock >= item.stockFull;
};

Hub.prototype.stockLow = function (this: Hub, item: Item): boolean {
  return item.stock != null && item.stock <= (item.stockAddAt ?? 1);
};

Hub.prototype.stockPlace = function (this: Hub, item: Item): { listId: string; parentId: string | null } {
  const under = item.stockUnder ? this.item(item.stockUnder) : undefined;
  if (under && !under.archived) return { listId: under.listId, parentId: under.id };
  return { listId: (item.stockTo && this.list(item.stockTo)?.id) || this.shopRoot()?.id || item.listId, parentId: null };
};

Hub.prototype.setStock = function (this: Hub, id: string, patch: Partial<Pick<Item, 'stock' | 'stockFull' | 'stockAddAt' | 'stockUrgentAt' | 'stockTo' | 'stockUnder'>>): Undo {
  return this.stockChange(id, () => {
    const f: Partial<Item> = { ...patch };
    if (typeof f.stock === 'number') f.stock = Math.max(0, Math.round(f.stock));
    this.store.mutate('item', id, f);
  });
};

Hub.prototype.stockChange = function (this: Hub, id: string, fn: () => void): Undo {
  const before = this.item(id);
  if (!before) return () => {};
  const keep = { stock: before.stock ?? null, stockFull: before.stockFull ?? null, stockAddAt: before.stockAddAt ?? null, stockUrgentAt: before.stockUrgentAt ?? null, stockTo: before.stockTo ?? null, stockUnder: before.stockUnder ?? null, stockLink: before.stockLink ?? null, stockMade: !!before.stockMade };
  const link = before.stockLink ? this.item(before.stockLink) : undefined;
  const linkWas = link ? { urgent: !!link.urgent, qty: link.qty ?? null, deleted: false } : null;
  let made: string | null = null;
  this.store.batch(() => {
    fn();
    made = this.stockCheck(id);
  });
  return () =>
    this.store.batch(() => {
      this.store.mutate('item', id, keep);
      if (made) this.store.mutate('item', made, { deleted: true });
      if (link && linkWas) this.store.mutate('item', link.id, linkWas);
    });
};

Hub.prototype.stockCheck = function (this: Hub, id: string): string | null {
  const it = this.item(id);
  if (!it) return null;
  const link = it.stockLink ? this.item(it.stockLink) : undefined;
  const open = link && isOpen(link) ? link : undefined;
  if (it.stock == null) return null;
  const low = it.stock <= (it.stockAddAt ?? 1);
  const urgent = it.stockUrgentAt != null && it.stock <= it.stockUrgentAt;
  // What's missing, up to how many we like to have (none set: just "get more").
  const missing = it.stockFull != null && it.stockFull > it.stock ? String(it.stockFull - it.stock) : null;
  if (low) {
    if (open) {
      const f: Partial<Item> = {};
      if (!!open.urgent !== urgent) f.urgent = urgent;
      if (it.stockMade && (open.qty ?? null) !== missing) f.qty = missing;
      if (Object.keys(f).length) this.store.mutate('item', open.id, f);
      return null;
    }
    const place = this.stockPlace(it);
    let res: AddResult;
    if (place.parentId) {
      // Under a task: one there by that name already will do.
      const there = this.childrenOf(place.parentId).find((c) => isOpen(c) && c.title.trim().toLowerCase() === it.title.trim().toLowerCase());
      res = there ? { kind: 'exists', id: there.id, listId: place.listId } : { kind: 'added', id: this.addItem(place.listId, { title: it.title, urgent, qty: missing, parentId: place.parentId }), listId: place.listId };
    } else res = this.add(place.listId, { title: it.title, urgent, qty: missing });
    if (res.kind === 'exists' && urgent) this.store.mutate('item', res.id, { urgent: true });
    this.store.mutate('item', id, { stockLink: res.id, stockMade: res.kind !== 'exists' });
    return res.kind === 'exists' ? null : res.id;
  }
  // Stocked again (by hand): what it put on the list goes; one that was there already stays.
  if (open && it.stockMade) this.store.mutate('item', open.id, { deleted: true });
  if (it.stockLink) this.store.mutate('item', id, { stockLink: null, stockMade: false });
  return null;
};

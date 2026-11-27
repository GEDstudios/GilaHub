import type { Item } from '../model';
import { Hub, type Undo } from './base';

/**
 * Things we keep stocked: an item that's counted instead of ticked. It stays in its own folder:
 * above its buy-at count it waits in the folder's "In stock" (model.isStocked); at or under it,
 * it's one of the folder's tasks, to buy, and urgent at its urgent count.
 */

export type StockPatch = Partial<Pick<Item, 'stock' | 'stockAddAt' | 'stockUrgentAt'>>;

declare module './base' {
  interface Hub {
    /**
     * Change how many we have, or when it's bought or urgent (`stock: null` stops counting it).
     * Crossing its urgent count turns urgent on, or off again. Returns the undo.
     */
    setStock(id: string, patch: StockPatch): Undo;

    /** Older data: what a kept-stocked thing put on a shopping list goes (it's on its own list now). */
    stockInPlace(): void;
  }
}

/** At its urgent count (or under). */
const urgentLevel = (i: Pick<Item, 'stock' | 'stockUrgentAt'>) => i.stock != null && i.stockUrgentAt != null && i.stock <= i.stockUrgentAt;

Hub.prototype.setStock = function (this: Hub, id: string, patch: StockPatch): Undo {
  const before = this.item(id);
  if (!before) return () => {};
  const keep = { stock: before.stock ?? null, stockAddAt: before.stockAddAt ?? null, stockUrgentAt: before.stockUrgentAt ?? null, urgent: !!before.urgent, urgentBy: before.urgentBy ?? null };
  const next = { ...before, ...patch };
  const f: Partial<Item> = { ...patch };
  if (typeof f.stock === 'number') f.stock = next.stock = Math.max(0, Math.round(f.stock));
  // Urgent follows its count, but only when the count crosses the line (urgent set by hand stays).
  const was = urgentLevel(before);
  const now = urgentLevel(next);
  if (now !== was && now !== !!before.urgent) {
    f.urgent = now;
    f.urgentBy = now ? this.meId : null;
  }
  this.store.mutate('item', id, f);
  return () => this.store.mutate('item', id, keep);
};

Hub.prototype.stockInPlace = function (this: Hub): void {
  type Old = Item & { stockLink?: string | null; stockMade?: boolean; stockFull?: number | null; stockTo?: string | null; stockUnder?: string | null };
  const old = (this.store.all('item') as Old[]).filter((i) => i.stockLink != null || i.stockFull != null || i.stockTo != null || i.stockUnder != null);
  if (!old.length) return;
  this.store.batch(() => {
    for (const i of old) {
      const link = i.stockLink && i.stockMade ? this.item(i.stockLink) : undefined;
      if (link && !link.done) this.store.mutate('item', link.id, { deleted: true });
      this.store.mutate('item', i.id, { stockLink: null, stockMade: false, stockFull: null, stockTo: null, stockUnder: null } as Partial<Item>);
    }
  });
};

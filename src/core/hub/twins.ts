
import { type Item } from '../model';
import { Hub, type Undo } from './base';

/** One thing in two places ("Buy a doorknob" under a chore is also on Home shopping): linking, unlinking. */

declare module './base' {
  interface Hub {
    /** Tick / untick, as tickKind says. */
    /** The other place this thing lives, if it's linked (and that one still points back). */
    linked(item: Item | undefined): Item | undefined;

    /**
     * Put this thing in another project as well. On a shopping list it goes in as the thing to
     * buy ("Buy a doorknob" → "doorknob"); elsewhere as itself. Returns the new (or found) id.
     */
    alsoIn(id: string, listId: string, parentId?: string | null): string | null;

    /** "Buy a doorknob": a subtask that's shopping lands on the right shopping list too. */
    linkIfShopping(id: string): string | null;

    /** Take it out of the other place only (that copy goes; this one stays, on its own). */
    removeTwin(id: string): Undo;
  }
}

Hub.prototype.linked = function (this: Hub, item: Item | undefined): Item | undefined {
  const other = item?.linkId ? this.item(item.linkId) : undefined;
  return other && other.linkId === item!.id && !other.deleted ? other : undefined;
};

Hub.prototype.alsoIn = function (this: Hub, id: string, listId: string, parentId: string | null = null): string | null {
  const item = this.item(id);
  const list = this.list(listId);
  if (!item || !list || this.linked(item)) return null;
  // Not inside itself, nor next to itself in the same spot.
  if (parentId && (parentId === id || this.isUnder(parentId, id))) return null;
  if (!parentId && list.id === item.listId && !item.parentId) return null;
  return this.store.batch(() => {
    const other =
      parentId ? this.addItem(listId, { title: item.title, parentId }) : this.add(listId, { title: buyWords(item.title) ? toBuy(item.title) : item.title }).id;
    this.store.mutate('item', other, { linkId: id });
    this.store.mutate('item', id, { linkId: other });
    return other;
  });
};

Hub.prototype.linkIfShopping = function (this: Hub, id: string): string | null {
  const item = this.item(id);
  const root = this.shopRoot();
  if (!item || !root || !buyWords(item.title) || this.inShopTree(item.listId)) return null;
  return this.alsoIn(id, this.placeFor(toBuy(item.title), root.id));
};

Hub.prototype.removeTwin = function (this: Hub, id: string): Undo {
  const item = this.item(id);
  const twin = this.linked(item);
  if (!item || !twin) return () => {};
  const gone = [twin.id, ...this.descendants(twin.id).map((d) => d.id)];
  this.store.batch(() => {
    for (const g of gone) this.store.mutate('item', g, { deleted: true });
    this.store.mutate('item', id, { linkId: null });
  });
  return () =>
    this.store.batch(() => {
      for (const g of gone) this.store.mutate('item', g, { deleted: false });
      this.store.mutate('item', id, { linkId: twin.id });
    });
};

const BUY = /^(?:buy|get|order|pick up|grab|לקנות|קנה|קני|להזמין)\s+(.+)$/i;

export function buyWords(title: string): boolean {
  return BUY.test(title.trim());
}

export function toBuy(title: string): string {
  const m = title.trim().match(BUY);
  return (m ? m[1] : title).replace(/^(?:a|an|the|some)\s+/i, '').trim();
}

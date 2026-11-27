
import type { Item, Scope } from '../model';
import { Hub, type ItemVisibility } from './base';

/** Who sees and may change what: an item's privacy, its owner, re-scoping when it moves. */

declare module './base' {
  interface Hub {
    visibilityOf(item: Item): ItemVisibility;

    /** Whose is it? (for "Mine" items and private ones) */
    ownerOf(item: Item): string | null;

    /**
     * "Mine" belongs to one of us, but both can see it and help with it.
     * Only "Only me" things are closed — and the partner never receives those.
     */
    canEdit(item: Item): boolean;

    /**
     * Who can see it: anyone's call while we both see it (so a thing I handed to my partner can
     * come back); an "Only me" thing is its owner's alone.
     */
    canSetPrivacy(item: Item): boolean;

    /** @internal */
    scopeForItem(item: Item): Scope;

    /** Re-seal an item, its descendants and their logs under the scope their privacy implies. */
    rescope(id: string): void;

    setItemVisibility(id: string, vis: ItemVisibility, owner?: string): void;
  }
}

Hub.prototype.visibilityOf = function (this: Hub, item: Item): ItemVisibility {
  const list = this.list(item.listId);
  if (list?.visibility === 'private') return 'private';
  if (item.private || this.ancestors(item).some((a) => a.private)) return 'private';
  // In someone's "Mine" project, a thing can still be for both of us: no owner.
  if (list?.visibility === 'visible') return item.owner === null ? 'ours' : 'mine';
  return item.owner ? 'mine' : 'ours';
};

Hub.prototype.ownerOf = function (this: Hub, item: Item): string | null {
  const list = this.list(item.listId);
  if (item.owner) return item.owner;
  if (list?.visibility === 'private') return list.owner;
  if (list?.visibility === 'visible') return item.owner === null ? null : list.owner;
  return null;
};

Hub.prototype.canEdit = function (this: Hub, item: Item): boolean {
  const owner = this.ownerOf(item);
  return !owner || owner === this.meId || this.visibilityOf(item) !== 'private';
};

Hub.prototype.canSetPrivacy = function (this: Hub, item: Item): boolean {
  const owner = this.ownerOf(item);
  return !owner || owner === this.meId || item.createdBy === this.meId || this.visibilityOf(item) !== 'private';
};

Hub.prototype.scopeForItem = function (this: Hub, item: Item): Scope {
  const list = this.list(item.listId);
  if (list?.visibility === 'private' && list.owner) return `p:${list.owner}`;
  let node: Item | undefined = item;
  let guard = 0;
  while (node && guard++ < 1000) {
    if (node.private) return `p:${node.owner ?? node.createdBy}`;
    node = this.item(node.parentId);
  }
  return 'h';
};

Hub.prototype.rescope = function (this: Hub, id: string): void {
  const root = this.item(id);
  if (!root) return;
  const all = [root, ...this.descendants(id)];
  this.store.batch(() => {
    for (const it of all) {
      const scope = this.scopeForItem(this.item(it.id) ?? it);
      this.store.setScope('item', it.id, scope);
      for (const log of this.store.all('log')) if (log.itemId === it.id) this.store.setScope('log', log.id, scope);
      this.rescopePhotos(`item:${it.id}`);
    }
  });
};

Hub.prototype.setItemVisibility = function (this: Hub, id: string, vis: ItemVisibility, owner?: string): void {
  const item = this.item(id);
  if (!item) return;
  this.store.batch(() => {
    this.store.mutate('item', id, {
      private: vis === 'private',
      owner:
        vis === 'ours'
          ? null
          : vis === 'mine' && owner
            ? owner
            : vis === 'mine' && this.list(item.listId)?.visibility === 'visible'
              ? (this.list(item.listId)?.owner ?? this.meId)
              : vis === 'private'
                ? this.meId
                : (this.ownerOf(item) ?? this.meId),
    });
    this.rescope(id);
  });
};

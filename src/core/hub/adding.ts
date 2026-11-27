
import { isOpen, isStocked, type Item, type List, type ListView } from '../model';
import { keyBetween } from '../order';
import { fold, itemKey } from '../../smart/normalize';
import { Hub, type AddResult, type ItemVisibility, type NewItem } from './base';

/** Adding by name (the composer and "Again?"): where a thing goes, never twice, the Shopping root; and searching. */

declare module './base' {
  interface Hub {
    /** The Shopping project (from the move from before, or a shopping template): where "Buy a doorknob" also goes. */
    shopRoot(): List | undefined;

    /** Is this project Shopping or inside it? (Only for "Buy …" twins, and never-tagged things from older apps.) (internal) */
    inShopTree(listId: string | null | undefined): boolean;

    /** The Shopping project, made if there's none yet (at the top of Projects, looked at by tag). */
    ensureShopRoot(): string;

    /**
     * How I look at a folder: as a list, as cards, or grouped by tag. It's mine (kept on my member
     * record, on all my phones); my partner keeps theirs. The folder's own `view` is only where
     * each of us starts.
     */
    setListView(id: string, view: ListView): void;

    viewOf(list: List | undefined): ListView;

    /** Learned category lookup: private memory first, then shared. */
    learned(key: string): { category: string; emoji?: string } | undefined;

    findOnList(listIds: string[], name: string): Item | undefined;

    /**
     * Where a new thing goes, among a project and the projects inside it: where the same thing
     * already is; else where things wearing its tag (or one of its kind: groceries, home) live;
     * else the project itself.
     */
    placeFor(title: string, listId: string): string;

    /**
     * Add a thing the one way, to any project: never twice. Already open there → said so (urgency
     * goes onto it; a kept-stocked thing that's stocked up comes down to its buy-at count, so it's
     * one to buy now); done before → brought back as it's asked for now; else new. A subtask is
     * just added.
     */
    add(listId: string, input: NewItem): AddResult;

    /** Add a thing by name, as written, never twice (Hub.add). */
    addShopping(listId: string, raw: string, extra?: { urgent?: boolean; visibility?: ItemVisibility; owner?: string | null; tags?: string[] | null }): AddResult;

search(query: string, limit?: number): Item[];
  }
}

Hub.prototype.shopRoot = function (this: Hub): List | undefined {
  return this.lists().find((l) => l.shopRoot);
};

Hub.prototype.inShopTree = function (this: Hub, listId: string | null | undefined): boolean {
  const l = this.list(listId);
  if (!l) return false;
  return !!l.shopRoot || l.kind === 'shopping' || this.listPath(l.id).some((p) => p.shopRoot);
};

Hub.prototype.ensureShopRoot = function (this: Hub): string {
  const have = this.shopRoot() ?? this.store.all('list').find((l) => l.shopRoot);
  if (have) {
    if (have.archived) this.store.mutate('list', have.id, { archived: false });
    return have.id;
  }
  const first = this.lists()[0];
  return this.store.batch(() => {
    const id = this.createList({ name: 'Shopping', icon: 'i:basket', visibility: 'shared', view: 'tags' });
    this.store.mutate('list', id, { shopRoot: true, order: keyBetween(null, first?.order ?? null) });
    return id;
  });
};

Hub.prototype.setListView = function (this: Hub, id: string, view: ListView): void {
  if (!this.list(id)) return;
  this.upsertMember(this.meId, { views: { ...(this.me()?.views ?? {}), [id]: view } });
};

Hub.prototype.viewOf = function (this: Hub, list: List | undefined): ListView {
  if (!list) return 'list';
  return this.me()?.views?.[list.id] ?? list.view ?? 'list';
};

Hub.prototype.learned = function (this: Hub, key: string): { category: string; emoji?: string } | undefined {
  return this.store.get('memory', `p:${this.meId}:${key}`) ?? this.store.get('memory', key);
};

Hub.prototype.findOnList = function (this: Hub, listIds: string[], name: string): Item | undefined {
  const key = itemKey(name);
  const ids = new Set(listIds);
  let best: Item | undefined;
  for (const it of this.store.all('item')) {
    if (!ids.has(it.listId) || it.parentId || itemKey(it.title) !== key) continue;
    if (!best || (!it.archived && best.archived) || (!it.done && best.done)) best = it;
  }
  return best;
};

Hub.prototype.placeFor = function (this: Hub, title: string, listId: string): string {
  const tree = this.treeIds(listId);
  if (tree.length === 1 || !title.trim()) return listId;
  const same = this.findOnList(tree, title);
  if (same) return same.listId;
  const s = this.suggestTags(title, listId);
  const tag = s.auto[0] ?? s.more[0] ?? this.catalogTag(title);
  if (!tag) return listId;
  const family = tag.includes(':') ? tag.split(':')[0] : null;
  const score = new Map<string, number>();
  for (const i of this.store.all('item')) {
    if (!tree.includes(i.listId) || i.parentId) continue;
    const tags = this.tagsOf(i);
    const n = tags.includes(tag) ? 10 : family && family !== 'c' && tags.some((t) => t.startsWith(`${family}:`)) ? 1 : 0;
    if (n) score.set(i.listId, (score.get(i.listId) ?? 0) + n);
  }
  let best = listId;
  let top = 0;
  for (const [id, n] of score) if (n > top) [best, top] = [id, n];
  // Nothing of its kind yet: a list made for that kind (Groceries, Home shopping).
  if (!top && (family === 'g' || family === 'h')) return tree.find((id) => this.list(id)?.flavor === (family === 'g' ? 'grocery' : 'home')) ?? listId;
  return best;
};

Hub.prototype.add = function (this: Hub, listId: string, input: NewItem): AddResult {
  if (input.parentId) return { kind: 'added', id: this.addItem(listId, input), listId };
  const existing = this.findOnList([listId], input.title);
  if (existing && isOpen(existing)) {
    if (isStocked(existing)) this.setStock(existing.id, { stock: existing.stockAddAt ?? 1 });
    if (input.urgent && !existing.urgent) this.updateItem(existing.id, { urgent: true });
    return { kind: 'exists', id: existing.id, listId };
  }
  if (existing && this.canEdit(existing) && !existing.repeat) {
    this.store.batch(() => {
      this.store.mutate('item', existing.id, {
        done: false,
        doneAt: null,
        doneBy: null,
        archived: false,
        logId: null,
        urgent: input.urgent ?? false,
        urgentBy: input.urgent ? this.meId : null,
        due: input.due ?? null,
        dueTime: input.dueTime ?? null,
        remind: input.remind ?? null,
        addedBy: this.meId,
        addedAt: Date.now(),
        order: keyBetween(this.children(listId, null).at(-1)?.order ?? null, null),
      });
      if (input.assignee !== undefined) this.assign(existing.id, input.assignee ?? null, { needsOk: input.needsOk });
      if (input.tags) this.setTags(existing.id, input.tags);
    });
    return { kind: 'revived', id: existing.id, listId };
  }
  return { kind: 'added', id: this.addItem(listId, input), listId };
};

Hub.prototype.addShopping = function (this: Hub, listId: string, raw: string, extra: { urgent?: boolean; visibility?: ItemVisibility; owner?: string | null; tags?: string[] | null } = {}): AddResult {
  return this.add(listId, { title: raw.trim(), urgent: extra.urgent, visibility: extra.visibility, owner: extra.owner, tags: extra.tags ?? undefined });
};

Hub.prototype.search = function (this: Hub, query: string, limit = 40): Item[] {
  const q = fold(query);
  if (!q) return [];
  const lists = new Set(this.lists().map((l) => l.id));
  const hits: Array<{ it: Item; rank: number }> = [];
  for (const it of this.store.all('item')) {
    if (!lists.has(it.listId)) continue;
    const t = fold(it.title);
    let rank = -1;
    if (t.startsWith(q)) rank = 0;
    else if (t.split(' ').some((w) => w.startsWith(q))) rank = 1;
    else if (t.includes(q)) rank = 2;
    else if (it.notes && fold(it.notes).includes(q)) rank = 3;
    if (rank >= 0) hits.push({ it, rank: rank + (it.done ? 4 : 0) });
  }
  hits.sort((a, b) => a.rank - b.rank || (b.it.createdAt ?? 0) - (a.it.createdAt ?? 0));
  return hits.slice(0, limit).map((h) => h.it);
};

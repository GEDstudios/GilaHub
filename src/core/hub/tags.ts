
import { newId } from '../ids';
import type { Item, Tag } from '../model';
import { byOrder, keyBetween } from '../order';
import { aisleGlyph, categorize, categoryMeta, categoryOrder, lookup, routeFlavor, type Flavor } from '../../smart/categorize';
import { fold, itemKey } from '../../smart/normalize';
import { Hub, type Undo } from './base';

/** Tags: the built-in aisles and our own, what a title suggests, learning from what we pick. */

declare module './base' {
  interface Hub {
    /** Our tags, in order (the walk through the store). */
    tags(): Tag[];

    tag(id: string | null | undefined): Tag | undefined;

    /** A built-in tag nobody took away yet ("g:dairy"): what it would be, if it isn't here. (internal) */
    builtinTag(id: string): { name: string; icon?: string } | null;

    /** Taken away for good (a deleted built-in never comes back by itself). (internal) */
    tagGone(id: string): boolean;

    /** Make sure a built-in tag is here (placed in its walking order). Returns whether it is. */
    ensureTag(id: string): boolean;

    /** A shopping list's whole set of aisles, as tags (when a groceries or home list is made). */
    ensureBuiltinTags(flavor: Flavor): void;

    /** A new tag of ours, at the end. Returns its id (an existing one with that name, if any). */
    createTag(name: string, icon?: string | null): string | null;

    updateTag(id: string, fields: Partial<Pick<Tag, 'name' | 'icon'>>): void;

    /** Our whole order, as it now reads. */
    arrangeTags(ids: string[]): void;

    /** Take a tag away: off every task that wore it. Returns the way back. */
    deleteTag(id: string): Undo;

    /** How many open things wear each tag. */
    tagCounts(): Map<string, number>;

    /** The tag id an older aisle category becomes ("dairy" on groceries → "g:dairy"; ours keep theirs). */
    tagIdFor(flavor: Flavor, category: string): string;

    /** What the catalog (or what we taught it) makes of these words: an aisle's tag, or none. */
    catalogTag(title: string, flavor?: Flavor): string | null;

    /**
     * What it wears: its own tags (only ones we still have). A thing to buy that was never tagged
     * (older data, or added by an older app) wears its aisle: its category, or what the catalog says.
     */
    tagsOf(item: Item): string[];

    /**
     * Tags for these words: `auto` goes on by itself (what we taught it; in a project that goes by
     * aisle also the catalog's aisle), `more` is offered (the catalog elsewhere, tags named in the words).
     */
    suggestTags(title: string, listId?: string | null): { auto: string[]; more: string[] };

    /**
     * Does this project go by aisle? Looked at by tag (it or a project it's in), or already
     * holding things that wear an aisle: then the catalog's aisle goes on by itself.
     */
    byAisle(listId: string): boolean;

    /** Change its tags, and remember them for the same words next time (for both of us, unless it's private). */
    setTags(id: string, tags: string[]): Undo;

    /** @internal */
    learnTags(item: Item, tags: string[]): void;

    /** Moved to another aisle on Shopping: that tag instead of the aisle it was in (others stay). */
    moveToTag(id: string, from: string | null, to: string | null): void;

    /**
     * Tags used lately, newest first: from when each task's tags were last set (on any device),
     * so the picker can offer them first.
     */
    recentTags(limit?: number): string[];
  }
}

Hub.prototype.tags = function (this: Hub): Tag[] {
  return [...this.store.all('tag')].sort(byOrder);
};

Hub.prototype.tag = function (this: Hub, id: string | null | undefined): Tag | undefined {
  return id ? this.store.get('tag', id) : undefined;
};

Hub.prototype.builtinTag = function (this: Hub, id: string): { name: string; icon?: string } | null {
  const m = id.match(/^([gh]):([a-z]+)$/);
  if (!m || m[2] === 'other') return null;
  const flavor: Flavor = m[1] === 'g' ? 'grocery' : 'home';
  if (!categoryOrder(flavor).includes(m[2])) return null;
  const glyph = aisleGlyph(flavor, m[2]);
  return { name: categoryMeta(flavor, m[2]).en, icon: glyph ? `i:${glyph}` : categoryMeta(flavor, m[2]).e };
};

Hub.prototype.tagGone = function (this: Hub, id: string): boolean {
  return !!this.store.record('tag', id)?.v.deleted;
};

Hub.prototype.ensureTag = function (this: Hub, id: string): boolean {
  if (this.tag(id)) return true;
  const b = this.builtinTag(id);
  if (!b || this.tagGone(id)) return false;
  // In the catalog's walk, between the built-ins around it that we have.
  const flavor: Flavor = id.startsWith('g:') ? 'grocery' : 'home';
  const walk = [...categoryOrder('grocery').map((c) => `g:${c}`), ...categoryOrder('home').map((c) => `h:${c}`)];
  const at = walk.indexOf(id);
  const all = this.tags();
  const after = all.filter((t) => walk.indexOf(t.id) > at && walk.indexOf(t.id) >= 0)[0];
  const prev = after ? all[all.indexOf(after) - 1] : all.filter((t) => t.id.startsWith(`${flavor[0]}:`)).at(-1) ?? all.at(-1);
  this.store.mutate('tag', id, {
    name: b.name,
    icon: b.icon ?? null,
    order: keyBetween(prev?.order ?? null, after?.order ?? null),
    createdAt: Date.now(),
    createdBy: this.meId,
  });
  return true;
};

Hub.prototype.ensureBuiltinTags = function (this: Hub, flavor: Flavor): void {
  this.store.batch(() => {
    for (const c of categoryOrder(flavor)) this.ensureTag(`${flavor[0]}:${c}`);
  });
};

Hub.prototype.createTag = function (this: Hub, name: string, icon?: string | null): string | null {
  const t = name.trim().replace(/^#/, '');
  if (!t) return null;
  const same = this.tags().find((x) => fold(x.name) === fold(t));
  if (same) return same.id;
  const id = `c:${newId(10)}`;
  this.store.mutate('tag', id, { name: t, icon: icon ?? null, order: keyBetween(this.tags().at(-1)?.order ?? null, null), createdAt: Date.now(), createdBy: this.meId });
  return id;
};

Hub.prototype.updateTag = function (this: Hub, id: string, fields: Partial<Pick<Tag, 'name' | 'icon'>>): void {
  if (!this.tag(id)) return;
  const f = { ...fields };
  if (f.name !== undefined) {
    f.name = f.name.trim().replace(/^#/, '');
    if (!f.name) return;
  }
  this.store.mutate('tag', id, f);
};

Hub.prototype.arrangeTags = function (this: Hub, ids: string[]): void {
  this.store.batch(() => {
    let prev: string | null = null;
    for (const id of ids) {
      const cur = this.tag(id);
      if (!cur) continue;
      const next = ids.slice(ids.indexOf(id) + 1).map((x) => this.tag(x)?.order).find(Boolean) ?? null;
      // Keep a key that already sits in place; give a new one only where needed.
      if (!(cur.order > (prev ?? '') && (!next || cur.order < next))) {
        const k = keyBetween(prev, next && next > (prev ?? '') ? next : null);
        this.store.mutate('tag', id, { order: k });
        prev = k;
      } else prev = cur.order;
    }
  });
};

Hub.prototype.deleteTag = function (this: Hub, id: string): Undo {
  const tag = this.tag(id);
  if (!tag) return () => {};
  const wearing = this.store.all('item').filter((i) => this.tagsOf(i).includes(id));
  const before = new Map(wearing.map((i) => [i.id, i.tags ?? null]));
  this.store.batch(() => {
    for (const i of wearing) this.store.mutate('item', i.id, { tags: this.tagsOf(i).filter((t) => t !== id) });
    this.store.mutate('tag', id, { deleted: true });
  });
  return () =>
    this.store.batch(() => {
      this.store.mutate('tag', id, { deleted: false });
      for (const [iid, tags] of before) this.store.mutate('item', iid, { tags });
    });
};

Hub.prototype.tagCounts = function (this: Hub): Map<string, number> {
  const n = new Map<string, number>();
  for (const i of this.store.all('item')) {
    if (i.done || i.archived) continue;
    for (const t of this.tagsOf(i)) n.set(t, (n.get(t) ?? 0) + 1);
  }
  return n;
};

Hub.prototype.tagIdFor = function (this: Hub, flavor: Flavor, category: string): string {
  return category.includes(':') ? category : `${flavor[0]}:${category}`;
};

Hub.prototype.catalogTag = function (this: Hub, title: string, flavor?: Flavor): string | null {
  const f = flavor ?? routeFlavor(title);
  const hit = categorize(title, f, (k) => this.learned(k));
  // Not this list's kind of thing ("bulbs" on Groceries): the catalog's own aisle for it.
  const other = !hit.category || hit.category === 'other' ? lookup(title) : undefined;
  const id = other ? (other.category !== 'other' ? `${other.flavor[0]}:${other.category}` : null) : this.tagIdFor(f, hit.category);
  if (!id) return null;
  return this.tag(id) || (this.builtinTag(id) && !this.tagGone(id)) ? id : null;
};

Hub.prototype.tagsOf = function (this: Hub, item: Item): string[] {
  if (Array.isArray(item.tags)) return item.tags.filter((t) => !!this.tag(t));
  if (item.parentId || !this.inShopTree(item.listId)) return [];
  const flavor = (this.list(item.listId)?.flavor ?? 'grocery') as Flavor;
  const id = item.category && item.category !== 'other' ? this.tagIdFor(flavor, item.category) : this.catalogTag(item.title, flavor);
  return id && this.tag(id) ? [id] : [];
};

Hub.prototype.suggestTags = function (this: Hub, title: string, listId?: string | null): { auto: string[]; more: string[] } {
  const key = itemKey(title);
  if (!key) return { auto: [], more: [] };
  const taught = (this.store.get('memory', `p:${this.meId}:t:${key}`) ?? this.store.get('memory', `t:${key}`)) as { tags?: string[] } | undefined;
  const auto = (Array.isArray(taught?.tags) ? taught.tags : []).filter((t) => !!this.tag(t));
  const aisled = !!listId && this.byAisle(listId);
  const more: string[] = [];
  const cat = this.catalogTag(title);
  if (cat && !auto.includes(cat)) (aisled && !auto.length ? auto : more).push(cat);
  const words = new Set(fold(title).split(' '));
  for (const t of this.tags()) {
    const n = fold(t.name);
    if (n && !auto.includes(t.id) && !more.includes(t.id) && (words.has(n) || (n.includes(' ') && fold(title).includes(n)))) more.push(t.id);
  }
  return { auto, more };
};

Hub.prototype.byAisle = function (this: Hub, listId: string): boolean {
  const l = this.list(listId);
  if (!l) return false;
  if ([l, ...this.listPath(l.id)].some((p) => p.view === 'tags' || this.me()?.views?.[p.id] === 'tags')) return true;
  return this.store.all('item').some((i) => i.listId === listId && !i.parentId && this.tagsOf(i).some((t) => /^[gh]:/.test(t)));
};

Hub.prototype.setTags = function (this: Hub, id: string, tags: string[]): Undo {
  const item = this.item(id);
  if (!item) return () => {};
  const clean = [...new Set(tags)].filter((t) => this.ensureTag(t));
  const undo = this.updateItem(id, { tags: clean });
  this.learnTags(item, clean);
  return undo;
};

Hub.prototype.learnTags = function (this: Hub, item: Item, tags: string[]): void {
  const key = itemKey(item.title);
  if (!key) return;
  const isPrivate = this.visibilityOf(item) === 'private';
  const memId = isPrivate ? `p:${this.meId}:t:${key}` : `t:${key}`;
  if (isPrivate) this.store.init('memory', memId, `p:${this.meId}`);
  this.store.mutate('memory', memId, { tags } as never);
};

Hub.prototype.moveToTag = function (this: Hub, id: string, from: string | null, to: string | null): void {
  const item = this.item(id);
  if (!item) return;
  const now = this.tagsOf(item).filter((t) => t !== from && t !== to);
  this.setTags(id, to ? [to, ...now] : now);
};

Hub.prototype.recentTags = function (this: Hub, limit = 8): string[] {
  const seen: Array<[string, string]> = [];
  for (const i of this.store.all('item')) {
    if (!i.tags?.length) continue;
    const at = this.store.record('item', i.id)?.c.tags ?? '';
    seen.push([at, i.id]);
  }
  seen.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  const out: string[] = [];
  for (const [, id] of seen) {
    for (const t of this.item(id)?.tags ?? []) if (!out.includes(t) && this.tag(t)) out.push(t);
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
};

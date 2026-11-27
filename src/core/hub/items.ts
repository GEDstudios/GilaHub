import { today as todayStr } from '../dates';
import { newId } from '../ids';
import { type Item } from '../model';
import { keyBetween } from '../order';
import { firstDue } from '../../smart/recurrence';
import { Hub, type NewItem, type Undo } from './base';

/** Writing items: adding one where it goes, changing it, moving, reordering, deleting, duplicating. */

declare module './base' {
  interface Hub {
addItem(listId: string, input: NewItem): string;

    updateItem(id: string, fields: Partial<Item>): Undo;

    move(id: string, to: { listId?: string; parentId?: string | null; before?: string | null }): void;

    /** Reorder among siblings by placing between two neighbours. */
    reorder(id: string, prevId: string | null, nextId: string | null): void;

    /**
     * Reorder within a run of rows that aren't one list's siblings (a shopping aisle mixing two
     * lists): `seq` is the run as it now reads, with `id` dropped in its place. Each list numbers
     * its own keys, so neighbours can tie; then the rows from the drop down get fresh keys until
     * the keys climb again, so the run sorts exactly as dropped. Usually that's just `id`.
     */
    reorderIn(seq: readonly string[], id: string): void;

    delete(id: string): Undo;

    duplicate(id: string): string | null;

    /**
     * Open up tasks that sit under each other in a loop. `move` never makes one, but two devices
     * can each make a fair move at the same moment (X under Y here, Y under X there); each
     * `parentId` merges on its own, and then neither is at the top of anything: both are gone
     * from every list.
     *
     * The newest move stands. The task whose move is the oldest in the loop comes out to the top
     * of its folder, with everything under it. Every device picks the same task from the same
     * merged data and writes the very same thing, dated by that newest move (Store.amend): they
     * agree before they've heard from each other, and a move made since is never overwritten.
     * Run whenever the data changes; it writes only when there's a loop. Returns how many it opened.
     */
    mendTree(): number;
  }
}

Hub.prototype.addItem = function (this: Hub, listId: string, input: NewItem): string {
  const list = this.list(listId);
  const parentId = input.parentId ?? null;
  const siblings = this.siblings(listId, parentId);
  let order: string;
  if (input.before) {
    const idx = siblings.findIndex((s) => s.id === input.before);
    order = keyBetween(siblings[idx - 1]?.order ?? null, siblings[idx]?.order ?? null);
  } else {
    order = keyBetween(siblings.at(-1)?.order ?? null, null);
  }
  const vis = input.visibility ?? (list?.visibility === 'visible' ? 'mine' : list?.visibility === 'private' ? 'private' : 'ours');
  const id = newId();
  let due = input.due ?? null;
  if (input.repeat && !due) due = firstDue(input.repeat, todayStr());
  const fields: Partial<Item> = {
    listId,
    parentId,
    title: input.title.trim(),
    notes: input.notes ?? '',
    done: false,
    order,
    due,
    dueTime: input.dueTime ?? null,
    remind: input.remind ?? null,
    nag: input.remind != null ? (input.nag ?? null) : null,
    repeat: input.repeat ?? null,
    assignee: input.assignee ?? null,
    turn: input.assignee === 'turns' ? this.meId : null,
    urgent: input.urgent ?? false,
    urgentBy: input.urgent ? this.meId : null,
    tags: [...new Set(input.tags ?? this.suggestTags(input.title, listId).auto)].filter((t) => this.ensureTag(t)),
    // Added to someone's "Mine" project: it's still theirs — unless I say whose it is.
    owner:
      vis === 'ours'
        ? null
        : vis === 'mine' && input.owner
          ? input.owner
          : vis === 'mine' && list?.visibility === 'visible' && list.owner
            ? list.owner
            : this.meId,
    // Assigning it to my partner is asking them.
    requestedBy: this.isRequest(input.assignee) ? this.meId : null,
    needsOk: this.isRequest(input.assignee) ? !!input.needsOk : false,
    private: vis === 'private' && list?.visibility !== 'private',
    createdAt: Date.now(),
    createdBy: this.meId,
  };
  this.store.batch(() => {
    // Seal from the very first op under the right key.
    this.store.init('item', id, this.scopeForItem({ ...(fields as Item), id }));
    this.store.mutate('item', id, fields);
    if (input.tags) this.learnTags({ ...(fields as Item), id }, fields.tags ?? []);
  });
  return id;
};

Hub.prototype.updateItem = function (this: Hub, id: string, fields: Partial<Item>): Undo {
  const before = this.item(id);
  if (fields.urgent && !before?.urgent) fields = { ...fields, urgentBy: this.meId };
  // Renamed: its twin in a task project follows (a shopping twin keeps its shopping name).
  const twin = this.linked(before);
  // Renamed: its twin follows when it reads the same ("doorknob" stays, under "Buy a doorknob").
  const twinFollows = !!twin && !!fields.title && twin.title === before!.title;
  const prev: Record<string, unknown> = {};
  if (before) for (const k of Object.keys(fields)) prev[k] = (before as unknown as Record<string, unknown>)[k] ?? null;
  this.store.batch(() => {
    if (twinFollows) this.store.mutate('item', twin!.id, { title: fields.title });
    this.store.mutate('item', id, fields);
  });
  return () =>
    this.store.batch(() => {
      if (twinFollows) this.store.mutate('item', twin!.id, { title: before!.title });
      this.store.mutate('item', id, prev as Partial<Item>);
    });
};

Hub.prototype.move = function (this: Hub, id: string, to: { listId?: string; parentId?: string | null; before?: string | null }): void {
  const item = this.item(id);
  if (!item) return;
  const listId = to.listId ?? item.listId;
  const parentId = to.parentId === undefined ? (to.listId && to.listId !== item.listId ? null : (item.parentId ?? null)) : to.parentId;
  if (parentId === id || (parentId && this.isUnder(parentId, id))) return;
  const siblings = this.siblings(listId, parentId).filter((s) => s.id !== id);
  let order: string;
  if (to.before) {
    const idx = siblings.findIndex((s) => s.id === to.before);
    order = keyBetween(siblings[idx - 1]?.order ?? null, siblings[idx]?.order ?? null);
  } else order = keyBetween(siblings.at(-1)?.order ?? null, null);
  this.store.batch(() => {
    this.store.mutate('item', id, { listId, parentId, order });
    if (listId !== item.listId) for (const d of this.descendants(id)) this.store.mutate('item', d.id, { listId });
    this.rescope(id);
  });
};

Hub.prototype.reorder = function (this: Hub, id: string, prevId: string | null, nextId: string | null): void {
  const prev = this.item(prevId)?.order ?? null;
  const next = this.item(nextId)?.order ?? null;
  this.store.mutate('item', id, { order: keyBetween(prev, next) });
};

Hub.prototype.reorderIn = function (this: Hub, seq: readonly string[], id: string): void {
  const at = seq.indexOf(id);
  if (at < 0) return;
  const orders = seq.map((x) => this.item(x)?.order ?? null);
  let last = orders[at - 1] ?? null;
  this.store.batch(() => {
    for (let j = at; j < seq.length; j++) {
      const own = orders[j];
      if (j > at && own !== null && (last === null || own > last)) break;
      const up = orders.slice(j + 1).find((o) => o !== null && (last === null || o > last)) ?? null;
      last = keyBetween(last, up);
      this.store.mutate('item', seq[j], { order: last });
    }
  });
};

Hub.prototype.delete = function (this: Hub, id: string): Undo {
  const ids = [id, ...this.descendants(id).map((d) => d.id)];
  // It's one thing in two places: deleting it takes it from both (Undo brings both back).
  const twins = ids.map((i) => this.linked(this.item(i))).filter((t): t is Item => !!t);
  const all = [...ids, ...twins.flatMap((t) => [t.id, ...this.descendants(t.id).map((d) => d.id)])];
  this.store.batch(() => {
    for (const i of all) this.store.mutate('item', i, { deleted: true });
  });
  return () =>
    this.store.batch(() => {
      for (const i of all) this.store.mutate('item', i, { deleted: false });
    });
};

Hub.prototype.duplicate = function (this: Hub, id: string): string | null {
  const item = this.item(id);
  if (!item) return null;
  const copy = (src: Item, parentId: string | null): string => {
    const nid = this.addItem(src.listId, {
      title: src.title,
      parentId,
      notes: src.notes,
      due: src.due,
      dueTime: src.dueTime,
      remind: src.remind,
      repeat: src.repeat,
      assignee: src.assignee,
      urgent: src.urgent,
      visibility: this.visibilityOf(src),
    });
    for (const c of this.childrenOf(src.id)) copy(c, nid);
    return nid;
  };
  return this.store.batch(() => copy(item, item.parentId ?? null));
};

Hub.prototype.mendTree = function (this: Hub): number {
  /** When its place was last set: the clock of its `parentId`. */
  const moved = (id: string) => this.store.record('item', id)?.c.parentId ?? '';
  const oldestFirst = (a: string, b: string) => (moved(a) < moved(b) ? -1 : moved(a) > moved(b) ? 1 : a < b ? -1 : 1);
  // Walked already: the way up from these ends, or its loop is on the list.
  const clear = new Set<string>();
  const loops: string[][] = [];
  for (const { id } of this.store.all('item')) {
    // The way up from here. Meeting a task of this same walk again is a loop.
    const path = new Map<string, number>();
    let cur = this.item(id);
    while (cur?.parentId && !clear.has(cur.id) && !path.has(cur.id)) {
      path.set(cur.id, path.size);
      cur = this.item(cur.parentId);
    }
    const at = cur ? path.get(cur.id) : undefined;
    if (at !== undefined) loops.push([...path.keys()].slice(at).sort(oldestFirst));
    for (const p of path.keys()) clear.add(p);
  }
  // Nothing wrong (nearly always): no write, so nobody is told the data changed.
  if (!loops.length) return 0;
  this.store.batch(() => {
    for (const loop of loops) {
      const out = loop[0];
      const newest = moved(loop.at(-1)!);
      const fields: Partial<Item> = { parentId: null };
      // It was Only me through what it sat under, and is still sealed that way. On its own at
      // the top it says so itself: coming out of a loop never shows my person anything.
      const scope = this.store.scopeOf('item', out);
      if (scope !== 'h' && this.scopeForItem({ ...this.item(out)!, parentId: null }) === 'h') Object.assign(fields, { private: true, owner: scope.slice(2) });
      if (moved(out) < newest) this.store.amend('item', out, fields, newest);
      // A task under itself, or moves no clock tells apart: nothing to date it by, so it's a
      // write like any other (the same one from every device).
      else this.store.mutate('item', out, fields);
    }
  });
  return loops.length;
};

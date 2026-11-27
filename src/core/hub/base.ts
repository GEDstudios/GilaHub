
import { newId } from '../ids';
import { type Item, type LineColor, type List, type ListKind, type ListView, type Member, type Scope, type ShoppingFlavor, type TaskTemplate, type Visibility } from '../model';
import { byOrder, keyBetween } from '../order';
import type { Store } from '../store';
import { suggestIcon } from '../projectIcons';
import { listIdOf } from '../keys';
import { pickColor } from '../seed';

export type ItemVisibility = 'ours' | 'mine' | 'private';
export type Undo = () => void;

/** How small and how big a sticky note can be made (times its usual size). */
export const NOTE_MIN = 0.6;
export const NOTE_MAX = 1.8;

export interface NewItem {
  title: string;
  parentId?: string | null;
  notes?: string | null;
  due?: string | null;
  dueTime?: string | null;
  remind?: number | null;
  nag?: Item['nag'];
  repeat?: Item['repeat'];
  assignee?: Item['assignee'];
  urgent?: boolean;
  visibility?: ItemVisibility;
  /** For "Mine": whose it is (default: me, or the project's owner). Lets me make something my partner's. */
  owner?: string | null;
  /** For a request to the partner: they tick it, I OK it. */
  needsOk?: boolean;
  /** Insert before this sibling (default: append). */
  before?: string | null;
  /** Its tags, as picked (and remembered for these words). Left out: what the words suggest by themselves (Hub.suggestTags). */
  tags?: string[];
}

export type AddResult =
  | { kind: 'added'; id: string; listId: string }
  | { kind: 'exists'; id: string; listId: string }
  | { kind: 'revived'; id: string; listId: string };

/** What one tick wrote to the log, and what it struck out. */
export type TickLogs = { made: string[]; dropped: string[] };

/**
 * The Hub: everything we do, as writes to the store, with every privacy rule in one place. This
 * file holds the class and its core (people, folders, the tree of things); each subject adds its
 * own methods from a file next to it (privacy, requests, items, tick, twins, stock, adding, tags,
 * notes, ideas, photos, backup, migrations). Import it from `core/hub`, never from here.
 */
export class Hub {
  constructor(
    readonly store: Store,
    readonly meId: string,
  ) {}

  // ---------- people ----------

  me(): Member | undefined {
    return this.store.get('member', this.meId);
  }

  members(): Member[] {
    return [...this.store.all('member')].sort((a, b) => a.createdAt - b.createdAt);
  }

  partner(): Member | undefined {
    return this.members().find((m) => m.id !== this.meId);
  }

  member(id: string | null | undefined): Member | undefined {
    return id ? this.store.get('member', id) : undefined;
  }

  otherMember(id: string | null | undefined): string | null {
    return this.members().find((m) => m.id !== id)?.id ?? null;
  }

  upsertMember(id: string, fields: Partial<Member>): void {
    this.store.mutate('member', id, fields);
  }

  // ---------- lists ----------

  lists(): List[] {
    return [...this.store.all('list')].filter((l) => !l.archived).sort(byOrder);
  }

  /**
   * A project that's out of sight for now but may come back: archived, or made "Only me" by my
   * partner. Pins to it (bar, Today) are kept, not shown, so a restore brings them back.
   */
  listDormant(id: string): boolean {
    if (this.isLive(id)) return false;
    if (this.store.all('list').some((l) => l.id === id)) return true;
    return !!this.store.record('list', id) && !this.store.canRead(this.store.scopeOf('list', id));
  }

  list(id: string | null | undefined): List | undefined {
    return id ? this.store.get('list', id) : undefined;
  }

  /** A folder I can see and haven't archived. */
  isLive(listId: string | null | undefined): boolean {
    const l = this.list(listId);
    return !!l && !l.archived;
  }

  listScope(list: Pick<List, 'visibility' | 'owner'>): Scope {
    return list.visibility === 'private' && list.owner ? `p:${list.owner}` : 'h';
  }

  createList(input: {
    name: string;
    /** Every project is 'tasks' (older data had other kinds). */
    kind?: ListKind;
    /** Leave it out and the project gets a random color nobody is using yet. */
    color?: LineColor;
    icon?: string;
    flavor?: ShoppingFlavor;
    visibility?: Visibility;
    /** Make it inside this project. */
    parentId?: string | null;
    /** Whose a "Mine" project is (mine unless said). */
    owner?: string | null;
    /** How it's looked at: a list (unset), cards, or by tag. */
    view?: ListView;
    id?: string;
    description?: string | null;
  }): string {
    const visibility = input.visibility ?? 'shared';
    const owner = visibility === 'shared' ? null : visibility === 'visible' ? (input.owner ?? this.meId) : this.meId;
    const last = this.lists().at(-1);
    const id = input.id ?? newId();
    this.store.batch(() => {
      this.store.init('list', id, this.listScope({ visibility, owner }));
      this.store.mutate('list', id, {
        name: input.name.trim() || 'Untitled',
        kind: 'tasks',
        flavor: input.flavor,
        color: input.color ?? this.freshColor(),
        icon: input.icon ?? suggestIcon(input.name, input.flavor ? 'shopping' : 'tasks', input.flavor, last?.icon, this.iconsInUse()),
        owner,
        visibility,
        order: keyBetween(last?.order ?? null, null),
        parentId: input.parentId && this.list(input.parentId) ? input.parentId : undefined,
        ...(input.view ? { view: input.view } : {}),
        ...(input.description ? { description: input.description } : {}),
        createdAt: Date.now(),
        createdBy: this.meId,
      });
    });
    return id;
  }

  /**
   * Show another folder's tasks in this one too (or stop). One way: `from`'s tasks appear here;
   * this folder's don't appear there. Not itself, nor a folder inside this one (those show anyway).
   */
  setShows(id: string, from: string, on: boolean): Undo {
    const l = this.list(id);
    if (!l || id === from || this.nestedLists(id).some((x) => x.id === from)) return () => {};
    const was = l.shows ?? [];
    const next = on ? [...new Set([...was, from])] : was.filter((x) => x !== from);
    this.store.mutate('list', id, { shows: next });
    return () => this.store.mutate('list', id, { shows: was });
  }

  /** Change a folder's task template (merged; null clears a field). Undo puts it back. */
  setListTemplate(id: string, patch: Partial<TaskTemplate> | null): Undo {
    const l = this.list(id);
    if (!l) return () => {};
    const was = l.template ?? null;
    const next = patch === null ? null : { ...(was ?? {}), ...patch };
    this.store.mutate('list', id, { template: next });
    return () => this.store.mutate('list', id, { template: was });
  }

  /** The folders whose tasks show in this one (the ones I can see). */
  shownIn(id: string): List[] {
    return (this.list(id)?.shows ?? []).map((x) => this.list(x)).filter((x): x is List => !!x && x.id !== id);
  }

  /** My private To-Do's id: the same on all my devices, so two of them never make two. */
  personalFolderId(): string {
    return `todo${this.meId}`;
  }

  /**
   * A private space from the start: my own To-Do, Private (my person never sees it), first among
   * the folders. Made once per person; deleted, it stays gone. Returns its id when it was just
   * made (the app pins it first), else null. Call after the first sync, so a new device of mine
   * finds the one I already have.
   */
  ensurePersonalFolder(): string | null {
    const id = this.personalFolderId();
    const me = this.me();
    if (!me || me.personalFolder || this.store.record('list', id)) return null;
    const first = this.topLists()[0];
    this.store.batch(() => {
      this.createList({ id, name: 'To-Do', visibility: 'private', color: me.color === 'ink' ? 'lemon' : me.color, icon: 'i:task', description: 'My default private folder' });
      this.store.mutate('list', id, { personal: true, order: keyBetween(null, first?.order ?? null) });
      this.upsertMember(this.meId, { personalFolder: id });
    });
    return id;
  }

  /**
   * A color for a new project: one no project uses yet; once all are taken, one its neighbours
   * don't have (the last projects, and the last pins, where a new pin lands in the bar).
   */
  freshColor(rand: () => number = Math.random): LineColor {
    const lists = this.lists();
    const pinned = (this.me()?.tabs ?? []).filter((k) => listIdOf(k)).slice(-2);
    const near = [...lists.slice(-2), ...pinned.map((k) => this.list(listIdOf(k)))].flatMap((l) => (l ? [l.color] : []));
    return pickColor(
      lists.map((l) => l.color),
      rand,
      near,
    );
  }

  /** The icons projects have, for a new one to differ from. */
  iconsInUse(): Set<string> {
    return new Set(this.lists().flatMap((l) => (l.icon ? [l.icon] : [])));
  }

  // ---------- projects inside projects ----------

  /** Where a project sits: its parent if I can see it (archived or private ones let it surface). */
  parentOf(id: string): List | undefined {
    const p = this.list(id)?.parentId;
    return p ? this.lists().find((l) => l.id === p) : undefined;
  }

  /** The projects at the top of Projects. */
  topLists(): List[] {
    return this.lists().filter((l) => !this.parentOf(l.id));
  }

  /** The projects right inside this one. */
  subLists(id: string): List[] {
    return this.lists().filter((l) => l.parentId === id && this.parentOf(l.id)?.id === id);
  }

  /** Everything inside, all the way down, in reading order (a project, then what's inside it). */
  nestedLists(id: string): List[] {
    const out: List[] = [];
    const walk = (pid: string, seen: Set<string>) => {
      for (const l of this.subLists(pid)) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        out.push(l);
        walk(l.id, seen);
      }
    };
    walk(id, new Set([id]));
    return out;
  }

  /** This folder and everything inside it, all the way down (ids). */
  treeIds(id: string): string[] {
    return [id, ...this.nestedLists(id).map((l) => l.id)];
  }

  /** Is this folder `ancestorId` itself, or somewhere inside it? */
  isWithin(listId: string, ancestorId: string): boolean {
    return listId === ancestorId || this.listPath(listId).some((l) => l.id === ancestorId);
  }

  /** The way down from the top to here: [grandparent, parent]. */
  listPath(id: string): List[] {
    const out: List[] = [];
    const seen = new Set([id]);
    for (let p = this.parentOf(id); p && !seen.has(p.id); p = this.parentOf(p.id)) {
      seen.add(p.id);
      out.unshift(p);
    }
    return out;
  }

  /** Put a project inside another (null: back to the top). Never inside itself or its own insides. */
  setListParent(id: string, parentId: string | null): boolean {
    if (parentId && (parentId === id || this.nestedLists(id).some((l) => l.id === parentId) || !this.list(parentId))) return false;
    const last = this.lists().filter((l) => l.id !== id).at(-1);
    this.store.mutate('list', id, { parentId: parentId ?? null, order: keyBetween(last?.order ?? null, null) });
    return true;
  }

  updateList(id: string, fields: Partial<Pick<List, 'name' | 'color' | 'icon' | 'kind' | 'flavor' | 'archived' | 'description'>>): void {
    this.store.mutate('list', id, fields);
  }

  /** Change who can see a list, and whose it is (Mine can be my partner's). Its items follow (re-sealed under the right key). */
  setListVisibility(id: string, visibility: Visibility, owner?: string | null): void {
    const list = this.list(id);
    if (!list) return;
    // Someone's Private folder stays theirs. One of my person's that we both see can be made
    // Private: it becomes mine, hidden from them (their tasks in it too).
    if (visibility === 'private' && list.owner && list.owner !== this.meId && list.visibility === 'private') return;
    const who = visibility === 'shared' ? null : visibility === 'private' ? this.meId : (owner ?? list.owner ?? this.meId);
    this.store.batch(() => {
      this.store.mutate('list', id, { visibility, owner: who });
      this.store.setScope('list', id, this.listScope({ visibility, owner: who }));
      this.rescopePhotos(`list:${id}`);
      for (const it of this.store.all('item')) if (it.listId === id && !it.parentId) this.rescope(it.id);
    });
  }

  /** Reorder among its neighbours (the projects in the same place). */
  moveList(id: string, beforeId: string | null): void {
    const p = this.parentOf(id)?.id;
    const lists = (p ? this.subLists(p) : this.topLists()).filter((l) => l.id !== id);
    const idx = beforeId ? lists.findIndex((l) => l.id === beforeId) : lists.length;
    const prev = lists[idx - 1]?.order ?? null;
    const next = lists[idx]?.order ?? null;
    this.store.mutate('list', id, { order: keyBetween(prev, next) });
  }

  deleteList(id: string): Undo {
    const items = this.store.all('item').filter((i) => i.listId === id);
    this.store.batch(() => {
      this.store.mutate('list', id, { deleted: true });
      for (const it of items) this.store.mutate('item', it.id, { deleted: true });
    });
    return () =>
      this.store.batch(() => {
        this.store.mutate('list', id, { deleted: false });
        for (const it of items) this.store.mutate('item', it.id, { deleted: false });
      });
  }

  // ---------- items: reading helpers ----------

  item(id: string | null | undefined): Item | undefined {
    return id ? this.store.get('item', id) : undefined;
  }

  children(listId: string, parentId: string | null): Item[] {
    return this.store
      .all('item')
      .filter((i) => i.listId === listId && (i.parentId ?? null) === parentId)
      .sort(byOrder);
  }

  childrenOf(parentId: string): Item[] {
    return this.store
      .all('item')
      .filter((i) => i.parentId === parentId)
      .sort(byOrder);
  }

  /**
   * Everything under a task, all the way down. Each thing once, and never the task itself: two
   * devices can nest two tasks under each other at the same moment (see `mendTree`), and until
   * that's mended the walk must still end.
   */
  descendants(id: string): Item[] {
    const out: Item[] = [];
    const seen = new Set([id]);
    const walk = (pid: string) => {
      for (const c of this.childrenOf(pid)) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
        walk(c.id);
      }
    };
    walk(id);
    return out;
  }

  /** Is this item somewhere under `ancestorId` (a task, at any depth)? */
  isUnder(id: string, ancestorId: string): boolean {
    return this.descendants(ancestorId).some((d) => d.id === id);
  }

  /** What sits alongside, in order: a task's subtasks, or a folder's top-level tasks. */
  siblings(listId: string, parentId: string | null): Item[] {
    return parentId ? this.childrenOf(parentId) : this.children(listId, null);
  }

  /** The way down from the top to here: [grandparent, parent]. Each once, never the task itself. */
  ancestors(item: Item): Item[] {
    const out: Item[] = [];
    const seen = new Set([item.id]);
    for (let cur = this.item(item.parentId); cur && !seen.has(cur.id); cur = this.item(cur.parentId)) {
      seen.add(cur.id);
      out.unshift(cur);
    }
    return out;
  }

  // ---------- the household's settings ----------

  settings() {
    return this.store.get('settings', 'house');
  }
}

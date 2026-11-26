import { atLocal, diffDays, today as todayStr, type DateStr } from './dates';
import { newId } from './ids';
import { LINE_COLORS, type AisleConf, type Idea, type Item, type Moment, type Note, type LineColor, type List, type ListKind, type LogEntry, type Member, type Scope, type ShoppingFlavor, type Visibility } from './model';
import { byOrder, keyBetween } from './order';
import type { Store } from './store';
import { categorize, categoryMeta, categoryOrder, routeFlavor, type Flavor } from '../smart/categorize';
import { fold, itemKey, parseQuantity } from '../smart/normalize';
import { suggestIcon } from './projectIcons';
import { firstDue, isFlexible, nextDue, shiftForAway, skipDue } from '../smart/recurrence';

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
  qty?: string | null;
  visibility?: ItemVisibility;
  /** For "Mine": whose it is (default: me, or the project's owner). Lets me make something my partner's. */
  owner?: string | null;
  /** For a request to the partner: they tick it, I OK it. */
  needsOk?: boolean;
  /** Insert before this sibling (default: append). */
  before?: string | null;
}

export type ShoppingAddResult =
  | { kind: 'added'; id: string; listId: string }
  | { kind: 'exists'; id: string; listId: string }
  | { kind: 'revived'; id: string; listId: string };

/**
 * Domain API: user intents → store writes. Keeps every privacy rule in one place.
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
    if (this.lists().some((l) => l.id === id)) return false;
    if (this.store.all('list').some((l) => l.id === id)) return true;
    return !!this.store.record('list', id) && !this.store.canRead(this.store.scopeOf('list', id));
  }

  list(id: string | null | undefined): List | undefined {
    return id ? this.store.get('list', id) : undefined;
  }

  listScope(list: Pick<List, 'visibility' | 'owner'>): Scope {
    return list.visibility === 'private' && list.owner ? `p:${list.owner}` : 'h';
  }

  createList(input: {
    name: string;
    kind: ListKind;
    /** Leave it out and the project gets a random color nobody is using yet. */
    color?: LineColor;
    icon?: string;
    flavor?: ShoppingFlavor;
    visibility?: Visibility;
    /** Make it inside this project. */
    parentId?: string | null;
    /** Whose a "Mine" project is (mine unless said). */
    owner?: string | null;
    id?: string;
  }): string {
    const visibility = input.visibility ?? 'shared';
    const owner = visibility === 'shared' ? null : visibility === 'visible' ? (input.owner ?? this.meId) : this.meId;
    const last = this.lists().at(-1);
    const id = input.id ?? newId();
    this.store.batch(() => {
      this.store.init('list', id, this.listScope({ visibility, owner }));
      this.store.mutate('list', id, {
        name: input.name.trim() || 'Untitled',
        kind: input.kind,
        flavor: input.kind === 'shopping' ? (input.flavor ?? 'grocery') : undefined,
        color: input.color ?? this.freshColor(),
        icon: input.icon ?? suggestIcon(input.name, input.kind, input.flavor, last?.icon, this.iconsInUse()),
        owner,
        visibility,
        order: keyBetween(last?.order ?? null, null),
        parentId: input.parentId && this.list(input.parentId) ? input.parentId : undefined,
        createdAt: Date.now(),
        createdBy: this.meId,
      });
    });
    return id;
  }

  /**
   * A color for a new project: one no project uses yet; once all are taken, one its neighbours
   * don't have (the last projects, and the last pins, where a new pin lands in the bar).
   */
  freshColor(rand: () => number = Math.random): LineColor {
    const lists = this.lists();
    const pinned = (this.me()?.tabs ?? []).filter((k) => k.startsWith('l:')).slice(-2);
    const near = [...lists.slice(-2), ...pinned.map((k) => this.list(k.slice(2)))].flatMap((l) => (l ? [l.color] : []));
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

  /**
   * Projects from before they came with icons get one (once per device): a template's, else
   * one from the name. Every phone works it out the same way, over the projects both of us
   * see, so both write the same icon.
   */
  fillIcons(): void {
    this.store.batch(() => {
      const taken = new Set<string>();
      for (const l of this.lists()) {
        let icon = l.icon;
        if (!icon) {
          icon = PROJECT_TEMPLATES.find((x) => x.name === l.name && x.kind === l.kind)?.icon ?? suggestIcon(l.name, l.kind, l.flavor, undefined, taken);
          this.store.mutate('list', l.id, { icon });
        }
        if (l.visibility !== 'private') taken.add(icon);
      }
    });
  }

  /** One-time rename of the old default "Housework" project to "Chores" (a renamed one is left alone). */
  renameOldDefaults(): void {
    for (const l of this.store.all('list')) {
      if (!l.deleted && l.kind === 'chores' && l.name === 'Housework' && this.store.get('list', l.id)) this.updateList(l.id, { name: 'Chores' });
    }
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

  updateList(id: string, fields: Partial<Pick<List, 'name' | 'color' | 'icon' | 'kind' | 'flavor' | 'archived'>>): void {
    this.store.mutate('list', id, fields);
  }

  /** Change who can see a list, and whose it is (Mine can be my partner's). Its items follow (re-sealed under the right key). */
  setListVisibility(id: string, visibility: Visibility, owner?: string | null): void {
    const list = this.list(id);
    if (!list) return;
    // Only Only me is kept to its owner: hiding is never done to someone else.
    if (visibility === 'private' && list.owner && list.owner !== this.meId) return;
    const who = visibility === 'shared' ? null : visibility === 'private' ? this.meId : (owner ?? list.owner ?? this.meId);
    this.store.batch(() => {
      this.store.mutate('list', id, { visibility, owner: who });
      this.store.setScope('list', id, this.listScope({ visibility, owner: who }));
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

  descendants(id: string): Item[] {
    const out: Item[] = [];
    const walk = (pid: string) => {
      for (const c of this.childrenOf(pid)) {
        out.push(c);
        walk(c.id);
      }
    };
    walk(id);
    return out;
  }

  ancestors(item: Item): Item[] {
    const out: Item[] = [];
    let cur = this.item(item.parentId);
    let guard = 0;
    while (cur && guard++ < 1000) {
      out.unshift(cur);
      cur = this.item(cur.parentId);
    }
    return out;
  }

  visibilityOf(item: Item): ItemVisibility {
    const list = this.list(item.listId);
    if (list?.visibility === 'private') return 'private';
    if (item.private || this.ancestors(item).some((a) => a.private)) return 'private';
    // In someone's "Mine" project, a thing can still be for both of us: no owner.
    if (list?.visibility === 'visible') return item.owner === null ? 'ours' : 'mine';
    return item.owner ? 'mine' : 'ours';
  }

  /** Whose is it? (for "Mine" items and private ones) */
  ownerOf(item: Item): string | null {
    const list = this.list(item.listId);
    if (item.owner) return item.owner;
    if (list?.visibility === 'private') return list.owner;
    if (list?.visibility === 'visible') return item.owner === null ? null : list.owner;
    return null;
  }

  /**
   * "Mine" belongs to one of us, but both can see it and help with it.
   * Only "Only me" things are closed — and the partner never receives those.
   */
  canEdit(item: Item): boolean {
    const owner = this.ownerOf(item);
    return !owner || owner === this.meId || this.visibilityOf(item) !== 'private';
  }

  /**
   * Who can see it: anyone's call while we both see it (so a thing I handed to my partner can
   * come back); an "Only me" thing is its owner's alone.
   */
  canSetPrivacy(item: Item): boolean {
    const owner = this.ownerOf(item);
    return !owner || owner === this.meId || item.createdBy === this.meId || this.visibilityOf(item) !== 'private';
  }

  /** Is assigning this a request to my partner? */
  isRequest(assignee: Item['assignee'] | undefined): boolean {
    return !!assignee && assignee !== 'both' && assignee !== 'turns' && assignee !== this.meId;
  }

  /** Change who does it. Giving it to my partner makes it a request from me. */
  assign(id: string, assignee: Item['assignee'], opts: { needsOk?: boolean } = {}): void {
    const item = this.item(id);
    if (!item) return;
    const request = this.isRequest(assignee);
    const same = item.assignee === assignee;
    this.store.mutate('item', id, {
      assignee: assignee ?? null,
      turn: assignee === 'turns' ? (item.turn ?? this.meId) : null,
      requestedBy: request ? (item.assignee === assignee && item.requestedBy ? item.requestedBy : this.meId) : null,
      needsOk: request ? (opts.needsOk ?? item.needsOk ?? false) : false,
      submittedAt: request ? (item.submittedAt ?? null) : null,
      submittedBy: request ? (item.submittedBy ?? null) : null,
      // A "Not yet" belongs to the ask it answered.
      ...(same ? {} : { sentBackAt: null, sentBackBy: null }),
    });
  }

  /** Waiting for the asker's OK? */
  isAwaitingOk(item: Item): boolean {
    return !!item.submittedAt && !item.done;
  }

  /** The asker approves: it's done, credited to whoever did it. */
  confirm(id: string): Undo {
    const item = this.item(id);
    if (!item?.submittedAt) return () => {};
    const prev: Partial<Item> = {
      done: item.done,
      doneAt: item.doneAt ?? null,
      doneBy: item.doneBy ?? null,
      submittedAt: item.submittedAt,
      submittedBy: item.submittedBy ?? null,
      sentBackAt: item.sentBackAt ?? null,
      sentBackBy: item.sentBackBy ?? null,
    };
    this.store.mutate('item', id, { done: true, doneAt: item.submittedAt, doneBy: item.submittedBy ?? null, submittedAt: null, submittedBy: null, sentBackAt: null, sentBackBy: null });
    return () => this.store.mutate('item', id, prev);
  }

  /** "Not yet": back to the doer's list, saying so (they see "{asker} said not yet"). */
  sendBack(id: string): Undo {
    const item = this.item(id);
    if (!item?.submittedAt) return () => {};
    const prev: Partial<Item> = { submittedAt: item.submittedAt, submittedBy: item.submittedBy ?? null, sentBackAt: item.sentBackAt ?? null, sentBackBy: item.sentBackBy ?? null };
    // Only the asker's "Not yet" says so; the doer taking it back just un-ticks.
    const said = item.requestedBy === this.meId ? { sentBackAt: Date.now(), sentBackBy: this.meId } : {};
    this.store.mutate('item', id, { submittedAt: null, submittedBy: null, ...said });
    return () => this.store.mutate('item', id, prev);
  }

  canTick(item: Item): boolean {
    return this.canEdit(item) || this.list(item.listId)?.kind === 'shopping';
  }

  private scopeForItem(item: Item): Scope {
    const list = this.list(item.listId);
    if (list?.visibility === 'private' && list.owner) return `p:${list.owner}`;
    let node: Item | undefined = item;
    let guard = 0;
    while (node && guard++ < 1000) {
      if (node.private) return `p:${node.owner ?? node.createdBy}`;
      node = this.item(node.parentId);
    }
    return 'h';
  }

  /** Re-seal an item, its descendants and their logs under the scope their privacy implies. */
  rescope(id: string): void {
    const root = this.item(id);
    if (!root) return;
    const all = [root, ...this.descendants(id)];
    this.store.batch(() => {
      for (const it of all) {
        const scope = this.scopeForItem(this.item(it.id) ?? it);
        this.store.setScope('item', it.id, scope);
        for (const log of this.store.all('log')) if (log.itemId === it.id) this.store.setScope('log', log.id, scope);
      }
    });
  }

  // ---------- items: writing ----------

  addItem(listId: string, input: NewItem): string {
    const list = this.list(listId);
    const parentId = input.parentId ?? null;
    const siblings = parentId ? this.childrenOf(parentId) : this.children(listId, null);
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
      nag: input.remind != null && !input.repeat ? (input.nag ?? null) : null,
      repeat: input.repeat ?? null,
      assignee: input.assignee ?? null,
      turn: input.assignee === 'turns' ? this.meId : null,
      urgent: input.urgent ?? false,
      urgentBy: input.urgent ? this.meId : null,
      qty: input.qty ?? null,
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
    });
    return id;
  }

  updateItem(id: string, fields: Partial<Item>): Undo {
    const before = this.item(id);
    if (fields.urgent && !before?.urgent) fields = { ...fields, urgentBy: this.meId };
    // Renamed: its twin in a task project follows (a shopping twin keeps its shopping name).
    const twin = this.linked(before);
    if (twin && fields.title && this.list(twin.listId)?.kind !== 'shopping' && this.list(before!.listId)?.kind !== 'shopping') this.store.mutate('item', twin.id, { title: fields.title });
    const prev: Record<string, unknown> = {};
    if (before) for (const k of Object.keys(fields)) prev[k] = (before as unknown as Record<string, unknown>)[k] ?? null;
    this.store.mutate('item', id, fields);
    return () => this.store.mutate('item', id, prev as Partial<Item>);
  }

  setItemVisibility(id: string, vis: ItemVisibility, owner?: string): void {
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
  }

  /** Take an unowned shared task: "I'll take it". */
  takeIt(id: string): void {
    this.store.mutate('item', id, { assignee: this.meId });
  }

  /**
   * What a tick on it does. Repeating things roll forward. A request that needs an OK: the
   * doer's tick asks for it (and a second tick takes that back); the asker's tick gives it.
   */
  tickKind(item: Item): 'undone' | 'roll' | 'submit' | 'take-back' | 'confirm' | 'done' {
    if (item.done) return 'undone';
    if (item.repeat) return 'roll';
    if (item.needsOk && item.requestedBy) {
      if (item.requestedBy !== this.meId) return item.submittedAt ? 'take-back' : 'submit';
      if (item.submittedAt) return 'confirm';
    }
    return 'done';
  }

  /** Tick / untick, as tickKind says. */
  // ---------- one thing, two places ----------

  /** The other place this thing lives, if it's linked (and that one still points back). */
  linked(item: Item | undefined): Item | undefined {
    const other = item?.linkId ? this.item(item.linkId) : undefined;
    return other && other.linkId === item!.id && !other.deleted ? other : undefined;
  }

  /**
   * Put this thing in another project as well. On a shopping list it goes in as the thing to
   * buy ("Buy a doorknob" → "doorknob"); elsewhere as itself. Returns the new (or found) id.
   */
  alsoIn(id: string, listId: string, parentId: string | null = null): string | null {
    const item = this.item(id);
    const list = this.list(listId);
    if (!item || !list || this.linked(item)) return null;
    // Not inside itself, nor next to itself in the same spot.
    if (parentId && (parentId === id || this.descendants(id).some((d) => d.id === parentId))) return null;
    if (!parentId && list.id === item.listId && !item.parentId) return null;
    return this.store.batch(() => {
      const other =
        list.kind === 'shopping' && !parentId ? this.addShopping(listId, toBuy(item.title)).id : this.addItem(listId, { title: item.title, parentId });
      this.store.mutate('item', other, { linkId: id });
      this.store.mutate('item', id, { linkId: other });
      return other;
    });
  }

  /** "Buy a doorknob": a subtask that's shopping lands on the right shopping list too. */
  linkIfShopping(id: string): string | null {
    const item = this.item(id);
    if (!item || !buyWords(item.title) || this.list(item.listId)?.kind === 'shopping') return null;
    const dest = this.routeShopping(toBuy(item.title));
    return dest ? this.alsoIn(id, dest.id) : null;
  }

  unlink(id: string): void {
    const item = this.item(id);
    const other = this.linked(item);
    this.store.batch(() => {
      if (item) this.store.mutate('item', id, { linkId: null });
      if (other) this.store.mutate('item', other.id, { linkId: null });
    });
  }

  toggle(id: string, opts: { withChildren?: boolean } = {}): Undo {
    const item = this.item(id);
    if (!item) return () => {};
    const kind = this.tickKind(item);
    if (kind === 'roll') return this.completeRepeating(id);
    if (kind === 'confirm') return this.confirm(id);
    if (kind === 'take-back') return this.sendBack(id);
    if (kind === 'submit') {
      const back = { sentBackAt: item.sentBackAt ?? null, sentBackBy: item.sentBackBy ?? null };
      this.store.mutate('item', id, { submittedAt: Date.now(), submittedBy: this.meId, sentBackAt: null, sentBackBy: null });
      return () => this.store.mutate('item', id, { submittedAt: null, submittedBy: null, ...back });
    }
    const list = this.list(item.listId);
    const done = !item.done;
    const now = Date.now();
    const touched: Array<[string, Partial<Item>]> = [];
    this.store.batch(() => {
      const fields: Partial<Item> = { done, doneAt: done ? now : null, doneBy: done ? this.meId : null };
      if (list?.kind === 'shopping') {
        if (done) {
          const logId = newId();
          this.writeLog(item, { id: logId, kind: 'bought', key: itemKey(item.title), name: item.title, listId: item.listId, at: now });
          fields.logId = logId;
        } else if (item.logId) {
          this.store.mutate('log', item.logId, { deleted: true });
          fields.logId = null;
        }
      }
      touched.push([id, { done: item.done, doneAt: item.doneAt ?? null, doneBy: item.doneBy ?? null, logId: item.logId ?? null }]);
      this.store.mutate('item', id, fields);
      // The same thing elsewhere goes with it (bought on Shopping = done on the chore, and back).
      const twin = this.linked(item);
      if (twin && !twin.repeat && twin.done !== done) {
        const tf: Partial<Item> = { done, doneAt: done ? now : null, doneBy: done ? this.meId : null };
        if (this.list(twin.listId)?.kind === 'shopping') {
          if (done) {
            const logId = newId();
            this.writeLog(twin, { id: logId, kind: 'bought', key: itemKey(twin.title), name: twin.title, listId: twin.listId, at: now });
            tf.logId = logId;
          } else if (twin.logId) {
            this.store.mutate('log', twin.logId, { deleted: true });
            tf.logId = null;
          }
        }
        touched.push([twin.id, { done: twin.done, doneAt: twin.doneAt ?? null, doneBy: twin.doneBy ?? null, logId: twin.logId ?? null, archived: twin.archived ?? false }]);
        this.store.mutate('item', twin.id, tf);
      }
      if (done && opts.withChildren) {
        for (const c of this.descendants(id)) {
          if (c.done) continue;
          touched.push([c.id, { done: false, doneAt: null, doneBy: null }]);
          this.store.mutate('item', c.id, { done: true, doneAt: now, doneBy: this.meId });
        }
      }
    });
    return () =>
      this.store.batch(() => {
        const cur = this.item(id);
        if (cur?.logId && list?.kind === 'shopping') this.store.mutate('log', cur.logId, { deleted: true });
        for (const [tid, prev] of touched) this.store.mutate('item', tid, prev);
      });
  }

  /** Done for a repeating item/chore, on any day (early, late, yesterday…). */
  completeRepeating(id: string, onDate: DateStr = todayStr()): Undo {
    const item = this.item(id);
    if (!item?.repeat) return () => {};
    const prev: Partial<Item> = { due: item.due ?? null, lastDoneAt: item.lastDoneAt ?? null, lastDoneBy: item.lastDoneBy ?? null, turn: item.turn ?? null };
    const logId = newId();
    const nowTime = new Date();
    const at = atLocal(onDate, `${String(nowTime.getHours()).padStart(2, '0')}:${String(nowTime.getMinutes()).padStart(2, '0')}`);
    this.store.batch(() => {
      this.writeLog(item, { id: logId, kind: 'done', at });
      this.store.mutate('item', id, {
        due: nextDue(item.repeat!, item.due, onDate),
        lastDoneAt: at,
        lastDoneBy: this.meId,
        turn: item.assignee === 'turns' ? this.otherMember(this.meId) : (item.turn ?? null),
      });
    });
    return () =>
      this.store.batch(() => {
        this.store.mutate('log', logId, { deleted: true });
        this.store.mutate('item', id, prev);
      });
  }

  snooze(id: string, to: DateStr): Undo {
    return this.updateItem(id, { due: to });
  }

  /** Skip this one, and any others already missed: the next one is today or later. */
  skip(id: string): Undo {
    const item = this.item(id);
    if (!item?.repeat) return () => {};
    const ref = todayStr();
    let due = skipDue(item.repeat, item.due, ref);
    for (let guard = 0; due < ref && guard < 400; guard++) due = skipDue(item.repeat, due, ref);
    return this.updateItem(id, { due });
  }

  setPaused(id: string, paused: boolean): Undo {
    const item = this.item(id);
    const fields: Partial<Item> = { paused };
    if (!paused && item?.repeat && item.due && item.due < todayStr()) {
      fields.due = isFlexible(item.repeat) ? todayStr() : shiftForAway(item.repeat, item.due, 0);
    }
    return this.updateItem(id, fields);
  }

  move(id: string, to: { listId?: string; parentId?: string | null; before?: string | null }): void {
    const item = this.item(id);
    if (!item) return;
    const listId = to.listId ?? item.listId;
    const parentId = to.parentId === undefined ? (to.listId && to.listId !== item.listId ? null : (item.parentId ?? null)) : to.parentId;
    if (parentId === id || (parentId && this.descendants(id).some((d) => d.id === parentId))) return;
    const siblings = (parentId ? this.childrenOf(parentId) : this.children(listId, null)).filter((s) => s.id !== id);
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
  }

  /** Reorder among siblings by placing between two neighbours. */
  reorder(id: string, prevId: string | null, nextId: string | null): void {
    const prev = this.item(prevId)?.order ?? null;
    const next = this.item(nextId)?.order ?? null;
    this.store.mutate('item', id, { order: keyBetween(prev, next) });
  }

  /**
   * Reorder within a run of rows that aren't one list's siblings (a shopping aisle mixing two
   * lists): `seq` is the run as it now reads, with `id` dropped in its place. Each list numbers
   * its own keys, so neighbours can tie; then the rows from the drop down get fresh keys until
   * the keys climb again, so the run sorts exactly as dropped. Usually that's just `id`.
   */
  reorderIn(seq: readonly string[], id: string): void {
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
  }

  delete(id: string): Undo {
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
  }

  /** Take it out of the other place only (that copy goes; this one stays, on its own). */
  removeTwin(id: string): Undo {
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
  }

  duplicate(id: string): string | null {
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
        qty: src.qty,
        visibility: this.visibilityOf(src),
      });
      for (const c of this.childrenOf(src.id)) copy(c, nid);
      return nid;
    };
    return this.store.batch(() => copy(item, item.parentId ?? null));
  }

  /** Reusable checklists (packing): untick everything in a list. */
  uncheckAll(listId: string): Undo {
    const done = this.store.all('item').filter((i) => i.listId === listId && i.done);
    this.store.batch(() => {
      for (const i of done) this.store.mutate('item', i.id, { done: false, doneAt: null, doneBy: null });
    });
    return () =>
      this.store.batch(() => {
        for (const i of done) this.store.mutate('item', i.id, { done: true, doneAt: i.doneAt ?? Date.now(), doneBy: i.doneBy ?? this.meId });
      });
  }

  // ---------- shopping ----------

  shoppingLists(): List[] {
    return this.lists().filter((l) => l.kind === 'shopping');
  }

  flavorOf(list: List | undefined): Flavor {
    return (list?.flavor ?? 'grocery') as Flavor;
  }

  /** Learned category lookup: private memory first, then shared. */
  learned = (key: string): { category: string; emoji?: string } | undefined =>
    this.store.get('memory', `p:${this.meId}:${key}`) ?? this.store.get('memory', key);

  categoryFor(item: Item): { category: string; emoji: string } {
    const flavor = this.flavorOf(this.list(item.listId));
    const auto = categorize(item.title, flavor, this.learned);
    const category = item.category ?? auto.category;
    // A category we took away hands what it held to Other.
    if (this.hiddenAisles(flavor).has(category)) return { category: 'other', emoji: categoryMeta(flavor, 'other').e };
    return { category, emoji: auto.emoji };
  }

  /** Pick the destination list when adding from the combined view. */
  routeShopping(name: string, among: List[] = this.shoppingLists()): List | undefined {
    const flavor = routeFlavor(name);
    return among.find((l) => this.flavorOf(l) === flavor) ?? among[0];
  }

  findOnList(listIds: string[], name: string): Item | undefined {
    const key = itemKey(name);
    const ids = new Set(listIds);
    let best: Item | undefined;
    for (const it of this.store.all('item')) {
      if (!ids.has(it.listId) || itemKey(it.title) !== key) continue;
      if (!best || (!it.archived && best.archived) || (!it.done && best.done)) best = it;
    }
    return best;
  }

  /**
   * Add to a shopping list without ever creating a duplicate:
   * already open → report it; crossed off / archived → bring it back.
   */
  addShopping(
    listId: string,
    raw: string,
    extra: { urgent?: boolean; visibility?: ItemVisibility; qty?: string | null; owner?: string | null } = {},
  ): ShoppingAddResult {
    const { name, qty } = extra.qty !== undefined ? { name: raw.trim(), qty: extra.qty } : parseQuantity(raw);
    const existing = this.findOnList([listId], name);
    if (existing && !existing.done && !existing.archived) {
      if (qty || extra.urgent) this.updateItem(existing.id, { qty: qty ?? existing.qty, urgent: extra.urgent || existing.urgent });
      return { kind: 'exists', id: existing.id, listId };
    }
    if (existing && this.canEdit(existing)) {
      this.store.mutate('item', existing.id, {
        done: false,
        doneAt: null,
        doneBy: null,
        archived: false,
        logId: null,
        qty: qty ?? null,
        urgent: extra.urgent ?? false,
        urgentBy: extra.urgent ? this.meId : null,
        addedBy: this.meId,
        addedAt: Date.now(),
        order: keyBetween(this.children(listId, null).at(-1)?.order ?? null, null),
      });
      return { kind: 'revived', id: existing.id, listId };
    }
    const id = this.addItem(listId, { title: name, qty, urgent: extra.urgent, visibility: extra.visibility, owner: extra.owner });
    return { kind: 'added', id, listId };
  }

  /** "+1": bump a quantity. */
  bump(id: string): void {
    const item = this.item(id);
    if (!item) return;
    const n = item.qty && /^\d+$/.test(item.qty) ? +item.qty : 1;
    this.updateItem(id, { qty: String(n + 1) });
  }

  /** Move to another aisle — and remember it for next time (for both of us). */
  setCategory(id: string, category: string): void {
    const item = this.item(id);
    if (!item) return;
    const flavor = this.flavorOf(this.list(item.listId));
    const key = `${flavor}:${itemKey(item.title)}`;
    const isPrivate = this.visibilityOf(item) === 'private';
    this.store.batch(() => {
      this.store.mutate('item', id, { category });
      const memId = isPrivate ? `p:${this.meId}:${key}` : key;
      if (isPrivate) this.store.init('memory', memId, `p:${this.meId}`);
      this.store.mutate('memory', memId, { category });
    });
  }

  /** Finish a trip: file everything in the cart into history. */
  finishTrip(listIds: string[]): Undo {
    const ids = new Set(listIds);
    const inCart = this.store.all('item').filter((i) => ids.has(i.listId) && i.done && !i.archived);
    this.store.batch(() => {
      for (const i of inCart) this.store.mutate('item', i.id, { archived: true });
    });
    return () =>
      this.store.batch(() => {
        for (const i of inCart) this.store.mutate('item', i.id, { archived: false });
      });
  }

  /** Housekeeping: carts left unfinished for 12h are filed automatically. */
  autoArchive(now = Date.now()): void {
    const stale = this.store
      .all('item')
      .filter((i) => i.done && !i.archived && i.doneAt && now - i.doneAt > 12 * 3600_000 && this.list(i.listId)?.kind === 'shopping');
    if (!stale.length) return;
    this.store.batch(() => {
      for (const i of stale) this.store.mutate('item', i.id, { archived: true });
    });
  }

  // ---------- chores ----------

  settings() {
    return this.store.get('settings', 'house');
  }

  // ---------- aisles (shopping categories, ours to name and order) ----------

  private aisleConf(flavor: Flavor): AisleConf[] {
    const s = this.settings();
    const raw = flavor === 'grocery' ? s?.groceryAisles : s?.homeAisles;
    return Array.isArray(raw) ? raw.filter((a) => a && typeof a.id === 'string') : [];
  }

  /** The aisles in our walking order: ours as arranged, then any built-in ones not placed yet (not the ones we took away). */
  aisleOrder(flavor: Flavor): string[] {
    const all = this.aisleConf(flavor);
    const seen = new Set(all.map((a) => a.id));
    return [...all.filter((a) => !a.hidden).map((a) => a.id), ...categoryOrder(flavor).filter((c) => !seen.has(c))];
  }

  /** Built-in categories we took away. */
  hiddenAisles(flavor: Flavor): Set<string> {
    return new Set(this.aisleConf(flavor).flatMap((a) => (a.hidden ? [a.id] : [])));
  }

  /** An aisle's name and emoji: ours if we renamed it or made it, else the built-in one. */
  aisleMeta(flavor: Flavor, category: string): { name: string; emoji: string; icon?: string; custom: boolean } {
    const mine = this.aisleConf(flavor).find((a) => a.id === category);
    const builtIn = !category.startsWith('c:');
    const meta = categoryMeta(flavor, builtIn ? category : 'other');
    return { name: mine?.name || (builtIn ? meta.en : 'Category'), emoji: mine?.emoji || (builtIn ? meta.e : '🏷️'), icon: mine?.icon, custom: !builtIn };
  }

  /** Our icon for a category: "i:<glyph>" or an emoji. */
  setAisleIcon(flavor: Flavor, id: string, icon: string): void {
    const byId = new Map(this.aisleConf(flavor).map((a) => [a.id, a]));
    this.saveAisles(
      flavor,
      this.aisleOrder(flavor).map((x) => (x === id ? { ...(byId.get(x) ?? { id: x }), icon } : (byId.get(x) ?? { id: x }))),
    );
  }

  /** Save the walk; built-ins we took away stay away (unless `exact`, for Undo). */
  private saveAisles(flavor: Flavor, conf: AisleConf[], exact = false): void {
    const ids = new Set(conf.map((a) => a.id));
    const keep = exact ? [] : this.aisleConf(flavor).filter((a) => a.hidden && !ids.has(a.id));
    const all = [...conf, ...keep];
    this.store.mutate('settings', 'house', flavor === 'grocery' ? { groceryAisles: all } : { homeAisles: all });
  }

  /** Our whole order (ids as they now read), keeping names. */
  arrangeAisles(flavor: Flavor, ids: string[]): void {
    const byId = new Map(this.aisleConf(flavor).map((a) => [a.id, a]));
    this.saveAisles(
      flavor,
      ids.map((id) => byId.get(id) ?? { id }),
    );
  }

  renameAisle(flavor: Flavor, id: string, name: string): void {
    const order = this.aisleOrder(flavor);
    const byId = new Map(this.aisleConf(flavor).map((a) => [a.id, a]));
    const t = name.trim();
    this.saveAisles(
      flavor,
      order.map((x) => {
        const a = { ...(byId.get(x) ?? { id: x }) };
        if (x === id) a.name = t || undefined;
        return a;
      }),
    );
  }

  /** A new aisle of our own, at the end of the walk. Returns its id. */
  addAisle(flavor: Flavor, name: string, icon?: string): string | null {
    const t = name.trim();
    if (!t) return null;
    const id = `c:${newId(10)}`;
    const byId = new Map(this.aisleConf(flavor).map((a) => [a.id, a]));
    this.saveAisles(flavor, [...this.aisleOrder(flavor).map((x) => byId.get(x) ?? { id: x }), { id, name: t, ...(icon ? { icon } : {}) }]);
    return id;
  }

  /**
   * Take a category away: one of our own goes; a built-in one is put out of the walk. What it
   * held goes back to being sorted by itself (into Other, for a built-in). Other always stays.
   * Returns the way back.
   */
  removeAisle(flavor: Flavor, id: string): () => void {
    if (id === 'other') return () => undefined;
    const conf = this.aisleConf(flavor);
    const items = this.store.all('item').filter((i) => i.category === id);
    const memories = this.store.all('memory').filter((m) => m.category === id);
    this.store.batch(() => {
      for (const i of items) this.store.mutate('item', i.id, { category: null });
      for (const m of memories) this.store.mutate('memory', m.id, { category: 'other' });
      const rest = conf.filter((a) => a.id !== id);
      if (id.startsWith('c:')) this.saveAisles(flavor, rest, true);
      else {
        // Keep the walk as it was, with this one marked away.
        const order = this.aisleOrder(flavor);
        const byId = new Map(conf.map((a) => [a.id, a]));
        this.saveAisles(flavor, [...order.filter((x) => x !== id).map((x) => byId.get(x) ?? { id: x }), { ...(byId.get(id) ?? { id }), hidden: true }]);
      }
    });
    return () =>
      this.store.batch(() => {
        this.saveAisles(flavor, conf, true);
        for (const i of items) this.store.mutate('item', i.id, { category: id });
        for (const m of memories) this.store.mutate('memory', m.id, { category: id });
      });
  }

  /** Away mode is gone: one left on (from before) ends, its chore clocks caught up. */
  endAwayMode(): void {
    if (this.isAway()) this.setAway(false);
  }

  isAway(): boolean {
    return !!this.settings()?.awaySince;
  }

  /** Away mode: freeze every chore clock; on return, shift flexible chores and collapse fixed ones. */
  setAway(on: boolean): void {
    const since = this.settings()?.awaySince;
    this.store.batch(() => {
      if (on) {
        this.store.mutate('settings', 'house', { awaySince: todayStr(), awayBy: this.meId });
        return;
      }
      if (since) {
        const days = Math.max(0, diffDays(since, todayStr()));
        for (const it of this.store.all('item')) {
          if (!it.repeat || it.paused || !it.due) continue;
          const shifted = shiftForAway(it.repeat, it.due, days);
          if (shifted && shifted !== it.due) this.store.mutate('item', it.id, { due: shifted });
        }
      }
      this.store.mutate('settings', 'house', { awaySince: null, awayBy: null });
    });
  }

  thank(logId: string): void {
    this.store.mutate('log', logId, { thankedBy: this.meId, thankedAt: Date.now() });
  }

  // ---------- moments (things worth looking back on) ----------

  moments(): Moment[] {
    return this.store
      .all('moment')
      .filter((m) => !m.deleted)
      .sort((a, b) => b.day.localeCompare(a.day) || b.createdAt - a.createdAt);
  }

  addMoment(text: string, feel: string, day: string = todayStr()): string | null {
    const t = text.trim();
    if (!t && !feel) return null;
    return this.store.create('moment', { text: t, feel, day, by: this.meId, createdAt: Date.now() });
  }

  deleteMoment(id: string): Undo {
    if (!this.store.get('moment', id)) return () => {};
    this.store.mutate('moment', id, { deleted: true });
    return () => this.store.mutate('moment', id, { deleted: false });
  }

  // ---------- sticky notes (left on a screen for each other) ----------

  /** The notes still stuck on a screen, newest on top. */
  notesOn(place: string): Note[] {
    return this.store
      .all('note')
      .filter((n) => !n.deleted && !n.peeledAt && n.place === place)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Notes for me, still stuck, wherever they are. */
  notesForMe(): Note[] {
    return this.store
      .all('note')
      .filter((n) => !n.deleted && !n.peeledAt && n.to === this.meId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  addNote(place: string, text: string, color: LineColor): string | null {
    const t = text.trim();
    if (!t) return null;
    return this.store.create('note', { text: t, by: this.meId, to: this.partner()?.id ?? null, place, color, createdAt: Date.now() });
  }

  /** Move or turn a note on its screen (both of us see it there). */
  placeNote(id: string, at: { x: number; y: number; rot: number; scale?: number }): void {
    if (!this.store.get('note', id)) return;
    const scale = at.scale === undefined ? undefined : Math.round(Math.min(NOTE_MAX, Math.max(NOTE_MIN, at.scale)) * 100) / 100;
    this.store.mutate('note', id, { x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y), rot: Math.round(at.rot * 10) / 10, ...(scale === undefined ? {} : { scale }) });
  }

  /** The notes we've read and ticked off, kept together (Projects), newest first. */
  collectedNotes(): Note[] {
    return this.store
      .all('note')
      .filter((n) => !n.deleted && n.peeledAt)
      .sort((a, b) => (b.peeledAt ?? 0) - (a.peeledAt ?? 0));
  }

  /** Throw a note away for good (from the collection). */
  deleteNote(id: string): Undo {
    if (!this.store.get('note', id)) return () => {};
    this.store.mutate('note', id, { deleted: true });
    return () => this.store.mutate('note', id, { deleted: false });
  }

  /** Tick it: read, peeled off, kept with the collected notes (either of us). Returns the way back. Taking one down for good is deleteNote. */
  peelNote(id: string): Undo {
    const n = this.store.get('note', id);
    if (!n) return () => {};
    // Either of us ticks it: it's read, and joins the collection.
    this.store.mutate('note', id, { peeledAt: Date.now() });
    return () => this.store.mutate('note', id, { peeledAt: null });
  }

  // ---------- ideas (for Gila Hub itself) ----------

  idea(id: string | null | undefined): Idea | undefined {
    return id ? this.store.get('idea', id) : undefined;
  }

  /** A new idea, on top. Household scope, so both of us can edit, resolve and reorder it. */
  addIdea(text: string): string | null {
    const t = text.trim();
    if (!t) return null;
    const orders = this.store
      .all('idea')
      .map((i) => i.order)
      .filter((o): o is number => typeof o === 'number');
    const fields: Partial<Idea> = { text: t, by: this.meId, createdAt: Date.now() };
    // Once they've been arranged, a new one still goes on top.
    if (orders.length) fields.order = Math.min(...orders) - 1;
    return this.store.create('idea', fields);
  }

  /** An idea's picture, once all its parts are here (null while syncing, or none). */
  ideaShot(id: string): string | null {
    const idea = this.idea(id);
    if (!idea?.shotN || !idea.shotV) return null;
    let out = '';
    for (let i = 0; i < idea.shotN; i++) {
      const part = idea[`shot${i}`];
      if (typeof part !== 'string' || !part.startsWith(`${idea.shotV}:`)) return null;
      out += part.slice(idea.shotV.length + 1);
    }
    return out;
  }

  /** Attach (or, null, take off) an idea's picture: the parts first, each its own op, then the count. */
  setIdeaShot(id: string, dataUrl: string | null): void {
    const idea = this.idea(id);
    if (!idea) return;
    if (!dataUrl) {
      this.store.mutate('idea', id, { shotN: null, shotV: null });
      return;
    }
    const v = newId(6);
    const SIZE = 28_000;
    const n = Math.ceil(dataUrl.length / SIZE);
    this.store.batch(() => {
      for (let i = 0; i < n; i++) this.store.mutate('idea', id, { [`shot${i}`]: `${v}:${dataUrl.slice(i * SIZE, (i + 1) * SIZE)}` });
      this.store.mutate('idea', id, { shotN: n, shotV: v });
    });
  }

  editIdea(id: string, text: string): void {
    const idea = this.idea(id);
    const t = text.trim();
    if (!idea || !t || t === idea.text) return;
    this.store.mutate('idea', id, { text: t, editedBy: this.meId, editedAt: Date.now() });
  }

  resolveIdea(id: string): void {
    if (this.idea(id)) this.store.mutate('idea', id, { resolvedAt: Date.now(), resolvedBy: this.meId });
  }

  reopenIdea(id: string): void {
    if (this.idea(id)) this.store.mutate('idea', id, { resolvedAt: null, resolvedBy: null, reopenedAt: Date.now(), reopenedBy: this.meId });
  }

  deleteIdea(id: string): Undo {
    if (!this.idea(id)) return () => {};
    this.store.mutate('idea', id, { deleted: true });
    return () => this.store.mutate('idea', id, { deleted: false });
  }

  /** The open ideas in their new order: each gets its place (only the ones that moved are written). */
  reorderIdeas(ids: string[]): void {
    this.store.batch(() => {
      ids.forEach((id, order) => {
        const idea = this.idea(id);
        if (idea && idea.order !== order) this.store.mutate('idea', id, { order });
      });
    });
  }

  // ---------- logs ----------

  private writeLog(item: Item, entry: Partial<LogEntry> & { id: string; kind: LogEntry['kind']; at: number }): void {
    const scope = this.scopeForItem(item);
    this.store.batch(() => {
      this.store.init('log', entry.id, scope);
      this.store.mutate('log', entry.id, { ...entry, itemId: item.id, by: this.meId });
    });
  }

  logsFor(itemId: string): LogEntry[] {
    return this.store
      .all('log')
      .filter((l) => l.itemId === itemId)
      .sort((a, b) => b.at - a.at);
  }

  // ---------- backup import ----------

  /**
   * Whose backup is this, for one that doesn't say (`me` came with newer backups)? Nobody's to
   * map when it has me in it already. Otherwise: whoever its private things belong to (only
   * their phone could read those), else its one person this household doesn't know.
   * Null when it can't tell (backupStrangers then says whom to ask about).
   */
  backupOwner(data: BackupData): string | null {
    const members = data.member ?? [];
    if (members.some((m) => m.id === this.meId)) return null;
    const owners = new Set<string>();
    for (const l of data.list ?? []) if (l.visibility === 'private' && typeof l.owner === 'string') owners.add(l.owner);
    for (const i of data.item ?? []) if (i.private) owners.add(String(i.owner ?? i.createdBy));
    for (const m of data.memory ?? []) if (m.id.startsWith('p:')) owners.add(m.id.split(':')[1]);
    if (owners.size === 1) return [...owners][0];
    const strangers = this.backupStrangers(data);
    return strangers.length === 1 ? strangers[0].id : null;
  }

  /** The backup's people this household doesn't know (one of them may be me, on a new phone). */
  backupStrangers(data: BackupData): Array<{ id: string; name: string }> {
    const known = new Set(this.members().map((m) => m.id));
    return (data.member ?? []).filter((m) => !known.has(m.id)).map((m) => ({ id: m.id, name: String(m.name ?? '') }));
  }

  /**
   * Import a JSON backup without overwriting anything, sealing every entity in the
   * scope its privacy implies (an "Only me" item must never be re-shared by an import).
   *
   * A restore never adds people: pairing does. The backup's own person (`opts.me`, or
   * backupOwner) becomes me in every person field, so my private things land under my key.
   * Other people the household doesn't know are left out. A project this household already
   * has (same kind and name) takes the backup's items instead of coming in a second time.
   * Things an earlier restore sealed under that old person's key (unreadable here) are
   * sealed again under mine, so restoring again repairs them.
   */
  importBackup(data: BackupData, opts: { me?: string } = {}): number {
    let n = 0;
    const members = data.member ?? [];
    const from = opts.me ?? this.backupOwner(data) ?? undefined;
    const who = (v: unknown) => (from && v === from ? this.meId : v);
    const lists = new Map<string, string>();
    for (const l of data.list ?? []) {
      const twin = this.store.all('list').find((x) => x.id !== l.id && !x.deleted && x.kind === l.kind && fold(x.name) === fold(String(l.name ?? '')));
      if (twin && !this.store.record('list', l.id)) lists.set(l.id, twin.id);
    }
    const listOf = (v: unknown) => (typeof v === 'string' ? (lists.get(v) ?? v) : v);
    const keyOf = (k: unknown) => (typeof k === 'string' && k.startsWith('l:') ? `l:${listOf(k.slice(2))}` : k);
    /** Person fields, and list references, through the maps. */
    const fix = (row: { id: string } & Record<string, unknown>) => {
      const out: { id: string } & Record<string, unknown> = { ...row };
      for (const k of PERSON_FIELDS) if (k in out) out[k] = who(out[k]);
      if ('listId' in out) out.listId = listOf(out.listId);
      return out;
    };
    const put = (t: 'list' | 'item' | 'log' | 'memory' | 'store' | 'settings' | 'member' | 'idea' | 'moment', row: { id: string } & Record<string, unknown>, scope: Scope) => {
      if (!row?.id) return;
      const stranded = !!from && from !== this.meId && this.store.scopeOf(t, row.id) === `p:${from}`;
      if (this.store.record(t, row.id) && !stranded) return;
      const { id, ...fields } = row;
      this.store.init(t, id, scope);
      this.store.mutate(t, id, fields as never);
      n++;
    };
    this.store.batch(() => {
      for (const m of members) {
        const id = who(m.id);
        // Only my own record, and only when this device has none yet.
        if (id !== this.meId) continue;
        const mine = { ...m, id: this.meId } as Record<string, unknown> & { id: string };
        if (Array.isArray(mine.tabs)) mine.tabs = mine.tabs.map(keyOf);
        if (Array.isArray(mine.home)) mine.home = (mine.home as Array<{ key: unknown }>).map((h) => ({ ...h, key: keyOf(h?.key) }));
        put('member', mine, 'h');
      }
      for (const raw of data.list ?? []) {
        if (lists.has(raw.id)) continue;
        const l = fix(raw);
        const vis = (l.visibility as Visibility) ?? 'shared';
        put('list', l, vis === 'private' ? `p:${(l.owner as string) ?? this.meId}` : 'h');
      }
      // Parents before children so inherited privacy resolves.
      const items = [...(data.item ?? [])].map(fix).sort((x, y) => Number(!!x.parentId) - Number(!!y.parentId));
      for (const it of items) put('item', it, this.scopeForItem({ ...(it as unknown as Item) }));
      for (const raw of data.log ?? []) {
        const l = fix(raw);
        const item = this.item(l.itemId as string);
        put('log', l, item ? this.store.scopeOf('item', item.id) : 'h');
      }
      for (const m of data.memory ?? []) put('memory', m, m.id.startsWith('p:') ? `p:${this.meId}` : 'h');
      for (const st of data.store ?? []) put('store', st, 'h');
      for (const st of data.settings ?? []) put('settings', fix(st), 'h');
      for (const idea of data.idea ?? []) put('idea', fix(idea), 'h');
      for (const m of data.moment ?? []) put('moment', fix(m), 'h');
    });
    return n;
  }

  // ---------- search ----------

  search(query: string, limit = 40): Item[] {
    const q = fold(query);
    if (!q) return [];
    const lists = new Set(this.lists().map((l) => l.id));
    const hits: Array<{ it: Item; rank: number }> = [];
    for (const it of this.store.all('item')) {
      if (!lists.has(it.listId) || it.archived) continue;
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
  }
}

/** A backup's tables, as JSON rows. */
export type BackupData = Partial<Record<string, Array<{ id: string } & Record<string, unknown>>>>;

/** Fields that name a person (a member id), across every table a backup holds. */
const PERSON_FIELDS = [
  'by',
  'createdBy',
  'owner',
  'assignee',
  'turn',
  'requestedBy',
  'submittedBy',
  'sentBackBy',
  'doneBy',
  'lastDoneBy',
  'urgentBy',
  'addedBy',
  'thankedBy',
  'resolvedBy',
  'reopenedBy',
  'editedBy',
  'awayBy',
] as const;

export interface ProjectTemplate {
  key: string;
  name: string;
  icon: string;
  kind: ListKind;
  flavor?: ShoppingFlavor;
  visibility?: Visibility;
  blurb: string;
}

/** Starting points offered at onboarding and in "New project". Nothing is created unless picked. */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  { key: 'groceries', name: 'Groceries', icon: 'i:cart', kind: 'shopping', flavor: 'grocery', blurb: 'Sorted by aisle, for both of you' },
  { key: 'home', name: 'Home shopping', icon: 'i:bag', kind: 'shopping', flavor: 'home', blurb: 'Bulbs, towels, a new pan' },
  // Not "Chores": that's the tab that gathers every chores project.
  { key: 'chores', name: 'Chores', icon: 'i:broom', kind: 'chores', blurb: 'Things that repeat, shared fairly' },
  { key: 'todo', name: 'To do', icon: 'i:lines', kind: 'tasks', blurb: 'Everything else, with dates and steps' },
  { key: 'trip', name: 'Next trip', icon: 'i:suitcase', kind: 'tasks', blurb: 'Plans and packing' },
  { key: 'gifts', name: 'Gift ideas', icon: 'i:gift', kind: 'tasks', visibility: 'private', blurb: 'Only you can see it' },
];

export function createFromTemplate(hub: Hub, t: ProjectTemplate, color?: LineColor): string {
  return hub.createList({ name: t.name, kind: t.kind, flavor: t.flavor, color, icon: t.icon, visibility: t.visibility ?? 'shared' });
}

/** A random color from the palette, preferring ones no project uses yet, then ones not in `avoid`. */
export function pickColor(used: LineColor[], rand: () => number = Math.random, avoid: LineColor[] = []): LineColor {
  const free = LINE_COLORS.filter((c) => !used.includes(c));
  const apart = LINE_COLORS.filter((c) => !avoid.includes(c));
  const pool = free.length ? free : apart.length ? apart : LINE_COLORS;
  return pool[Math.floor(rand() * pool.length)];
}

/** Distinct random colors for several new projects at once. */
export function pickColors(keys: string[], used: LineColor[] = [], rand: () => number = Math.random): Record<string, LineColor> {
  const out: Record<string, LineColor> = {};
  const taken = [...used];
  for (const k of keys) {
    out[k] = pickColor(taken, rand);
    taken.push(out[k]);
  }
  return out;
}

/** A brand-new household: only the projects the person picked. */
export function seedHousehold(hub: Hub, templateKeys: string[], colors: Record<string, LineColor> = {}): void {
  hub.store.batch(() => {
    for (const key of templateKeys) {
      const t = PROJECT_TEMPLATES.find((x) => x.key === key);
      if (t) createFromTemplate(hub, t, colors[key]);
    }
  });
}

/** Words that mean "this is shopping": buy/get/order/pick up, or Hebrew לקנות/קנה. */
const BUY = /^(?:buy|get|order|pick up|grab|לקנות|קנה|קני|להזמין)\s+(.+)$/i;
export function buyWords(title: string): boolean {
  return BUY.test(title.trim());
}
/** "Buy a new doorknob" → "new doorknob": what goes on the shopping list. */
export function toBuy(title: string): string {
  const m = title.trim().match(BUY);
  return (m ? m[1] : title).replace(/^(?:a|an|the|some)\s+/i, '').trim();
}

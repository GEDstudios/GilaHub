import { atLocal, diffDays, today as todayStr, type DateStr } from './dates';
import { newId } from './ids';
import { LINE_COLORS, type Idea, type Item, type LineColor, type List, type ListKind, type LogEntry, type Member, type Scope, type ShoppingFlavor, type Visibility } from './model';
import { byOrder, keyBetween } from './order';
import type { Store } from './store';
import { categorize, routeFlavor, type Flavor } from '../smart/categorize';
import { fold, itemKey, parseQuantity } from '../smart/normalize';
import { suggestIcon } from './projectIcons';
import { firstDue, isFlexible, nextDue, shiftForAway, skipDue } from '../smart/recurrence';

export type ItemVisibility = 'ours' | 'mine' | 'private';
export type Undo = () => void;

export interface NewItem {
  title: string;
  parentId?: string | null;
  notes?: string | null;
  due?: string | null;
  dueTime?: string | null;
  remind?: number | null;
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
    id?: string;
  }): string {
    const visibility = input.visibility ?? 'shared';
    const owner = visibility === 'shared' ? null : this.meId;
    const last = this.lists().at(-1);
    const id = input.id ?? newId();
    this.store.batch(() => {
      this.store.init('list', id, this.listScope({ visibility, owner }));
      this.store.mutate('list', id, {
        name: input.name.trim() || 'Untitled',
        kind: input.kind,
        flavor: input.kind === 'shopping' ? (input.flavor ?? 'grocery') : undefined,
        color: input.color ?? this.freshColor(),
        icon: input.icon ?? suggestIcon(input.name, input.kind, input.flavor, last?.icon),
        owner,
        visibility,
        order: keyBetween(last?.order ?? null, null),
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

  /** Projects started from a template before they came with icons get the template's icon (once per device). */
  fillTemplateIcons(): void {
    this.store.batch(() => {
      for (const l of this.lists()) {
        const t = !l.icon && PROJECT_TEMPLATES.find((x) => x.name === l.name && x.kind === l.kind);
        if (t && t.icon) this.store.mutate('list', l.id, { icon: t.icon });
      }
    });
  }

  updateList(id: string, fields: Partial<Pick<List, 'name' | 'color' | 'icon' | 'kind' | 'flavor' | 'archived'>>): void {
    this.store.mutate('list', id, fields);
  }

  /** Change who can see a list. Its items follow (re-sealed under the right key). */
  setListVisibility(id: string, visibility: Visibility): void {
    const list = this.list(id);
    if (!list) return;
    const owner = visibility === 'shared' ? null : (list.owner ?? this.meId);
    this.store.batch(() => {
      this.store.mutate('list', id, { visibility, owner });
      this.store.setScope('list', id, this.listScope({ visibility, owner }));
      for (const it of this.store.all('item')) if (it.listId === id && !it.parentId) this.rescope(it.id);
    });
  }

  moveList(id: string, beforeId: string | null): void {
    const lists = this.lists().filter((l) => l.id !== id);
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

  /** Who can see it is the owner's call (or anyone's, for shared things) — and whoever made it. */
  canSetPrivacy(item: Item): boolean {
    const owner = this.ownerOf(item);
    return !owner || owner === this.meId || item.createdBy === this.meId;
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

  /** Tick / untick. Repeating items roll forward instead of finishing. */
  toggle(id: string, opts: { withChildren?: boolean } = {}): Undo {
    const item = this.item(id);
    if (!item) return () => {};
    if (item.repeat && !item.done) return this.completeRepeating(id);
    // Requests that need an OK: the doer's tick asks for it; the asker's tick gives it.
    if (!item.done && item.needsOk && item.requestedBy) {
      if (item.requestedBy === this.meId) {
        if (item.submittedAt) return this.confirm(id);
      } else if (item.submittedAt) {
        return this.sendBack(id);
      } else {
        const back = { sentBackAt: item.sentBackAt ?? null, sentBackBy: item.sentBackBy ?? null };
        this.store.mutate('item', id, { submittedAt: Date.now(), submittedBy: this.meId, sentBackAt: null, sentBackBy: null });
        return () => this.store.mutate('item', id, { submittedAt: null, submittedBy: null, ...back });
      }
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

  skip(id: string): Undo {
    const item = this.item(id);
    if (!item?.repeat) return () => {};
    return this.updateItem(id, { due: skipDue(item.repeat, item.due) });
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

  delete(id: string): Undo {
    const ids = [id, ...this.descendants(id).map((d) => d.id)];
    this.store.batch(() => {
      for (const i of ids) this.store.mutate('item', i, { deleted: true });
    });
    return () =>
      this.store.batch(() => {
        for (const i of ids) this.store.mutate('item', i, { deleted: false });
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
    return { category: item.category ?? auto.category, emoji: auto.emoji };
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
    if (this.idea(id)) this.store.mutate('idea', id, { resolvedAt: null, resolvedBy: null });
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
   * Import a JSON backup without overwriting anything, sealing every entity in the
   * scope its privacy implies (an "Only me" item must never be re-shared by an import).
   *
   * A restore never adds people: pairing does. The backup's own person (`me`, recorded by
   * newer backups; for older ones, its only member when this household is just me) becomes me
   * in every person field, so my private things land under my key. Other people the household
   * doesn't know are left out. A project this household already has (same kind and name)
   * takes the backup's items instead of coming in a second time.
   */
  importBackup(data: Partial<Record<string, Array<{ id: string } & Record<string, unknown>>>>, opts: { me?: string } = {}): number {
    let n = 0;
    const members = data.member ?? [];
    const known = new Set(this.members().map((m) => m.id));
    let from = opts.me;
    if (!from && !members.some((m) => m.id === this.meId)) {
      const strangers = members.filter((m) => !known.has(m.id));
      if (strangers.length === 1 && [...known].every((id) => id === this.meId)) from = strangers[0].id;
    }
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
    const put = (t: 'list' | 'item' | 'log' | 'memory' | 'store' | 'settings' | 'member' | 'idea', row: { id: string } & Record<string, unknown>, scope: Scope) => {
      if (!row?.id || this.store.record(t, row.id)) return;
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
  'thankedBy',
  'resolvedBy',
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

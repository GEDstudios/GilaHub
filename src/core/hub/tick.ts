import { atLocal, today as todayStr, type DateStr } from '../dates';
import { newId } from '../ids';
import type { Item, LogEntry } from '../model';
import { itemKey } from '../../smart/normalize';
import { isFlexible, nextDue, shiftForAway, skipDue } from '../../smart/recurrence';
import { Hub, type TickLogs, type Undo } from './base';

/** Ticking: done and undone (and what it writes down), repeating things rolling on, snooze, skip, pause, clearing the done. */

declare module './base' {
  interface Hub {
    toggle(id: string, opts?: { withChildren?: boolean }): Undo;

    /**
     * The fields a tick (or untick) sets on one item. A one-off top-level task ticked is remembered
     * (Again?): its words, where, when; unticked, that memory is struck out. `logs` collects both,
     * so an undo can put them back.
     * @internal
     */
    tickFields(item: Item, done: boolean, now: number, logs: TickLogs): Partial<Item>;

    /** Done for a repeating item/chore, on any day (early, late, yesterday…). */
    completeRepeating(id: string, onDate?: DateStr): Undo;

    snooze(id: string, to: DateStr): Undo;

    /** Skip this one, and any others already missed: the next one is today or later. */
    skip(id: string): Undo;

    setPaused(id: string, paused: boolean): Undo;

    /** Clear: what was done here (or just these) is filed away (Again? remembers it). */
    clearDone(listIds: string[], only?: string[]): Undo;

    /** Housekeeping: a tray left for 12h is cleared by itself. */
    autoArchive(now?: number): void;

    thank(logId: string): void;

/** @internal */
    writeLog(item: Item, entry: Partial<LogEntry> & { id: string; kind: LogEntry['kind']; at: number }): void;

    logsFor(itemId: string): LogEntry[];
  }
}

Hub.prototype.toggle = function (this: Hub, id: string, opts: { withChildren?: boolean } = {}): Undo {
  const item = this.item(id);
  // Something we count the stock of is never "done": it stays, counted (it's never cleared away).
  if (!item || item.stock != null) return () => {};
  const kind = this.tickKind(item);
  if (kind === 'roll') return this.completeRepeating(id);
  if (kind === 'confirm') return this.confirm(id);
  if (kind === 'take-back') return this.sendBack(id);
  if (kind === 'submit') {
    const back = { sentBackAt: item.sentBackAt ?? null, sentBackBy: item.sentBackBy ?? null };
    this.store.mutate('item', id, { submittedAt: Date.now(), submittedBy: this.meId, sentBackAt: null, sentBackBy: null });
    return () => this.store.mutate('item', id, { submittedAt: null, submittedBy: null, ...back });
  }
  const done = !item.done;
  const now = Date.now();
  const touched: Array<[string, Partial<Item>]> = [];
  const logs: TickLogs = { made: [], dropped: [] };
  this.store.batch(() => {
    const fields = this.tickFields(item, done, now, logs);
    touched.push([id, { done: item.done, doneAt: item.doneAt ?? null, doneBy: item.doneBy ?? null, logId: item.logId ?? null }]);
    this.store.mutate('item', id, fields);
    // The same thing elsewhere goes with it (bought on Shopping = done on the chore, and back).
    const twin = this.linked(item);
    if (twin && !twin.repeat && twin.done !== done) {
      const tf = this.tickFields(twin, done, now, logs);
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
      // What the tick wrote down (for it and its twin) is taken back, and what it struck out returns.
      for (const l of logs.made) this.store.mutate('log', l, { deleted: true });
      for (const l of logs.dropped) this.store.mutate('log', l, { deleted: false });
      for (const [tid, prev] of touched) this.store.mutate('item', tid, prev);
    });
};

Hub.prototype.tickFields = function (this: Hub, item: Item, done: boolean, now: number, logs: TickLogs): Partial<Item> {
  const fields: Partial<Item> = { done, doneAt: done ? now : null, doneBy: done ? this.meId : null };
  if (item.parentId || item.repeat) return fields;
  if (done) {
    const logId = newId();
    this.writeLog(item, { id: logId, kind: 'bought', key: itemKey(item.title), name: item.title, listId: item.listId, at: now });
    logs.made.push(logId);
    fields.logId = logId;
  } else if (item.logId) {
    this.store.mutate('log', item.logId, { deleted: true });
    logs.dropped.push(item.logId);
    fields.logId = null;
  }
  return fields;
};

Hub.prototype.completeRepeating = function (this: Hub, id: string, onDate: DateStr = todayStr()): Undo {
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
};

Hub.prototype.snooze = function (this: Hub, id: string, to: DateStr): Undo {
  return this.updateItem(id, { due: to });
};

Hub.prototype.skip = function (this: Hub, id: string): Undo {
  const item = this.item(id);
  if (!item?.repeat) return () => {};
  const ref = todayStr();
  let due = skipDue(item.repeat, item.due, ref);
  for (let guard = 0; due < ref && guard < 400; guard++) due = skipDue(item.repeat, due, ref);
  return this.updateItem(id, { due });
};

Hub.prototype.setPaused = function (this: Hub, id: string, paused: boolean): Undo {
  const item = this.item(id);
  const fields: Partial<Item> = { paused };
  if (!paused && item?.repeat && item.due && item.due < todayStr()) {
    fields.due = isFlexible(item.repeat) ? todayStr() : shiftForAway(item.repeat, item.due, 0);
  }
  return this.updateItem(id, fields);
};

Hub.prototype.clearDone = function (this: Hub, listIds: string[], only?: string[]): Undo {
  const ids = new Set(listIds);
  const pick = only ? new Set(only) : null;
  const done = this.store.all('item').filter((i) => ids.has(i.listId) && i.done && !i.archived && !i.parentId && (!pick || pick.has(i.id)));
  this.store.batch(() => {
    for (const i of done) this.store.mutate('item', i.id, { archived: true });
  });
  return () =>
    this.store.batch(() => {
      for (const i of done) this.store.mutate('item', i.id, { archived: false });
    });
};

Hub.prototype.autoArchive = function (this: Hub, now = Date.now()): void {
  const stale = this.store.all('item').filter((i) => i.done && !i.archived && !i.parentId && i.doneAt && now - i.doneAt > 12 * 3600_000);
  if (!stale.length) return;
  this.store.batch(() => {
    for (const i of stale) this.store.mutate('item', i.id, { archived: true });
  });
};

Hub.prototype.thank = function (this: Hub, logId: string): void {
  this.store.mutate('log', logId, { thankedBy: this.meId, thankedAt: Date.now() });
};

Hub.prototype.writeLog = function (this: Hub, item: Item, entry: Partial<LogEntry> & { id: string; kind: LogEntry['kind']; at: number }): void {
  const scope = this.scopeForItem(item);
  this.store.batch(() => {
    this.store.init('log', entry.id, scope);
    this.store.mutate('log', entry.id, { ...entry, itemId: item.id, by: this.meId });
  });
};

Hub.prototype.logsFor = function (this: Hub, itemId: string): LogEntry[] {
  return this.store
    .all('log')
    .filter((l) => l.itemId === itemId)
    .sort((a, b) => b.at - a.at);
};

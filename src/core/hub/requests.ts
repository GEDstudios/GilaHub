
import { type Item } from '../model';
import { Hub, type Undo } from './base';

/** Asking my person: requests, taking one over, "I did it" and the OK. */

declare module './base' {
  interface Hub {
    /** Is assigning this a request to my partner? */
    isRequest(assignee: Item['assignee'] | undefined): boolean;

    /** Change who does it. Giving it to my partner makes it a request from me. */
    assign(id: string, assignee: Item['assignee'], opts?: { needsOk?: boolean }): void;

    /** The asker approves: it's done, credited to whoever did it. */
    confirm(id: string): Undo;

    /** "Not yet": back to the doer's list, saying so (they see "{asker} said not yet"). */
    sendBack(id: string): Undo;

    /**
     * What a tick on it does. Repeating things roll forward. A request that needs an OK: the
     * doer's tick asks for it (and a second tick takes that back); the asker's tick gives it.
     */
    tickKind(item: Item): 'undone' | 'roll' | 'submit' | 'take-back' | 'confirm' | 'done';
  }
}

Hub.prototype.isRequest = function (this: Hub, assignee: Item['assignee'] | undefined): boolean {
  return !!assignee && assignee !== 'both' && assignee !== 'turns' && assignee !== this.meId;
};

Hub.prototype.assign = function (this: Hub, id: string, assignee: Item['assignee'], opts: { needsOk?: boolean } = {}): void {
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
};

Hub.prototype.confirm = function (this: Hub, id: string): Undo {
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
};

Hub.prototype.sendBack = function (this: Hub, id: string): Undo {
  const item = this.item(id);
  if (!item?.submittedAt) return () => {};
  const prev: Partial<Item> = { submittedAt: item.submittedAt, submittedBy: item.submittedBy ?? null, sentBackAt: item.sentBackAt ?? null, sentBackBy: item.sentBackBy ?? null };
  // Only the asker's "Not yet" says so; the doer taking it back just un-ticks.
  const said = item.requestedBy === this.meId ? { sentBackAt: Date.now(), sentBackBy: this.meId } : {};
  this.store.mutate('item', id, { submittedAt: null, submittedBy: null, ...said });
  return () => this.store.mutate('item', id, prev);
};

Hub.prototype.tickKind = function (this: Hub, item: Item): 'undone' | 'roll' | 'submit' | 'take-back' | 'confirm' | 'done' {
  if (item.done) return 'undone';
  if (item.repeat) return 'roll';
  if (item.needsOk && item.requestedBy) {
    if (item.requestedBy !== this.meId) return item.submittedAt ? 'take-back' : 'submit';
    if (item.submittedAt) return 'confirm';
  }
  return 'done';
};

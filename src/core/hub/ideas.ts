
import type { Idea } from '../model';
import { Hub, type Undo } from './base';

/** Ideas for Gila Hub itself. */

declare module './base' {
  interface Hub {
idea(id: string | null | undefined): Idea | undefined;

    /** A new idea, on top. Household scope, so both of us can edit, resolve and reorder it. */
    addIdea(text: string): string | null;

    ideaShot(id: string): string | null;

    setIdeaShot(id: string, dataUrl: string | null): void;

    editIdea(id: string, text: string): void;

    resolveIdea(id: string): void;

    reopenIdea(id: string): void;

    deleteIdea(id: string): Undo;

    /** The open ideas in their new order: each gets its place (only the ones that moved are written). */
    reorderIdeas(ids: string[]): void;
  }
}

Hub.prototype.idea = function (this: Hub, id: string | null | undefined): Idea | undefined {
  return id ? this.store.get('idea', id) : undefined;
};

Hub.prototype.addIdea = function (this: Hub, text: string): string | null {
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
};

Hub.prototype.ideaShot = function (this: Hub, id: string): string | null {
  return this.shotOf('idea', id);
};

Hub.prototype.setIdeaShot = function (this: Hub, id: string, dataUrl: string | null): void {
  this.setShot('idea', id, dataUrl);
};

Hub.prototype.editIdea = function (this: Hub, id: string, text: string): void {
  const idea = this.idea(id);
  const t = text.trim();
  if (!idea || !t || t === idea.text) return;
  this.store.mutate('idea', id, { text: t, editedBy: this.meId, editedAt: Date.now() });
};

Hub.prototype.resolveIdea = function (this: Hub, id: string): void {
  if (this.idea(id)) this.store.mutate('idea', id, { resolvedAt: Date.now(), resolvedBy: this.meId });
};

Hub.prototype.reopenIdea = function (this: Hub, id: string): void {
  if (this.idea(id)) this.store.mutate('idea', id, { resolvedAt: null, resolvedBy: null, reopenedAt: Date.now(), reopenedBy: this.meId });
};

Hub.prototype.deleteIdea = function (this: Hub, id: string): Undo {
  if (!this.idea(id)) return () => {};
  this.store.mutate('idea', id, { deleted: true });
  return () => this.store.mutate('idea', id, { deleted: false });
};

Hub.prototype.reorderIdeas = function (this: Hub, ids: string[]): void {
  this.store.batch(() => {
    ids.forEach((id, order) => {
      const idea = this.idea(id);
      if (idea && idea.order !== order) this.store.mutate('idea', id, { order });
    });
  });
};

import { today as todayStr } from '../dates';
import { type LineColor, type Moment, type Note } from '../model';
import { Hub, type Undo, NOTE_MAX, NOTE_MIN } from './base';

/** Sticky notes left for each other, and moments worth looking back on. */

declare module './base' {
  interface Hub {
moments(): Moment[];

    addMoment(text: string, feel: string, day?: string): string | null;

    deleteMoment(id: string): Undo;

    /** The notes still stuck on a screen, newest on top. */
    notesOn(place: string): Note[];

    /** Notes for me, still stuck, wherever they are. */
    notesForMe(): Note[];

    addNote(place: string, text: string, color: LineColor): string | null;

    /** Change my own note: its words, paper, how its photo sits, what's drawn on it (only the one who left it). */
    editNote(id: string, fields: { text?: string; color?: LineColor; photoShape?: string; photoBorder?: string; photoAt?: string; photoPos?: string; ink?: string | null; textSize?: number | null }): void;

    /** Move or turn a note on its screen (both of us see it there). */
    placeNote(id: string, at: { x: number; y: number; rot: number; scale?: number }): void;

    /** The notes we've read and ticked off, kept together (Projects), newest first. */
    collectedNotes(): Note[];

    /** Throw a note away for good (from the collection). */
    deleteNote(id: string): Undo;

    /** Tick it: read, peeled off, kept with the collected notes (either of us). Returns the way back. Taking one down for good is deleteNote. */
    peelNote(id: string): Undo;

    /** Bring a kept note back from the collection: it's on its screen again, where it was. */
    unpeelNote(id: string): Undo;
  }
}

Hub.prototype.moments = function (this: Hub): Moment[] {
  return this.store
    .all('moment')
    .filter((m) => !m.deleted)
    .sort((a, b) => b.day.localeCompare(a.day) || b.createdAt - a.createdAt);
};

Hub.prototype.addMoment = function (this: Hub, text: string, feel: string, day: string = todayStr()): string | null {
  const t = text.trim();
  if (!t && !feel) return null;
  return this.store.create('moment', { text: t, feel, day, by: this.meId, createdAt: Date.now() });
};

Hub.prototype.deleteMoment = function (this: Hub, id: string): Undo {
  if (!this.store.get('moment', id)) return () => {};
  this.store.mutate('moment', id, { deleted: true });
  return () => this.store.mutate('moment', id, { deleted: false });
};

Hub.prototype.notesOn = function (this: Hub, place: string): Note[] {
  // The old Shopping screen ("shop") is the Shopping project's page.
  const root = this.shopRoot();
  const same = (p: string) => (p === 'shop' && root ? `list:${root.id}` : p);
  return this.store
    .all('note')
    .filter((n) => !n.deleted && !n.peeledAt && same(n.place) === same(place))
    .sort((a, b) => b.createdAt - a.createdAt);
};

Hub.prototype.notesForMe = function (this: Hub): Note[] {
  return this.store
    .all('note')
    .filter((n) => !n.deleted && !n.peeledAt && n.to === this.meId)
    .sort((a, b) => b.createdAt - a.createdAt);
};

Hub.prototype.addNote = function (this: Hub, place: string, text: string, color: LineColor): string | null {
  const t = text.trim();
  if (!t) return null;
  return this.store.create('note', { text: t, by: this.meId, to: this.partner()?.id ?? null, place, color, createdAt: Date.now() });
};

Hub.prototype.editNote = function (this: Hub, id: string, fields: { text?: string; color?: LineColor; photoShape?: string; photoBorder?: string; photoAt?: string; photoPos?: string; ink?: string | null; textSize?: number | null }): void {
  const n = this.store.get('note', id);
  if (!n || n.by !== this.meId) return;
  const patch: Partial<Note> = {};
  if (fields.text !== undefined && fields.text.trim() && fields.text.trim() !== n.text) patch.text = fields.text.trim();
  if (fields.color && fields.color !== n.color) patch.color = fields.color;
  for (const k of ['photoShape', 'photoBorder', 'photoAt', 'photoPos', 'ink', 'textSize'] as const) if (fields[k] !== undefined && fields[k] !== n[k]) (patch as Record<string, unknown>)[k] = fields[k];
  if (Object.keys(patch).length) this.store.mutate('note', id, patch);
};

Hub.prototype.placeNote = function (this: Hub, id: string, at: { x: number; y: number; rot: number; scale?: number }): void {
  if (!this.store.get('note', id)) return;
  const scale = at.scale === undefined ? undefined : Math.round(Math.min(NOTE_MAX, Math.max(NOTE_MIN, at.scale)) * 100) / 100;
  this.store.mutate('note', id, { x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y), rot: Math.round(at.rot * 10) / 10, ...(scale === undefined ? {} : { scale }) });
};

Hub.prototype.collectedNotes = function (this: Hub): Note[] {
  return this.store
    .all('note')
    .filter((n) => !n.deleted && n.peeledAt)
    .sort((a, b) => (b.peeledAt ?? 0) - (a.peeledAt ?? 0));
};

Hub.prototype.deleteNote = function (this: Hub, id: string): Undo {
  if (!this.store.get('note', id)) return () => {};
  this.store.mutate('note', id, { deleted: true });
  return () => this.store.mutate('note', id, { deleted: false });
};

Hub.prototype.peelNote = function (this: Hub, id: string): Undo {
  const n = this.store.get('note', id);
  if (!n) return () => {};
  // Either of us ticks it: it's read, and joins the collection.
  this.store.mutate('note', id, { peeledAt: Date.now() });
  return () => this.store.mutate('note', id, { peeledAt: null });
};

Hub.prototype.unpeelNote = function (this: Hub, id: string): Undo {
  const n = this.store.get('note', id);
  if (!n?.peeledAt) return () => {};
  const was = n.peeledAt;
  this.store.mutate('note', id, { peeledAt: null });
  return () => this.store.mutate('note', id, { peeledAt: was });
};

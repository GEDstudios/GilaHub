
import { newId } from '../ids';
import { type Photo, type Scope } from '../model';
import { Hub, type Undo } from './base';

/** Pictures: on ideas, notes, tasks and folders, each kept in the scope of what it's on. */

declare module './base' {
  interface Hub {
    /** A picture on an idea or a note, once all its parts are here (null while syncing, or none). */
    shotOf(t: 'idea' | 'note' | 'photo', id: string): string | null;

    /** Put (or, null, take off) a picture: the parts first, each its own op (a sync op is size-capped), then the count. */
    setShot(t: 'idea' | 'note' | 'photo', id: string, dataUrl: string | null): void;

    /** Photos on a task ("item:<id>") or a folder ("list:<id>"), oldest first. */
    photosOf(on: string): Photo[];

    /** The scope a photo on this thing is sealed with: the thing's own. (internal) */
    photoScope(on: string): Scope;

    /** Add a photo (a small JPEG data URL) to a task or a folder. Returns its id. */
    addPhoto(on: string, dataUrl: string): string;

    removePhoto(id: string): Undo;

    /** Re-seal a thing's photos with its scope (after its privacy changed). (internal) */
    rescopePhotos(on: string): void;
  }
}

Hub.prototype.shotOf = function (this: Hub, t: 'idea' | 'note' | 'photo', id: string): string | null {
  const rec = this.store.get(t, id) as (Record<string, unknown> & { shotN?: number | null; shotV?: string | null }) | undefined;
  if (!rec?.shotN || !rec.shotV) return null;
  let out = '';
  for (let i = 0; i < rec.shotN; i++) {
    const part = rec[`shot${i}`];
    if (typeof part !== 'string' || !part.startsWith(`${rec.shotV}:`)) return null;
    out += part.slice(rec.shotV.length + 1);
  }
  return out;
};

Hub.prototype.setShot = function (this: Hub, t: 'idea' | 'note' | 'photo', id: string, dataUrl: string | null): void {
  if (!this.store.get(t, id)) return;
  if (!dataUrl) {
    this.store.mutate(t, id, { shotN: null, shotV: null });
    return;
  }
  const v = newId(6);
  const SIZE = 28_000;
  const n = Math.ceil(dataUrl.length / SIZE);
  this.store.batch(() => {
    for (let i = 0; i < n; i++) this.store.mutate(t, id, { [`shot${i}`]: `${v}:${dataUrl.slice(i * SIZE, (i + 1) * SIZE)}` });
    this.store.mutate(t, id, { shotN: n, shotV: v });
  });
};

Hub.prototype.photosOf = function (this: Hub, on: string): Photo[] {
  return this.store
    .all('photo')
    .filter((p) => p.on === on && !p.deleted)
    .sort((a, b) => a.createdAt - b.createdAt);
};

Hub.prototype.photoScope = function (this: Hub, on: string): Scope {
  const [kind, id] = [on.slice(0, on.indexOf(':')), on.slice(on.indexOf(':') + 1)];
  if (kind === 'item') {
    const item = this.item(id);
    return item ? this.scopeForItem(item) : 'h';
  }
  return this.store.scopeOf('list', id);
};

Hub.prototype.addPhoto = function (this: Hub, on: string, dataUrl: string): string {
  const id = newId();
  this.store.batch(() => {
    this.store.init('photo', id, this.photoScope(on));
    this.store.mutate('photo', id, { on, by: this.meId, createdAt: Date.now() });
    this.setShot('photo', id, dataUrl);
  });
  return id;
};

Hub.prototype.removePhoto = function (this: Hub, id: string): Undo {
  if (!this.store.get('photo', id)) return () => {};
  this.store.mutate('photo', id, { deleted: true });
  return () => this.store.mutate('photo', id, { deleted: false });
};

Hub.prototype.rescopePhotos = function (this: Hub, on: string): void {
  const scope = this.photoScope(on);
  for (const p of this.store.all('photo')) if (p.on === on) this.store.setScope('photo', p.id, scope);
};

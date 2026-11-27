
import type { Item, Scope, Table, Visibility } from '../model';
import { fold } from '../../smart/normalize';
import { listKey, listIdOf } from '../keys';
import { Hub } from './base';

/** A backup file: what it holds, and bringing one back in. */

/** Every table a backup carries (and a restore reads): all of them. A new table goes here too. */
export const BACKUP_TABLES = ['member', 'list', 'item', 'log', 'memory', 'store', 'settings', 'idea', 'moment', 'tag', 'note', 'photo'] as const satisfies readonly Table[];

declare module './base' {
  interface Hub {
    /**
     * Whose backup is this, for one that doesn't say (`me` came with newer backups)? Nobody's to
     * map when it has me in it already. Otherwise: whoever its private things belong to (only
     * their phone could read those), else its one person this household doesn't know.
     * Null when it can't tell (backupStrangers then says whom to ask about).
     */
    backupOwner(data: BackupData): string | null;

    /** The backup's people this household doesn't know (one of them may be me, on a new phone). */
    backupStrangers(data: BackupData): Array<{ id: string; name: string }>;

    /**
     * Import a JSON backup without overwriting anything, sealing every entity in the
     * scope its privacy implies (an "Only me" item must never be re-shared by an import).
     *
     * A restore never adds people: pairing does. The backup's own person (`opts.me`, or
     * backupOwner) becomes me in every person field, so my private things land under my key.
     * Other people the household doesn't know are left out. A folder this household already
     * has (same kind and name) takes the backup's items instead of coming in a second time.
     * Things an earlier restore sealed under that old person's key (unreadable here) are
     * sealed again under mine, so restoring again repairs them.
     */
    importBackup(data: BackupData, opts?: { me?: string }): number;

    /** Everything this device can read, table by table: what a backup file holds. */
    exportBackup(): BackupData;
  }
}

Hub.prototype.exportBackup = function (this: Hub): BackupData {
  return Object.fromEntries(BACKUP_TABLES.map((t) => [t, this.store.all(t) as unknown as Array<{ id: string } & Record<string, unknown>>]));
};

Hub.prototype.backupOwner = function (this: Hub, data: BackupData): string | null {
  const members = data.member ?? [];
  if (members.some((m) => m.id === this.meId)) return null;
  const owners = new Set<string>();
  for (const l of data.list ?? []) if (l.visibility === 'private' && typeof l.owner === 'string') owners.add(l.owner);
  for (const i of data.item ?? []) if (i.private) owners.add(String(i.owner ?? i.createdBy));
  for (const m of data.memory ?? []) if (m.id.startsWith('p:')) owners.add(m.id.split(':')[1]);
  if (owners.size === 1) return [...owners][0];
  const strangers = this.backupStrangers(data);
  return strangers.length === 1 ? strangers[0].id : null;
};

Hub.prototype.backupStrangers = function (this: Hub, data: BackupData): Array<{ id: string; name: string }> {
  const known = new Set(this.members().map((m) => m.id));
  return (data.member ?? []).filter((m) => !known.has(m.id)).map((m) => ({ id: m.id, name: String(m.name ?? '') }));
};

Hub.prototype.importBackup = function (this: Hub, data: BackupData, opts: { me?: string } = {}): number {
  let n = 0;
  const members = data.member ?? [];
  const from = opts.me ?? this.backupOwner(data) ?? undefined;
  const who = (v: unknown) => (from && v === from ? this.meId : v);
  const lists = new Map<string, string>();
  for (const l of data.list ?? []) {
    // By name: every folder is the same kind now (an older backup's shopping lists find ours).
    const twin = this.store.all('list').find((x) => x.id !== l.id && !x.deleted && fold(x.name) === fold(String(l.name ?? '')));
    if (twin && !this.store.record('list', l.id)) lists.set(l.id, twin.id);
  }
  const listOf = (v: unknown) => (typeof v === 'string' ? (lists.get(v) ?? v) : v);
  const keyOf = (k: unknown) => {
    const id = typeof k === 'string' ? listIdOf(k) : null;
    return id ? listKey(lists.get(id) ?? id) : k;
  };
  /** Person fields, and list references, through the maps. */
  const fix = (row: { id: string } & Record<string, unknown>) => {
    const out: { id: string } & Record<string, unknown> = { ...row };
    for (const k of PERSON_FIELDS) if (k in out) out[k] = who(out[k]);
    if ('listId' in out) out.listId = listOf(out.listId);
    return out;
  };
  /** "list:<id>" and "item:<id>" (where a note is stuck, what a photo is on), through the folder map. */
  const placeOf = (v: unknown) => (typeof v === 'string' && v.startsWith('list:') ? `list:${listOf(v.slice(5))}` : v);
  const put = (t: (typeof BACKUP_TABLES)[number], row: { id: string } & Record<string, unknown>, scope: Scope) => {
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
      if (typeof l.parentId === 'string') l.parentId = listOf(l.parentId);
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
    for (const st of data.settings ?? []) {
      // A person's own preferences ("prefs:<them>") are theirs alone: mine come back under my key,
      // never the household's; anyone else's aren't mine to bring in.
      if (st.id.startsWith('prefs:')) {
        if (who(st.id.slice(6)) === this.meId) put('settings', { ...st, id: `prefs:${this.meId}` }, `p:${this.meId}`);
        continue;
      }
      put('settings', fix(st), 'h');
    }
    for (const idea of data.idea ?? []) put('idea', fix(idea), 'h');
    for (const m of data.moment ?? []) put('moment', fix(m), 'h');
    for (const t of data.tag ?? []) put('tag', fix(t), 'h');
    for (const raw of data.note ?? []) {
      const note = fix(raw);
      put('note', { ...note, place: placeOf(note.place) }, 'h');
    }
    // A photo is sealed like what it's on (a private task's photo stays private): after the tasks.
    for (const raw of data.photo ?? []) {
      const photo = fix(raw);
      const on = placeOf(photo.on);
      if (typeof on === 'string') put('photo', { ...photo, on }, this.photoScope(on));
    }
  });
  this.uniformProjects();
  return n;
};

type BackupData = Partial<Record<string, Array<{ id: string } & Record<string, unknown>>>>;

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
  'to',
] as const;

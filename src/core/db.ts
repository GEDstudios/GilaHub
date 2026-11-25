import type { Scope, Table } from './model';

/** Field-level replicated record. `v` = values, `c` = per-field HLC clocks. */
export interface EntityRecord {
  t: Table;
  id: string;
  v: Record<string, unknown>;
  c: Record<string, string>;
}

/** A change, as replicated. `fc` carries per-field clocks when re-emitting existing state. */
export interface Op {
  t: Table;
  id: string;
  f: Record<string, unknown>;
  h: string;
  fc?: Record<string, string>;
}

/** Pending outgoing op, sealed with the key of `s` when sent. */
export interface OutboxEntry {
  cid: string;
  s: Scope;
  op: Op;
}

export interface Commit {
  entities?: EntityRecord[];
  outboxAdd?: OutboxEntry[];
  outboxRemove?: string[];
  meta?: Record<string, unknown>;
}

export interface Persistence {
  loadEntities(): Promise<EntityRecord[]>;
  loadOutbox(): Promise<OutboxEntry[]>;
  getMeta<T>(key: string): Promise<T | undefined>;
  commit(c: Commit): Promise<void>;
  wipe(): Promise<void>;
}

export const DB_NAME = 'gila-hub';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export function openDb(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = factory.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('entities')) db.createObjectStore('entities', { keyPath: 'k' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'cid' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IdbPersistence implements Persistence {
  constructor(private readonly db: IDBDatabase) {}

  static async open(factory?: IDBFactory, name?: string): Promise<IdbPersistence> {
    return new IdbPersistence(await openDb(factory, name));
  }

  async loadEntities(): Promise<EntityRecord[]> {
    const tx = this.db.transaction('entities', 'readonly');
    const rows = (await req(tx.objectStore('entities').getAll())) as Array<EntityRecord & { k: string }>;
    return rows.map(({ t, id, v, c }) => ({ t, id, v, c }));
  }

  async loadOutbox(): Promise<OutboxEntry[]> {
    const tx = this.db.transaction('outbox', 'readonly');
    return (await req(tx.objectStore('outbox').getAll())) as OutboxEntry[];
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const tx = this.db.transaction('meta', 'readonly');
    return (await req(tx.objectStore('meta').get(key))) as T | undefined;
  }

  async commit(c: Commit): Promise<void> {
    const tx = this.db.transaction(['entities', 'outbox', 'meta'], 'readwrite');
    const done = txDone(tx);
    const es = tx.objectStore('entities');
    for (const r of c.entities ?? []) es.put({ k: `${r.t}/${r.id}`, t: r.t, id: r.id, v: r.v, c: r.c });
    const ob = tx.objectStore('outbox');
    for (const e of c.outboxAdd ?? []) ob.put(e);
    for (const cid of c.outboxRemove ?? []) ob.delete(cid);
    const meta = tx.objectStore('meta');
    for (const [k, v] of Object.entries(c.meta ?? {})) {
      if (v === undefined) meta.delete(k);
      else meta.put(v, k);
    }
    await done;
  }

  async wipe(): Promise<void> {
    const tx = this.db.transaction(['entities', 'outbox', 'meta'], 'readwrite');
    const done = txDone(tx);
    tx.objectStore('entities').clear();
    tx.objectStore('outbox').clear();
    tx.objectStore('meta').clear();
    await done;
  }
}

/** Same contract, in memory — used by tests and as a fallback when IndexedDB is unavailable. */
export class MemoryPersistence implements Persistence {
  entities = new Map<string, EntityRecord>();
  outbox = new Map<string, OutboxEntry>();
  meta = new Map<string, unknown>();

  async loadEntities() {
    return [...this.entities.values()].map((r) => structuredClone(r));
  }
  async loadOutbox() {
    return [...this.outbox.values()].map((e) => structuredClone(e));
  }
  async getMeta<T>(key: string) {
    return structuredClone(this.meta.get(key)) as T | undefined;
  }
  async commit(c: Commit) {
    for (const r of c.entities ?? []) this.entities.set(`${r.t}/${r.id}`, structuredClone(r));
    for (const e of c.outboxAdd ?? []) this.outbox.set(e.cid, structuredClone(e));
    for (const cid of c.outboxRemove ?? []) this.outbox.delete(cid);
    for (const [k, v] of Object.entries(c.meta ?? {})) {
      if (v === undefined) this.meta.delete(k);
      else this.meta.set(k, structuredClone(v));
    }
  }
  async wipe() {
    this.entities.clear();
    this.outbox.clear();
    this.meta.clear();
  }
}

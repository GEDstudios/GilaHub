import { Clock, type HlcState } from './hlc';
import type { Commit, EntityRecord, Op, OutboxEntry, Persistence } from './db';
import { newId } from './ids';
import type { Scope, Table, TableTypes } from './model';

const TABLES: Table[] = ['member', 'list', 'item', 'log', 'memory', 'store', 'settings'];

type Views = { [T in Table]: Map<string, TableTypes[T]> };
type Listener = () => void;

const recKey = (t: Table, id: string) => `${t}/${id}`;

/**
 * The local replica.
 *
 * - Every field carries its own hybrid-logical-clock timestamp; merges keep the
 *   newest write per field, so two people editing different fields of the same
 *   item never clobber each other, and the result is identical on every device.
 * - Each entity lives in a privacy scope ('h' household, 'p:<member>' personal).
 *   Ops are queued with the scope whose key will seal them. When an entity moves
 *   between scopes, the store announces the move under the old scope and replays
 *   its full state under the new one; devices that can't read the new scope purge it.
 */
export class Store {
  private records = new Map<string, EntityRecord>();
  private views = Object.fromEntries(TABLES.map((t) => [t, new Map()])) as Views;
  private arrays = new Map<Table, unknown[]>();
  private listeners = new Set<Listener>();
  private outboxListeners = new Set<Listener>();
  private outbox = new Map<string, OutboxEntry>();
  private pending: Required<Pick<Commit, 'outboxAdd' | 'outboxRemove'>> & { entities: Map<string, EntityRecord> } = {
    entities: new Map(),
    outboxAdd: [],
    outboxRemove: [],
  };
  private depth = 0;
  private notifyQueued = false;
  private flushChain: Promise<void> = Promise.resolve();
  private readable: Set<Scope>;
  readonly clock: Clock;
  version = 0;

  private constructor(
    private readonly persistence: Persistence,
    readonly deviceId: string,
    readable: Scope[],
    clockState?: HlcState,
  ) {
    this.readable = new Set(readable);
    this.clock = new Clock(deviceId, clockState);
  }

  static async load(persistence: Persistence, deviceId: string, readable: Scope[]): Promise<Store> {
    const clockState = await persistence.getMeta<HlcState>('clock');
    const store = new Store(persistence, deviceId, readable, clockState);
    for (const rec of await persistence.loadEntities()) {
      store.records.set(recKey(rec.t, rec.id), rec);
      store.materialize(rec);
    }
    for (const e of await persistence.loadOutbox()) store.outbox.set(e.cid, e);
    return store;
  }

  // ---------- reading ----------

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  get<T extends Table>(t: T, id: string | null | undefined): TableTypes[T] | undefined {
    if (!id) return undefined;
    return this.views[t].get(id) as TableTypes[T] | undefined;
  }

  /** All live (non-deleted, readable) entities of a table. Stable array identity per change. */
  all<T extends Table>(t: T): TableTypes[T][] {
    let arr = this.arrays.get(t) as TableTypes[T][] | undefined;
    if (!arr) {
      arr = [...this.views[t].values()] as TableTypes[T][];
      this.arrays.set(t, arr);
    }
    return arr;
  }

  scopeOf(t: Table, id: string): Scope {
    return ((this.records.get(recKey(t, id))?.v._s as Scope | undefined) ?? 'h') as Scope;
  }

  canRead(scope: Scope): boolean {
    return this.readable.has(scope);
  }

  setReadableScopes(scopes: Scope[]): void {
    this.readable = new Set(scopes);
  }

  /** Raw record (including deleted entities) — for undo and debugging. */
  record(t: Table, id: string): EntityRecord | undefined {
    return this.records.get(recKey(t, id));
  }

  // ---------- local writes ----------

  /** Group several writes into one notification + one persistence transaction. */
  batch<R>(fn: () => R): R {
    this.depth++;
    try {
      return fn();
    } finally {
      this.depth--;
      if (this.depth === 0) this.flush();
    }
  }

  /** Set fields on an entity (creating it if needed). `undefined` values are stored as null. */
  mutate<T extends Table>(t: T, id: string, fields: Partial<TableTypes[T]> & Record<string, unknown>): Op {
    const h = this.clock.now();
    const k = recKey(t, id);
    let rec = this.records.get(k);
    if (!rec) {
      rec = { t, id, v: {}, c: {} };
      this.records.set(k, rec);
    }
    const f: Record<string, unknown> = {};
    for (const [name, raw] of Object.entries(fields)) {
      if (name === 'id' || name === '_s') continue;
      const val = raw === undefined ? null : raw;
      f[name] = val;
      rec.v[name] = val;
      rec.c[name] = h;
    }
    const op: Op = { t, id, f, h };
    this.enqueue({ cid: newId(12), s: this.scopeOf(t, id), op });
    this.touch(rec);
    return op;
  }

  create<T extends Table>(t: T, fields: Partial<TableTypes[T]> & Record<string, unknown>, id = newId()): string {
    this.mutate(t, id, fields);
    return id;
  }

  /**
   * Create an entity directly inside a scope, before any content is written, so its very
   * first op is already sealed with the right key (nothing ever leaks under 'h').
   */
  init(t: Table, id: string, scope: Scope): void {
    if (this.records.has(recKey(t, id))) {
      this.setScope(t, id, scope);
      return;
    }
    if (scope === 'h') return;
    const h = this.clock.now();
    const rec: EntityRecord = { t, id, v: { _s: scope }, c: { _s: h } };
    this.records.set(recKey(t, id), rec);
    this.enqueue({ cid: newId(12), s: scope, op: { t, id, f: { _s: scope }, h } });
    this.touch(rec);
  }

  /** Move an entity to another privacy scope (see class docs). */
  setScope(t: Table, id: string, next: Scope): void {
    const rec = this.records.get(recKey(t, id));
    if (!rec) return;
    const prev = this.scopeOf(t, id);
    if (prev === next) return;
    const h = this.clock.now();
    rec.v._s = next;
    rec.c._s = h;
    this.enqueue({ cid: newId(12), s: prev, op: { t, id, f: { _s: next }, h } });
    this.enqueue({ cid: newId(12), s: next, op: { t, id, f: { ...rec.v }, h, fc: { ...rec.c } } });
    this.touch(rec);
  }

  // ---------- remote writes ----------

  /** Merge an op received from the relay. Returns true when anything changed. */
  applyRemote(op: Op): boolean {
    this.clock.observe(op.h);
    const k = recKey(op.t, op.id);
    let rec = this.records.get(k);
    const fresh = !rec;
    if (!rec) rec = { t: op.t, id: op.id, v: {}, c: {} };
    let changed = false;

    const newer = (field: string) => {
      const clock = op.fc?.[field] ?? op.h;
      const cur = rec!.c[field];
      return cur === undefined || clock > cur ? clock : null;
    };

    // Scope first: it decides whether we may hold this entity's content at all.
    if ('_s' in op.f) {
      const clock = newer('_s');
      if (clock) {
        rec.v._s = op.f._s;
        rec.c._s = clock;
        changed = true;
      }
    }
    const scope = ((rec.v._s as Scope | undefined) ?? 'h') as Scope;
    if (!this.canRead(scope)) {
      // Private to someone else: keep only the scope marker (so stale ops can't resurrect it).
      const hadContent = Object.keys(rec.v).some((f) => f !== '_s');
      rec.v = { _s: rec.v._s };
      rec.c = { _s: rec.c._s };
      if (!changed && !hadContent) return false;
      changed = true;
    } else {
      for (const [field, val] of Object.entries(op.f)) {
        if (field === '_s') continue;
        const clock = newer(field);
        if (clock) {
          rec.v[field] = val;
          rec.c[field] = clock;
          changed = true;
        }
      }
    }
    if (!changed) return false;
    if (fresh) this.records.set(k, rec);
    this.touch(rec);
    return true;
  }

  /** Apply many remote ops with a single notification. */
  applyRemoteBatch(ops: Op[]): number {
    let n = 0;
    this.batch(() => {
      for (const op of ops) if (this.applyRemote(op)) n++;
    });
    return n;
  }

  // ---------- outbox ----------

  pendingOutbox(): OutboxEntry[] {
    return [...this.outbox.values()];
  }

  outboxSize(): number {
    return this.outbox.size;
  }

  ack(cids: string[]): void {
    let any = false;
    for (const cid of cids) {
      if (this.outbox.delete(cid)) {
        this.pending.outboxRemove.push(cid);
        any = true;
      }
    }
    if (any && this.depth === 0) this.flush();
  }

  onOutbox(fn: Listener): () => void {
    this.outboxListeners.add(fn);
    return () => this.outboxListeners.delete(fn);
  }

  /**
   * Replace the outbox with one compact op per readable entity (full state, original clocks).
   * Used before the first sync after a long local-only period, and by "repair sync".
   */
  requeueAll(): void {
    this.batch(() => {
      for (const cid of this.outbox.keys()) this.pending.outboxRemove.push(cid);
      this.outbox.clear();
      for (const rec of this.records.values()) {
        const scope = ((rec.v._s as Scope | undefined) ?? 'h') as Scope;
        if (!this.canRead(scope)) continue;
        const h = this.clock.now();
        this.enqueue({ cid: newId(12), s: scope, op: { t: rec.t, id: rec.id, f: { ...rec.v }, h, fc: { ...rec.c } } });
      }
    });
  }

  /** Wait until everything written so far is on disk. */
  async settled(): Promise<void> {
    await this.flushChain;
  }

  // ---------- internals ----------

  private enqueue(e: OutboxEntry): void {
    this.outbox.set(e.cid, e);
    this.pending.outboxAdd.push(e);
  }

  private touch(rec: EntityRecord): void {
    this.materialize(rec);
    this.pending.entities.set(recKey(rec.t, rec.id), rec);
    this.version++;
    if (this.depth === 0) this.flush();
  }

  private materialize(rec: EntityRecord): void {
    const view = this.views[rec.t];
    const scope = ((rec.v._s as Scope | undefined) ?? 'h') as Scope;
    const hasContent = Object.keys(rec.v).some((k) => k !== '_s');
    if (rec.v.deleted === true || !this.canRead(scope) || !hasContent) {
      if (view.delete(rec.id)) this.arrays.delete(rec.t);
      return;
    }
    const obj: Record<string, unknown> = { id: rec.id };
    for (const [k, v] of Object.entries(rec.v)) if (k !== '_s') obj[k] = v;
    view.set(rec.id, obj as never);
    this.arrays.delete(rec.t);
  }

  private flush(): void {
    const { entities, outboxAdd, outboxRemove } = this.pending;
    const hadOutbox = outboxAdd.length > 0;
    if (entities.size || outboxAdd.length || outboxRemove.length) {
      const commit: Commit = {
        entities: [...entities.values()].map((r) => ({ t: r.t, id: r.id, v: { ...r.v }, c: { ...r.c } })),
        outboxAdd: outboxAdd.slice(),
        outboxRemove: outboxRemove.slice(),
        meta: { clock: this.clock.snapshot() },
      };
      this.pending = { entities: new Map(), outboxAdd: [], outboxRemove: [] };
      this.flushChain = this.flushChain.then(() => this.persistence.commit(commit)).catch((err) => {
        console.error('[gila] failed to persist', err);
      });
    }
    if (!this.notifyQueued) {
      this.notifyQueued = true;
      queueMicrotask(() => {
        this.notifyQueued = false;
        for (const fn of this.listeners) fn();
      });
    }
    if (hadOutbox) for (const fn of this.outboxListeners) fn();
  }
}

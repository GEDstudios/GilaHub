import { openJSON, sealJSON } from './crypto';
import type { Op, Persistence } from './db';
import type { Scope } from './model';
import type { Store } from './store';

export interface SyncConfig {
  /** '' = same origin as the app. */
  apiBase: string;
  householdId: string;
  token: string;
  deviceId: string;
  memberId: string;
  /** scope → key material (base64url). */
  keyring: Partial<Record<Scope, string>>;
}

export type SyncStatus = 'local' | 'connecting' | 'syncing' | 'synced' | 'offline';

export interface Presence {
  dev: string;
  member: string;
  state: string | null;
  at: number;
}

type ServerMsg =
  | { type: 'ops'; ops: Array<{ seq: number; k: Scope; c: string }>; cursor: number; more?: boolean }
  | { type: 'ack'; acks: Array<[string, number]>; cursor: number }
  | { type: 'presence'; list: Presence[] }
  | { type: 'error'; error: string };

const BACKOFF = [800, 1500, 3000, 6000, 12000, 30000];

export function wsUrl(apiBase: string, path: string): string {
  const base = apiBase || (typeof location !== 'undefined' ? location.origin : 'http://localhost');
  const u = new URL(path, base);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * Keeps the local store and the relay in step:
 *  - streams the encrypted backlog in small pages, then live ops;
 *  - seals and sends the outbox (only after the backlog is complete, so cursors stay exact);
 *  - shares ephemeral presence ("shopping now").
 */
export class SyncClient {
  status: SyncStatus = 'connecting';
  lastSyncedAt = 0;
  presence = new Map<string, Presence>();
  private ws: WebSocket | null = null;
  private ready = false;
  private cursor = 0;
  private inflight = new Set<string>();
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private myPresence: string | null = null;
  private listeners = new Set<() => void>();
  private unsubOutbox: (() => void) | null = null;
  private sealing = false;
  /** Messages are handled strictly in arrival order (decryption is async). */
  private inbox: Promise<void> = Promise.resolve();
  /** The first complete backlog (whenReady). */
  private readonly firstBacklog = deferred();

  constructor(
    private readonly store: Store,
    private readonly persistence: Persistence,
    private readonly cfg: SyncConfig,
    private readonly WS: typeof WebSocket = WebSocket,
  ) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private setStatus(s: SyncStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.emit();
    }
  }

  /**
   * Starts syncing and returns at once: the socket is only being opened, nothing has arrived
   * yet. To wait for what the relay already holds, use `whenReady`.
   */
  async start(): Promise<void> {
    this.stopped = false;
    this.cursor = (await this.persistence.getMeta<number>('cursor')) ?? 0;
    this.unsubOutbox = this.store.onOutbox(() => void this.flush());
    this.connect();
  }

  /**
   * Resolves once the first backlog is complete: everything the relay held for this device has
   * been merged into the store and saved (however many pages and reconnects that took). It stays
   * resolved; it never resolves while the relay can't be reached.
   */
  whenReady(): Promise<void> {
    return this.firstBacklog.promise;
  }

  stop(): void {
    this.stopped = true;
    this.unsubOutbox?.();
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  /** Reconnect right away (app foregrounded, network back). */
  poke(): void {
    if (this.stopped) return;
    if (!this.ws || this.ws.readyState === this.WS.CLOSED || this.ws.readyState === this.WS.CLOSING) {
      if (this.timer) clearTimeout(this.timer);
      this.attempts = 0;
      this.connect();
    }
  }

  setPresence(state: string | null): void {
    this.myPresence = state;
    this.send({ type: 'presence', state });
  }

  /** Others' presence (excluding this device). */
  others(): Presence[] {
    return [...this.presence.values()].filter((p) => p.dev !== this.cfg.deviceId && p.state);
  }

  private connect(): void {
    if (this.stopped) return;
    this.ready = false;
    this.inflight.clear();
    this.setStatus(this.lastSyncedAt ? 'syncing' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new this.WS(wsUrl(this.cfg.apiBase, `/api/h/${this.cfg.householdId}/ws`), ['gila', this.cfg.token]);
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.send({ type: 'hello', dev: this.cfg.deviceId, member: this.cfg.memberId, cursor: this.cursor });
      if (this.myPresence) this.send({ type: 'presence', state: this.myPresence });
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      this.inbox = this.inbox.then(() => this.handle(msg)).catch((err) => console.warn('[gila] sync message', err));
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.presence.clear();
      this.setStatus('offline');
      this.retry();
    };
    ws.onerror = () => ws.close();
  }

  private retry(): void {
    if (this.stopped) return;
    const delay = BACKOFF[Math.min(this.attempts++, BACKOFF.length - 1)];
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private send(msg: unknown): boolean {
    if (this.ws && this.ws.readyState === this.WS.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  private async handle(msg: ServerMsg): Promise<void> {
    switch (msg.type) {
      case 'ops': {
        const ops: Op[] = [];
        for (const o of msg.ops) {
          const key = this.cfg.keyring[o.k];
          if (!key) continue;
          try {
            ops.push(await openJSON<Op>(key, o.c, `${this.cfg.householdId}|${o.k}`));
          } catch {
            // Not for us, or corrupted: skip but keep the cursor moving.
          }
        }
        if (ops.length) this.store.applyRemoteBatch(ops);
        await this.saveCursor(msg.cursor);
        if (msg.more) {
          this.send({ type: 'pull', cursor: this.cursor });
        } else {
          if (!this.ready) {
            this.ready = true;
            this.firstBacklog.resolve();
            void this.flush();
          }
          this.markSynced();
        }
        break;
      }
      case 'ack': {
        const cids = msg.acks.map(([cid]) => cid);
        for (const cid of cids) this.inflight.delete(cid);
        this.store.ack(cids);
        await this.saveCursor(msg.cursor);
        if (this.store.outboxSize()) void this.flush();
        else this.markSynced();
        break;
      }
      case 'presence': {
        this.presence.clear();
        for (const p of msg.list) this.presence.set(p.dev, p);
        this.emit();
        break;
      }
      case 'error':
        console.warn('[gila] relay error', msg.error);
        break;
    }
  }

  private markSynced(): void {
    if (this.store.outboxSize() === 0) {
      this.lastSyncedAt = Date.now();
      this.setStatus('synced');
    } else this.setStatus('syncing');
  }

  private async saveCursor(c: number): Promise<void> {
    if (c > this.cursor) {
      this.cursor = c;
      // The ops this cursor covers must reach the disk first. Saved ahead of them, a cursor
      // skips them for good if the app closes in between (a partner's request never shows up).
      await this.store.settled();
      await this.persistence.commit({ meta: { cursor: c } });
    }
  }

  /** Seal and send pending outbox entries, a batch at a time. */
  async flush(): Promise<void> {
    if (!this.ready || this.sealing || !this.ws || this.ws.readyState !== this.WS.OPEN) return;
    this.sealing = true;
    try {
      const pending = this.store.pendingOutbox().filter((e) => !this.inflight.has(e.cid)).slice(0, 80);
      if (!pending.length) return;
      this.setStatus('syncing');
      const ops: Array<{ cid: string; k: Scope; c: string }> = [];
      for (const e of pending) {
        const key = this.cfg.keyring[e.s];
        if (!key) {
          // We can't seal for a scope we don't hold (shouldn't happen) — drop it.
          this.store.ack([e.cid]);
          continue;
        }
        ops.push({ cid: e.cid, k: e.s, c: await sealJSON(key, e.op, `${this.cfg.householdId}|${e.s}`) });
      }
      if (ops.length && this.send({ type: 'push', ops })) for (const o of ops) this.inflight.add(o.cid);
    } finally {
      this.sealing = false;
    }
  }
}

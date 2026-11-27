/**
 * The relay as the app meets it (worker/household.ts), in memory: it keeps what devices push,
 * sealed as they sent it, hands a device its backlog a page at a time, and passes new ops on to
 * the others. For tests that start the whole app (startRuntime) on a device: `install()` puts it
 * where the app looks for its relay (fetch, WebSocket), `sync(hub)` connects a phone that is
 * only a Hub (`person` in _helpers.ts).
 */
import { vi } from 'vitest';
import { openJSON, sealJSON } from '../../src/core/crypto';
import type { Op } from '../../src/core/db';
import type { Hub } from '../../src/core/hub';
import type { Scope } from '../../src/core/model';

interface Row {
  seq: number;
  k: Scope;
  c: string;
  dev: string;
  cid: string;
}

type ClientMsg = { type: string; dev?: string; member?: string; cursor?: number; ops?: Array<{ cid: string; k: Scope; c: string }> };

/** A device's socket, as the relay holds it. */
class Socket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = Socket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  dev = '';
  member = '';
  /** Its backlog is complete: it hears what others push from here on. */
  ready = false;

  constructor(private readonly relay: Relay) {
    queueMicrotask(() => {
      if (this.readyState !== Socket.CONNECTING) return;
      if (!relay.up) return this.close();
      this.readyState = Socket.OPEN;
      relay.sockets.add(this);
      this.onopen?.();
    });
  }

  send(raw: string): void {
    this.relay.receive(this, JSON.parse(raw) as ClientMsg);
  }

  /** Relay → device, later (a socket never answers inside `send`). */
  deliver(msg: unknown): void {
    queueMicrotask(() => this.readyState === Socket.OPEN && this.onmessage?.({ data: JSON.stringify(msg) }));
  }

  close(): void {
    if (this.readyState === Socket.CLOSED) return;
    this.readyState = Socket.CLOSED;
    this.relay.sockets.delete(this);
    queueMicrotask(() => this.onclose?.());
  }
}

export class Relay {
  rows: Row[] = [];
  sockets = new Set<Socket>();
  /** Reachable? Off: the health check fails and sockets close as they open. */
  up = true;
  /** Backlog pages it will still hand out (a device closed mid-backlog: set it, then count `served`). */
  budget = Infinity;
  served = 0;
  private cursors = new Map<Hub, number>();

  /**
   * `keys`: scope → key material, for every scope a `sync`ed Hub writes in (the relay itself
   * never opens anything; this is the phones' keyring). `page`: ops per backlog page (the real
   * one sends 250).
   */
  constructor(
    readonly householdId: string,
    private readonly keys: Partial<Record<Scope, string>>,
    readonly page = 250,
  ) {}

  /** Stand where the app looks for its relay. Undo with `vi.unstubAllGlobals()`. */
  install(online = true): void {
    const relay = this;
    vi.stubGlobal('fetch', async () => {
      if (!relay.up) throw new TypeError('fetch failed');
      return { ok: true, json: async () => ({ app: 'gila-hub' }) };
    });
    vi.stubGlobal(
      'WebSocket',
      class extends Socket {
        constructor() {
          super(relay);
        }
      },
    );
    vi.stubGlobal('navigator', { onLine: online });
  }

  private maxSeq(): number {
    return this.rows.at(-1)?.seq ?? 0;
  }

  private add(dev: string, o: { cid: string; k: Scope; c: string }): Row {
    const had = this.rows.find((r) => r.dev === dev && r.cid === o.cid);
    if (had) return had;
    const row = { seq: this.maxSeq() + 1, k: o.k, c: o.c, dev, cid: o.cid };
    this.rows.push(row);
    return row;
  }

  private forward(fresh: Row[], from: Socket | null): void {
    for (const s of this.sockets) {
      if (s === from || !s.ready) continue;
      const ops = fresh.filter((r) => r.k === 'h' || r.k === `p:${s.member}`).map(({ seq, k, c }) => ({ seq, k, c }));
      s.deliver({ type: 'ops', ops, cursor: this.maxSeq() });
    }
  }

  private sendPage(ws: Socket, cursor: number): void {
    if (this.budget <= 0) return;
    this.budget--;
    const rows = this.rows.filter((r) => r.seq > cursor && (r.k === 'h' || r.k === `p:${ws.member}`)).slice(0, this.page);
    const more = rows.length === this.page;
    if (!more) ws.ready = true;
    this.served++;
    ws.deliver({ type: 'ops', ops: rows.map(({ seq, k, c }) => ({ seq, k, c })), cursor: more ? rows[rows.length - 1].seq : Math.max(cursor, this.maxSeq()), more });
  }

  receive(ws: Socket, msg: ClientMsg): void {
    switch (msg.type) {
      case 'hello':
        ws.dev = msg.dev ?? '';
        ws.member = msg.member ?? '';
        ws.ready = false;
        this.sendPage(ws, msg.cursor ?? 0);
        break;
      case 'pull':
        this.sendPage(ws, msg.cursor ?? 0);
        break;
      case 'push': {
        const before = this.maxSeq();
        const rows = (msg.ops ?? []).map((o) => this.add(ws.dev, o));
        ws.deliver({ type: 'ack', acks: rows.map((r) => [r.cid, r.seq]), cursor: this.maxSeq() });
        this.forward(rows.filter((r) => r.seq > before), ws);
        break;
      }
    }
  }

  /** A phone that is only a Hub: send what it has written, then give it what it hasn't seen. */
  async sync(hub: Hub): Promise<void> {
    const aad = (k: Scope) => `${this.householdId}|${k}`;
    const before = this.maxSeq();
    const entries = hub.store.pendingOutbox();
    const fresh: Row[] = [];
    for (const e of entries) fresh.push(this.add(hub.store.deviceId, { cid: e.cid, k: e.s, c: await sealJSON(this.keys[e.s]!, e.op, aad(e.s)) }));
    hub.store.ack(entries.map((e) => e.cid));
    this.forward(fresh.filter((r) => r.seq > before), null);
    const seen = this.cursors.get(hub) ?? 0;
    const ops: Op[] = [];
    for (const r of this.rows) {
      if (r.seq <= seen || r.dev === hub.store.deviceId || !hub.store.canRead(r.k)) continue;
      ops.push(await openJSON<Op>(this.keys[r.k]!, r.c, aad(r.k)));
    }
    hub.store.applyRemoteBatch(ops);
    this.cursors.set(hub, this.maxSeq());
  }
}

/** Wait (a few ms at a time) until `fn` holds. */
export async function until(fn: () => unknown, ms = 2000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}

/** Long enough for whatever is already under way (messages, saves) to finish. */
export const quiet = (ms = 25) => new Promise((r) => setTimeout(r, ms));

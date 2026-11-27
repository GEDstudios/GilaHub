import { DurableObject } from 'cloudflare:workers';
import { generateVapidKeys, sendPush, type PushSub, type VapidKeys } from './webpush';

export interface Env {
  HOUSEHOLD: DurableObjectNamespace<Household>;
  INVITES: DurableObjectNamespace;
  ASSETS: Fetcher;
}

interface Attachment {
  dev: string;
  member: string;
  ready: boolean;
  presence: string | null;
  presenceAt: number;
}

const PAGE = 250;
const MAX_OP_BYTES = 64 * 1024;
const enc = new TextEncoder();

async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

/** Reads `Sec-WebSocket-Protocol: gila, <token>` or `Authorization: Bearer <token>`. */
function tokenOf(req: Request): string | null {
  const proto = req.headers.get('sec-websocket-protocol');
  if (proto) {
    const parts = proto.split(',').map((p) => p.trim());
    if (parts[0] === 'gila' && parts[1]) return parts[1];
  }
  const auth = req.headers.get('authorization');
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
}

/**
 * One Durable Object per household. It stores only ciphertext: an append-only
 * op log, push subscriptions, and sealed reminders. It relays live changes over
 * hibernatable WebSockets and fires reminders with alarms.
 */
export class Household extends DurableObject<Env> {
  private sql: SqlStorage;
  private vapid: VapidKeys | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ops (seq INTEGER PRIMARY KEY AUTOINCREMENT, cid TEXT NOT NULL, dev TEXT NOT NULL, k TEXT NOT NULL, c TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS ops_cid ON ops(dev, cid);
      CREATE TABLE IF NOT EXISTS subs (dev TEXT PRIMARY KEY, member TEXT NOT NULL, sub TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, at INTEGER NOT NULL, members TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reminders_at ON reminders(at);
    `);
  }

  private kv(k: string): string | null {
    const row = this.sql.exec<{ v: string }>('SELECT v FROM kv WHERE k = ?', k).toArray()[0];
    return row?.v ?? null;
  }

  private setKv(k: string, v: string): void {
    this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v);
  }

  /** Trust on first use: the first device to connect sets the household's auth hash. */
  private async authorize(req: Request): Promise<boolean> {
    const token = tokenOf(req);
    if (!token || token.length < 20 || token.length > 200) return false;
    const hash = await sha256(token);
    const stored = this.kv('auth');
    if (!stored) {
      this.setKv('auth', hash);
      this.setKv('created', String(Date.now()));
      return true;
    }
    return stored === hash;
  }

  private async vapidKeys(): Promise<VapidKeys> {
    if (this.vapid) return this.vapid;
    const raw = this.kv('vapid');
    if (raw) return (this.vapid = JSON.parse(raw) as VapidKeys);
    const keys = await generateVapidKeys();
    this.setKv('vapid', JSON.stringify(keys));
    return (this.vapid = keys);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const action = url.pathname.split('/').slice(4).join('/'); // /api/h/:id/<action>
    if (!(await this.authorize(req))) return json({ error: 'unauthorized' }, 401);
    if (!this.kv('origin')) this.setKv('origin', url.origin);

    if (action === 'ws') {
      if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected websocket' }, 426);
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ dev: '', member: '', ready: false, presence: null, presenceAt: 0 } satisfies Attachment);
      return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'gila' } });
    }

    if (action === 'vapid' && req.method === 'GET') return json({ publicKey: (await this.vapidKeys()).publicKey });

    if (action === 'subscribe' && req.method === 'POST') {
      const body = (await req.json()) as { dev: string; member: string; sub: PushSub };
      if (!body?.dev || !body.sub?.endpoint?.startsWith('https://')) return json({ error: 'bad subscription' }, 400);
      this.sql.exec(
        'INSERT INTO subs (dev, member, sub, at) VALUES (?, ?, ?, ?) ON CONFLICT(dev) DO UPDATE SET member = excluded.member, sub = excluded.sub, at = excluded.at',
        body.dev,
        body.member,
        JSON.stringify(body.sub),
        Date.now(),
      );
      return json({ ok: true });
    }

    if (action === 'unsubscribe' && req.method === 'POST') {
      const body = (await req.json()) as { dev: string };
      this.sql.exec('DELETE FROM subs WHERE dev = ?', body.dev);
      return json({ ok: true });
    }

    if (action === 'reminders' && req.method === 'POST') {
      const body = (await req.json()) as {
        upsert?: Array<{ id: string; at: number; members: string[]; payload: string }>;
        remove?: string[];
        removePrefix?: string[];
      };
      for (const id of body.remove ?? []) this.sql.exec('DELETE FROM reminders WHERE id = ?', id);
      for (const p of body.removePrefix ?? []) this.sql.exec("DELETE FROM reminders WHERE id LIKE ? || '%'", p);
      for (const r of body.upsert ?? []) {
        if (!r.id || !Number.isFinite(r.at) || r.payload.length > 3000) continue;
        this.sql.exec(
          'INSERT INTO reminders (id, at, members, payload) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at, members = excluded.members, payload = excluded.payload',
          r.id,
          r.at,
          JSON.stringify(r.members),
          r.payload,
        );
      }
      await this.scheduleAlarm();
      return json({ ok: true });
    }

    if (action === 'notify' && req.method === 'POST') {
      const body = (await req.json()) as { members: string[]; payload: string; topic?: string; dev?: string };
      if (!body.payload || body.payload.length > 3000) return json({ error: 'bad payload' }, 400);
      const r = await this.pushTo(body.members, body.payload, { urgency: 'high', ttl: 3600, topic: body.topic, dev: body.dev });
      return json({ ok: true, ...r });
    }

    if (action === 'invite' && req.method === 'POST') {
      const body = (await req.json()) as { iid: string; blob: string };
      if (!body.iid || !body.blob || body.blob.length > 8000) return json({ error: 'bad invite' }, 400);
      const stub = this.env.INVITES.get(this.env.INVITES.idFromName('invites'));
      return stub.fetch(new Request(`https://invites/put/${body.iid}`, { method: 'PUT', body: body.blob }));
    }

    // Keep (or replace) a member's recovery copy. Only a device of this household can.
    if (action === 'recovery' && req.method === 'POST') {
      const body = (await req.json()) as { rid: string; blob: string; old?: string | null };
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(body.rid ?? '') || !body.blob || body.blob.length > 8000) return json({ error: 'bad recovery' }, 400);
      const old = body.old && /^[A-Za-z0-9_-]{16,64}$/.test(body.old) ? `?old=${body.old}` : '';
      const stub = this.env.INVITES.get(this.env.INVITES.idFromName('invites'));
      return stub.fetch(new Request(`https://invites/recovery/put/${body.rid}${old}`, { method: 'PUT', body: body.blob }));
    }

    if (action === 'stats' && req.method === 'GET') {
      const ops = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM ops').toArray()[0]?.n ?? 0;
      const subs = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM subs').toArray()[0]?.n ?? 0;
      return json({ ops, subs, devices: this.ctx.getWebSockets().length });
    }

    return json({ error: 'not found' }, 404);
  }

  // ---------- WebSocket sync ----------

  private att(ws: WebSocket): Attachment {
    return ws.deserializeAttachment() as Attachment;
  }

  private send(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }

  private maxSeq(): number {
    return this.sql.exec<{ m: number | null }>('SELECT MAX(seq) AS m FROM ops').toArray()[0]?.m ?? 0;
  }

  private page(ws: WebSocket, cursor: number): void {
    const a = this.att(ws);
    const rows = this.sql
      .exec<{ seq: number; k: string; c: string }>(
        "SELECT seq, k, c FROM ops WHERE seq > ? AND (k = 'h' OR k = ?) ORDER BY seq LIMIT ?",
        cursor,
        `p:${a.member}`,
        PAGE,
      )
      .toArray();
    const more = rows.length === PAGE;
    const next = more ? rows[rows.length - 1].seq : Math.max(cursor, this.maxSeq());
    if (!more && !a.ready) ws.serializeAttachment({ ...a, ready: true });
    this.send(ws, { type: 'ops', ops: rows, cursor: next, more });
  }

  private presenceList() {
    return this.ctx
      .getWebSockets()
      .filter((s) => s.readyState === 1)
      .map((s) => this.att(s))
      .filter((a) => a.dev)
      .map((a) => ({ dev: a.dev, member: a.member, state: a.presence, at: a.presenceAt }));
  }

  private broadcastPresence(): void {
    const list = this.presenceList();
    for (const s of this.ctx.getWebSockets()) this.send(s, { type: 'presence', list });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 2_000_000) return;
    let msg: { type: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const a = this.att(ws);

    switch (msg.type) {
      case 'hello': {
        const dev = String(msg.dev ?? '').slice(0, 64);
        const member = String(msg.member ?? '').slice(0, 64);
        ws.serializeAttachment({ ...a, dev, member, ready: false });
        this.page(ws, Number(msg.cursor) || 0);
        this.broadcastPresence();
        break;
      }
      case 'pull':
        this.page(ws, Number(msg.cursor) || 0);
        break;
      case 'push': {
        if (!a.dev) return;
        const ops = Array.isArray(msg.ops) ? (msg.ops as Array<{ cid: string; k: string; c: string }>) : [];
        const acks: Array<[string, number]> = [];
        const fresh: Array<{ seq: number; k: string; c: string }> = [];
        const now = Date.now();
        for (const o of ops.slice(0, 200)) {
          if (typeof o.cid !== 'string' || typeof o.k !== 'string' || typeof o.c !== 'string' || o.c.length > MAX_OP_BYTES) continue;
          if (o.k !== 'h' && !/^p:[A-Za-z0-9]{1,64}$/.test(o.k)) continue;
          const existing = this.sql.exec<{ seq: number }>('SELECT seq FROM ops WHERE dev = ? AND cid = ?', a.dev, o.cid).toArray()[0];
          if (existing) {
            acks.push([o.cid, existing.seq]);
            continue;
          }
          const seq = this.sql
            .exec<{ seq: number }>('INSERT INTO ops (cid, dev, k, c, at) VALUES (?, ?, ?, ?, ?) RETURNING seq', o.cid, a.dev, o.k, o.c, now)
            .toArray()[0].seq;
          acks.push([o.cid, seq]);
          fresh.push({ seq, k: o.k, c: o.c });
        }
        const cursor = this.maxSeq();
        this.send(ws, { type: 'ack', acks, cursor });
        if (fresh.length) {
          for (const other of this.ctx.getWebSockets()) {
            if (other === ws) continue;
            const oa = this.att(other);
            if (!oa.ready) continue;
            const visible = fresh.filter((f) => f.k === 'h' || f.k === `p:${oa.member}`);
            this.send(other, { type: 'ops', ops: visible, cursor });
          }
        }
        break;
      }
      case 'presence': {
        const state = typeof msg.state === 'string' ? msg.state.slice(0, 32) : null;
        ws.serializeAttachment({ ...a, presence: state, presenceAt: Date.now() });
        this.broadcastPresence();
        break;
      }
      case 'ping':
        this.send(ws, { type: 'pong' });
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    this.broadcastPresence();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ---------- push & reminders ----------

  private async pushTo(
    members: string[],
    payload: string,
    opts: { urgency?: 'normal' | 'high'; ttl?: number; topic?: string; dev?: string } = {},
  ): Promise<{ sent: number; tried: number; statuses: number[] }> {
    const subs = this.sql.exec<{ dev: string; member: string; sub: string }>('SELECT dev, member, sub FROM subs').toArray();
    const keys = await this.vapidKeys();
    const subject = this.kv('origin') ?? 'mailto:relay@gila-hub.invalid';
    let sent = 0;
    let tried = 0;
    const statuses: number[] = [];
    for (const s of subs) {
      if (!members.includes(s.member)) continue;
      if (opts.dev && s.dev !== opts.dev) continue;
      tried++;
      const res = await sendPush(JSON.parse(s.sub) as PushSub, payload, keys, subject, opts);
      if (res.gone) this.sql.exec('DELETE FROM subs WHERE dev = ?', s.dev);
      if (res.ok) sent++;
      else {
        statuses.push(res.status);
        console.warn(`push refused: status ${res.status} host ${new URL((JSON.parse(s.sub) as PushSub).endpoint).host} ${res.reason ?? ''}`);
      }
    }
    return { sent, tried, statuses };
  }

  private async scheduleAlarm(): Promise<void> {
    const next = this.sql.exec<{ at: number | null }>('SELECT MIN(at) AS at FROM reminders').toArray()[0]?.at;
    if (next) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next));
  }

  async alarm(): Promise<void> {
    const due = this.sql
      .exec<{ id: string; members: string; payload: string }>('SELECT id, members, payload FROM reminders WHERE at <= ? ORDER BY at LIMIT 20', Date.now() + 15_000)
      .toArray();
    for (const r of due) {
      this.sql.exec('DELETE FROM reminders WHERE id = ?', r.id);
      await this.pushTo(JSON.parse(r.members) as string[], r.payload, { urgency: 'high', ttl: 6 * 3600, topic: r.id });
    }
    await this.scheduleAlarm();
  }
}

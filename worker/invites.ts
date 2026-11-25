import { DurableObject } from 'cloudflare:workers';

const TTL_MS = 30 * 60 * 1000;

/**
 * Short-lived pairing invites. Each blob is sealed with a key stretched from the
 * 8-symbol code, which never reaches the server. Claimed invites are deleted.
 */
export class Invites extends DurableObject {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS invites (iid TEXT PRIMARY KEY, blob TEXT NOT NULL, exp INTEGER NOT NULL)');
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const now = Date.now();
    this.sql.exec('DELETE FROM invites WHERE exp < ?', now);

    const put = url.pathname.match(/^\/put\/([A-Za-z0-9_-]{16,64})$/);
    if (put && req.method === 'PUT') {
      const blob = await req.text();
      this.sql.exec(
        'INSERT INTO invites (iid, blob, exp) VALUES (?, ?, ?) ON CONFLICT(iid) DO UPDATE SET blob = excluded.blob, exp = excluded.exp',
        put[1],
        blob,
        now + TTL_MS,
      );
      return Response.json({ ok: true, expires: now + TTL_MS });
    }

    const get = url.pathname.match(/^\/api\/invite\/([A-Za-z0-9_-]{16,64})$/);
    if (get && req.method === 'GET') {
      const row = this.sql.exec<{ blob: string }>('SELECT blob FROM invites WHERE iid = ?', get[1]).toArray()[0];
      if (!row) return Response.json({ error: 'not found' }, { status: 404 });
      this.sql.exec('DELETE FROM invites WHERE iid = ?', get[1]);
      return Response.json({ blob: row.blob }, { headers: { 'cache-control': 'no-store' } });
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  }
}

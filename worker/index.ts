/**
 * Gila Hub relay — one free Cloudflare Worker:
 *   /api/health               liveness (the app uses it to detect a relay)
 *   /api/h/:household/*       per-household Durable Object (sync, push, reminders, invites)
 *   /api/invite/:id           claim a pairing invite (one-time)
 *   everything else           the PWA (static assets, SPA fallback)
 */
import { Household, type Env } from './household';
import { Invites } from './invites';

export { Household, Invites };

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, app: 'gila-hub', v: 1 }, { headers: { 'cache-control': 'no-store', ...SECURITY_HEADERS } });
    }

    const hh = url.pathname.match(/^\/api\/h\/([A-Za-z0-9_-]{16,64})\/[a-z]+$/);
    if (hh) {
      const stub = env.HOUSEHOLD.get(env.HOUSEHOLD.idFromName(hh[1]));
      return stub.fetch(req);
    }

    if (/^\/api\/invite\/[A-Za-z0-9_-]{16,64}$/.test(url.pathname)) {
      const stub = env.INVITES.get(env.INVITES.idFromName('invites'));
      return stub.fetch(req);
    }

    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'not found' }, { status: 404 });

    const res = await env.ASSETS.fetch(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    if (url.pathname === '/sw.js' || url.pathname === '/' || url.pathname.endsWith('.html')) headers.set('cache-control', 'no-cache');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  },
} satisfies ExportedHandler<Env>;

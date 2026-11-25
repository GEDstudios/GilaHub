/**
 * Web Push from a Cloudflare Worker using only WebCrypto:
 *  - VAPID (RFC 8292): ES256-signed JWT identifying this relay to push services.
 *  - Message encryption (RFC 8291 + RFC 8188 "aes128gcm"), so push services
 *    only ever see ciphertext. (The payload inside is *also* sealed with the
 *    household or personal key — the relay can't read it either.)
 */

const enc = new TextEncoder();

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (the browser's applicationServerKey). */
  publicKey: string;
  privateJwk: JsonWebKey;
}

export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicRaw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { publicKey: b64u(publicRaw), privateJwk };
}

/** `Authorization` header value for a push endpoint. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', { ...keys.privateJwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

export interface EncryptOptions {
  /** Inject for test vectors; random otherwise. */
  salt?: Uint8Array<ArrayBuffer>;
  /** Application-server ECDH key pair; ephemeral otherwise. */
  local?: { privateKey: CryptoKey; publicRaw: Uint8Array<ArrayBuffer> };
}

/** RFC 8291 encryption → a complete aes128gcm body (single record). */
export async function encryptPushPayload(
  plaintext: Uint8Array<ArrayBuffer>,
  sub: PushSub,
  opts: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));

  let local = opts.local;
  if (!local) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    local = { privateKey: pair.privateKey, publicRaw: new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer) };
  }

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // Standard WebCrypto field is `public` (workers-types spells it `$public`).
  const ecdhParams = { name: 'ECDH', public: uaKey } as unknown as Parameters<SubtleCrypto['deriveBits']>[0];
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, local.privateKey, 256));

  // HKDF (all outputs fit one SHA-256 block, so extract+expand = two HMACs each)
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, local.publicRaw);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const padded = concat(plaintext, new Uint8Array([2])); // 0x02: last (and only) record
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, padded));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([local.publicRaw.length]), local.publicRaw, ciphertext);
}

export interface SendResult {
  ok: boolean;
  status: number;
  /** Subscription is gone (404/410) — delete it. */
  gone: boolean;
}

export async function sendPush(
  sub: PushSub,
  payload: string,
  keys: VapidKeys,
  subject: string,
  opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string } = {},
): Promise<SendResult> {
  const body = await encryptPushPayload(new Uint8Array(enc.encode(payload)), sub);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, keys, subject),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 24 * 3600),
    Urgency: opts.urgency ?? 'normal',
  };
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  try {
    const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { ok: false, status: 0, gone: false };
  }
}

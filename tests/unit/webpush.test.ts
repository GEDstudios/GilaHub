import { createECDH, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { b64u, encryptPushPayload, generateVapidKeys, unb64u, vapidAuthorization } from '../../worker/webpush';

const require = createRequire(import.meta.url);
// Independent reference implementation (used by the popular `web-push` package).
const ece = require('http_ece') as { decrypt: (buf: Buffer, params: Record<string, unknown>) => Buffer };

/** Import a raw P-256 private scalar + public point as a WebCrypto ECDH key. */
async function importEcdhPrivate(d: string, pub: string): Promise<CryptoKey> {
  const p = unb64u(pub);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', d, x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), ext: true };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

describe('Web Push encryption (RFC 8291)', () => {
  it('reproduces the RFC 8291 §5 example exactly', async () => {
    const asPublic = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
    const local = {
      privateKey: await importEcdhPrivate('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', asPublic),
      publicRaw: unb64u(asPublic),
    };
    const body = await encryptPushPayload(
      new TextEncoder().encode('When I grow up, I want to be a watermelon'),
      {
        endpoint: 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV',
        keys: {
          p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
          auth: 'BTBZMqHH6r4Tts7J_aSIgg',
        },
      },
      { salt: unb64u('DGv6ra1nlYgDCS1FRnbzlw'), local },
    );
    expect(b64u(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('is decryptable by an independent implementation (http_ece)', async () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = randomBytes(16);
    const message = JSON.stringify({ k: 'h', c: 'sealed-by-the-household-key', t: 'Milk 🥛' });
    const body = await encryptPushPayload(new TextEncoder().encode(message), {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) },
    });
    const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ua, authSecret: b64u(auth) });
    expect(plain.toString('utf8')).toBe(message);
  });
});

describe('VAPID', () => {
  it('signs a verifiable ES256 JWT for the endpoint origin', async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization('https://web.push.apple.com/QGuQyavXutnMH', keys, 'https://gila.example', 1_800_000_000_000);
    const m = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
    expect(m).toBeTruthy();
    const [, h, c, sig, k] = m!;
    expect(k).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(unb64u(c)));
    expect(claims).toMatchObject({ aud: 'https://web.push.apple.com', sub: 'https://gila.example', exp: 1_800_000_000 + 12 * 3600 });
    const pub = await crypto.subtle.importKey('raw', unb64u(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(sig), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

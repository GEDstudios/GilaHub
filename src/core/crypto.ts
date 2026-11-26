/**
 * End-to-end encryption primitives (WebCrypto only — no dependencies).
 *
 *  - Every synced change is sealed with AES-256-GCM before it leaves the device.
 *  - The household key is shared by both partners; each person also has a personal
 *    key that never reaches the partner's devices ("Only me" items use it).
 *  - The relay server receives ciphertext plus an auth token derived one-way from the
 *    household key (HKDF), so it can gate access without being able to read anything.
 *  - Invite codes are stretched with PBKDF2 so a short code can't be brute-forced
 *    from what the server stores.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64u(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** 32 random bytes, base64url — used for household & personal keys. */
export function newKeyMaterial(): string {
  return toB64u(randomBytes(32));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

export function aesKey(material: string): Promise<CryptoKey> {
  let k = keyCache.get(material);
  if (!k) {
    k = crypto.subtle.importKey('raw', fromB64u(material), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    keyCache.set(material, k);
  }
  return k;
}

/** Seal any JSON value. Output: base64url(iv[12] || ciphertext+tag). */
export async function sealJSON(material: string, value: unknown, aad: string): Promise<string> {
  const key = await aesKey(material);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
    key,
    enc.encode(JSON.stringify(value)),
  );
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return toB64u(out);
}

export async function openJSON<T = unknown>(material: string, sealed: string, aad: string): Promise<T> {
  const key = await aesKey(material);
  const raw = fromB64u(sealed);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: enc.encode(aad) },
    key,
    raw.subarray(12),
  );
  return JSON.parse(dec.decode(pt)) as T;
}

/** One-way auth token for the relay: HKDF(householdKey, "gila-hub/auth"). */
export async function deriveAuthToken(householdKey: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', fromB64u(householdKey), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('gila-hub'), info: enc.encode('gila-hub/auth') },
    base,
    256,
  );
  return toB64u(bits);
}

/**
 * Stretch an 8-symbol invite code into (lookup id, encryption key).
 * Both come from the same PBKDF2 output, so the server-visible id doesn't
 * make brute-forcing the code any cheaper.
 */
export async function deriveInviteSecrets(code: string): Promise<{ inviteId: string; key: string }> {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('gila-hub/invite/v1'), iterations: 210_000 },
      base,
      384,
    ),
  );
  return { key: toB64u(bits.subarray(0, 32)), inviteId: toB64u(bits.subarray(32, 48)) };
}

/**
 * From a recovery code: the key that seals my keys, and the id they're kept under on the relay.
 * Stretched hard (the code is the only thing standing between the relay's copy and my keys).
 */
export async function deriveRecoverySecrets(code: string): Promise<{ recoveryId: string; key: string }> {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('gila-hub/recovery/v1'), iterations: 310_000 }, base, 384),
  );
  return { key: toB64u(bits.subarray(0, 32)), recoveryId: toB64u(bits.subarray(32, 48)) };
}

export async function sha256B64u(text: string): Promise<string> {
  return toB64u(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

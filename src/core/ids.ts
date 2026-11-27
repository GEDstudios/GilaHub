const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Random base62 id. 16 chars ≈ 95 bits of entropy — collision-free for our purposes. */
export function newId(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % 62];
  return out;
}

/** Human-friendly code alphabet: no 0/O, 1/I/L confusion. 31 symbols. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 8-symbol invite code, e.g. "K7QM2XPA" (~39.6 bits). Displayed as "K7QM-2XPA". */
export function newInviteCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 8; i++) {
    // Rejection sampling to avoid modulo bias.
    let b = bytes[i];
    while (b >= 248) {
      const r = new Uint8Array(1);
      crypto.getRandomValues(r);
      b = r[0];
    }
    out += CODE_ALPHABET[b % 31];
  }
  return out;
}

/** Normalizes user-typed codes: uppercase, strips spaces/dashes. */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function isValidInviteCode(code: string): boolean {
  return code.length === 8 && [...code].every((ch) => CODE_ALPHABET.includes(ch));
}

export function formatInviteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * A recovery code: 20 symbols from the code alphabet (~99 bits), shown as four groups of five,
 * "K7QM2-XPA9T-…". Written down once; it alone unlocks my keys from the relay.
 */
export function newRecoveryCode(): string {
  const out: string[] = [];
  while (out.length < 20) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    for (const b of bytes) if (b < 248 && out.length < 20) out.push(CODE_ALPHABET[b % 31]);
  }
  return out.join('');
}

export function isValidRecoveryCode(code: string): boolean {
  return code.length === 20 && [...code].every((ch) => CODE_ALPHABET.includes(ch));
}

export function formatRecoveryCode(code: string): string {
  return code.replace(/(.{5})(?=.)/g, '$1-');
}

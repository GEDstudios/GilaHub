/**
 * Fractional indexing (after Greenspan / rocicorp "fractional-indexing").
 * Keys are strings that sort with plain `<`. You can always generate a key between
 * any two keys, so reordering touches exactly one item — ideal for sync.
 * Keys: integer part (head letter encodes its length) + optional fraction.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0];
const SMALLEST_INT = 'A' + ZERO.repeat(26);

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (b) {
    let n = 0;
    while ((a[n] || ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))];
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  throw new Error(`invalid order key head: ${head}`);
}

function integerPart(key: string): string {
  const len = integerLength(key[0]);
  if (len > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, len);
}

function incrementInteger(x: string): string | null {
  const [head, ...digs] = x.split('');
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1;
    if (d === DIGITS.length) digs[i] = ZERO;
    else {
      digs[i] = DIGITS[d];
      carry = false;
    }
  }
  if (!carry) return head + digs.join('');
  if (head === 'Z') return 'a' + ZERO;
  if (head === 'z') return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > 'a') digs.push(ZERO);
  else digs.pop();
  return h + digs.join('');
}

function decrementInteger(x: string): string | null {
  const [head, ...digs] = x.split('');
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1;
    if (d === -1) digs[i] = DIGITS[DIGITS.length - 1];
    else {
      digs[i] = DIGITS[d];
      borrow = false;
    }
  }
  if (!borrow) return head + digs.join('');
  if (head === 'a') return 'Z' + DIGITS[DIGITS.length - 1];
  if (head === 'A') return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < 'Z') digs.push(DIGITS[DIGITS.length - 1]);
  else digs.pop();
  return h + digs.join('');
}

/** A key strictly between `a` and `b` (either may be null = open end). */
export function keyBetween(a: string | null | undefined, b: string | null | undefined): string {
  const lo = a ?? null;
  const hi = b ?? null;
  if (lo !== null && hi !== null && lo >= hi) {
    // Concurrent edits can produce equal keys; fall back to "just after a".
    return keyBetween(lo, null);
  }
  if (lo === null) {
    if (hi === null) return 'a' + ZERO;
    const ib = integerPart(hi);
    const fb = hi.slice(ib.length);
    if (ib === SMALLEST_INT) return ib + midpoint('', fb);
    if (ib < hi) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new Error('cannot decrement any more');
    return res;
  }
  if (hi === null) {
    const ia = integerPart(lo);
    const fa = lo.slice(ia.length);
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }
  const ia = integerPart(lo);
  const fa = lo.slice(ia.length);
  const ib = integerPart(hi);
  const fb = hi.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i === null) throw new Error('cannot increment any more');
  if (i < hi) return i;
  return ia + midpoint(fa, null);
}

/** Sort comparator: order key, then id for deterministic ties. */
export function byOrder<T extends { order: string; id: string }>(x: T, y: T): number {
  if (x.order < y.order) return -1;
  if (x.order > y.order) return 1;
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
}

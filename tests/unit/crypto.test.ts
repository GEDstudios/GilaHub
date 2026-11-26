import { describe, expect, it } from 'vitest';
import {
  deriveAuthToken,
  deriveInviteSecrets,
  deriveRecoverySecrets,
  fromB64u,
  newKeyMaterial,
  openJSON,
  sealJSON,
  toB64u,
} from '../../src/core/crypto';
import {
  formatInviteCode,
  formatRecoveryCode,
  isValidInviteCode,
  isValidRecoveryCode,
  newInviteCode,
  newRecoveryCode,
  normalizeInviteCode,
} from '../../src/core/ids';

describe('crypto', () => {
  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect([...fromB64u(toB64u(bytes))]).toEqual([...bytes]);
  });

  it('seals and opens JSON', async () => {
    const key = newKeyMaterial();
    const sealed = await sealJSON(key, { title: 'מלפפונים', n: 3 }, 'hh|h');
    expect(sealed).not.toContain('מלפפונים');
    expect(await openJSON(key, sealed, 'hh|h')).toEqual({ title: 'מלפפונים', n: 3 });
  });

  it('rejects the wrong key or the wrong context', async () => {
    const key = newKeyMaterial();
    const sealed = await sealJSON(key, { a: 1 }, 'hh|h');
    await expect(openJSON(newKeyMaterial(), sealed, 'hh|h')).rejects.toBeTruthy();
    await expect(openJSON(key, sealed, 'hh|p:guy')).rejects.toBeTruthy();
  });

  it('derives a stable auth token that is not the key', async () => {
    const key = newKeyMaterial();
    const t1 = await deriveAuthToken(key);
    expect(t1).toBe(await deriveAuthToken(key));
    expect(t1).not.toBe(key);
  });

  it('derives invite secrets deterministically', async () => {
    const a = await deriveInviteSecrets('K7QM2XPA');
    const b = await deriveInviteSecrets('K7QM2XPA');
    const c = await deriveInviteSecrets('K7QM2XPB');
    expect(a).toEqual(b);
    expect(a.inviteId).not.toBe(c.inviteId);
  });

  it('makes friendly invite codes', () => {
    const code = newInviteCode();
    expect(isValidInviteCode(code)).toBe(true);
    expect(normalizeInviteCode(` ${formatInviteCode(code).toLowerCase()} `)).toBe(code);
  });
});

describe('Recovery codes', () => {
  it('are 20 easy symbols, shown in four groups, typed back any way', () => {
    const code = newRecoveryCode();
    expect(isValidRecoveryCode(code)).toBe(true);
    const shown = formatRecoveryCode(code);
    expect(shown).toMatch(/^[2-9A-Z]{5}(-[2-9A-Z]{5}){3}$/);
    expect(normalizeInviteCode(` ${shown.toLowerCase()} `)).toBe(code);
    expect(new Set(Array.from({ length: 50 }, newRecoveryCode)).size).toBe(50);
  });

  it('the same code always finds and opens the same locked keys; another code can’t', async () => {
    const code = newRecoveryCode();
    const a = await deriveRecoverySecrets(code);
    const b = await deriveRecoverySecrets(code);
    expect(a).toEqual(b);
    const blob = await sealJSON(a.key, { memberId: 'guy', personalKey: 'k' }, 'gila-hub/recovery');
    expect(await openJSON(b.key, blob, 'gila-hub/recovery')).toEqual({ memberId: 'guy', personalKey: 'k' });
    const other = await deriveRecoverySecrets(newRecoveryCode());
    expect(other.recoveryId).not.toBe(a.recoveryId);
    await expect(openJSON(other.key, blob, 'gila-hub/recovery')).rejects.toBeTruthy();
  }, 20000);
});

import { describe, expect, it } from 'vitest';
import { deriveRecoverySecrets, openJSON, sealJSON } from '../../src/core/crypto';
import { formatRecoveryCode, isValidRecoveryCode, newRecoveryCode, normalizeInviteCode } from '../../src/core/ids';

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

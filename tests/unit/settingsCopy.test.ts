import { describe, expect, it } from 'vitest';
import { backupSub, needsBackup, syncLabel, syncTitle, togetherSince, usSentence } from '../../src/app/settingsCopy';

describe('Settings copy', () => {
  const now = new Date(2026, 10, 25, 12).getTime();

  it('the card says who we are and since when', () => {
    expect(usSentence(null, now)).toBe('Just you for now.');
    expect(usSentence({ name: 'Hila', createdAt: new Date(2026, 10, 2).getTime() }, now)).toBe('You and Hila · together since November');
    expect(togetherSince(new Date(2025, 2, 9).getTime(), now)).toBe('March 2025');
  });

  it('the sync pill', () => {
    expect(syncLabel('synced')).toBe('Synced');
    expect(syncLabel('connecting')).toBe('Syncing…');
    expect(syncLabel('local')).toBe('This phone');
    expect(syncLabel('local', true)).toBe('This device');
    expect(syncLabel('offline')).toBe('Offline');
  });

  it('backups: when the last one was, and when to nudge', () => {
    expect(backupSub(null, now)).toBe('Not yet');
    expect(backupSub(now - 12 * 86_400_000, now)).toBe('Last one: 2 wk ago');
    expect(backupSub(now - 3 * 86_400_000, now)).toBe('Last one: 3 days ago');
    expect(needsBackup(null, now)).toBe(true);
    expect(needsBackup(now - 3 * 86_400_000, now)).toBe(false);
    expect(needsBackup(now - 8 * 86_400_000, now)).toBe(true);
  });

  it('give the sync dot a human title everywhere', () => {
    expect(syncTitle('synced')).toBe('Synced');
    expect(syncTitle('local')).toBe('On this device only');
    expect(syncTitle('offline')).toBe('Offline · saved on this device');
    expect(syncTitle('connecting')).toBe('Syncing');
    expect(syncTitle('syncing')).toBe('Syncing');
  });
});

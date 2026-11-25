import { dateOfMs, diffDays, fromDateStr, relativeAgo, type DateStr } from '../core/dates';
import type { SyncStatus } from '../core/sync';

/**
 * The words Settings says about state (pure, for tests). Short and warm; no technical words.
 */

const MONTH = (d: Date) => d.toLocaleDateString('en', { month: 'long' });
const SHORT = (d: Date) => d.toLocaleDateString('en', { day: 'numeric', month: 'short' });
const WEEKDAY = (d: Date) => d.toLocaleDateString('en', { weekday: 'short' });

/** "November", or "November 2025" when it wasn't this year. */
export function togetherSince(createdAt: number, now = Date.now()): string {
  const d = new Date(createdAt);
  return d.getFullYear() === new Date(now).getFullYear() ? MONTH(d) : `${MONTH(d)} ${d.getFullYear()}`;
}

/** The card's one line about us. */
export function usSentence(partner: { name: string; createdAt: number } | null, now = Date.now()): string {
  return partner ? `You and ${partner.name} · together since ${togetherSince(partner.createdAt, now)}` : 'Just you for now.';
}

/** The sync pill on the profile card. */
export function syncLabel(status: SyncStatus, wide = false): string {
  if (status === 'synced') return 'Synced';
  if (status === 'offline') return 'Offline';
  if (status === 'local') return wide ? 'This device' : 'This phone';
  return 'Syncing…';
}

/** The sync dot's title, wherever it shows (my avatar, the sidebar's Settings). */
export function syncTitle(status: SyncStatus): string {
  if (status === 'synced') return 'Synced';
  if (status === 'local') return 'On this device only';
  if (status === 'offline') return 'Offline · saved on this device';
  return 'Syncing';
}

/** Read aloud on the pill: what it says, and what a tap does. */
export function syncAria(status: SyncStatus, lastSyncedAt: number, now = Date.now()): string {
  if (status === 'synced') return `Synced ${lastSyncedAt ? relativeAgo(lastSyncedAt, now) : 'just now'}. Tap to sync now.`;
  if (status === 'local') return 'On this device only. Tap to look for your hub.';
  if (status === 'offline') return 'Offline. Changes are saved here and sync later. Tap to try now.';
  return 'Syncing. Tap to sync now.';
}

/** "Last one: 12 days ago", or "Not yet". */
export function backupSub(lastBackupAt: number | null, now = Date.now()): string {
  if (!lastBackupAt) return 'Not yet';
  const weeks = (now - lastBackupAt) / (7 * 86_400_000);
  return `Last one: ${weeks < 5 ? relativeAgo(lastBackupAt, now) : SHORT(new Date(lastBackupAt))}`;
}

/** Before resetting a device: no backup, or none for a week. */
export function needsBackup(lastBackupAt: number | null, now = Date.now()): boolean {
  return !lastBackupAt || now - lastBackupAt > 7 * 86_400_000;
}

/** Away mode's line: what it does when off; since when, and who, when on. */
export function awaySub(away: { since: DateStr; by: string | null } | null, me: string, partnerName: string | null, ref: DateStr = dateOfMs(Date.now())): string {
  if (!away) return 'Pause chore clocks while you’re both away';
  const days = diffDays(away.since, ref);
  const d = fromDateStr(away.since);
  const when = days <= 0 ? 'today' : days < 7 ? WEEKDAY(d) : SHORT(d);
  const who = away.by && away.by !== me && partnerName ? ` · ${partnerName} turned it on` : '';
  return `Since ${when} · chores are paused${who}`;
}

/** Turning Away mode on (from Settings or from Chores). */
export const AWAY_ON = 'Chores paused. Have a good trip.';

/** Coming back: how far the chore clocks moved. */
export function welcomeBack(since: DateStr | null | undefined, ref: DateStr = dateOfMs(Date.now())): string {
  const days = since ? Math.max(0, diffDays(since, ref)) : 0;
  return days ? `Welcome back. Chores moved by ${days} ${days === 1 ? 'day' : 'days'}.` : 'Welcome back.';
}

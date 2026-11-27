import { setPrefs } from '../../prefs';
import type { Runtime } from '../../runtime';
import { useOverlays } from '../../ui/overlays';

export type Toast = ReturnType<typeof useOverlays>['toast'];

export function exportData(rt: Runtime) {
  const tables = ['member', 'list', 'item', 'log', 'memory', 'store', 'settings', 'idea', 'moment', 'tag'] as const;
  const data: Record<string, unknown[]> = {};
  for (const t of tables) data[t] = rt.store.all(t);
  // `me`: whose backup it is, so restoring it on a new device makes those things mine again.
  const blob = new Blob([JSON.stringify({ app: 'gila-hub', v: 2, me: rt.session.memberId, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gila-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Download a backup and remember when (this device), for the sub-line and the reset nudge. */
export function downloadBackup(rt: Runtime, toast: Toast) {
  exportData(rt);
  setPrefs({ lastBackupAt: Date.now() });
  toast('Backup saved. Keep it somewhere safe.');
}

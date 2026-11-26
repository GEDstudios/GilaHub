import type { Hub } from '../core/actions';
import { applyPrefs, DEVICE_ONLY, getPrefs, PREF_KEYS, setPrefsWriter, type Prefs } from './prefs';

/**
 * My preferences follow me, not the phone: they live in one record sealed with my personal key
 * (my person can't read it), one field per preference, so changes on two of my devices merge
 * like everything else (the newest per field wins).
 *
 * The first time (an app from before this), what this device had becomes mine everywhere. On a
 * device that joins later, what's in the record wins. Call once the first sync has run, so a new
 * device doesn't stamp its defaults over what I already have.
 */
export function bindUserPrefs(hub: Hub): () => void {
  const id = `prefs:${hub.meId}`;
  const synced = PREF_KEYS.filter((k) => !DEVICE_ONLY.includes(k));
  const pick = (from: Partial<Prefs>) => Object.fromEntries(synced.filter((k) => k in from).map((k) => [k, from[k] ?? null])) as Partial<Prefs>;
  const write = (patch: Partial<Prefs>) => {
    const fields = pick(patch);
    if (Object.keys(fields).length) hub.store.mutate('settings', id, fields as never);
  };

  if (!hub.store.record('settings', id)) {
    hub.store.init('settings', id, `p:${hub.meId}`);
    write(getPrefs());
  }

  const pull = () => {
    const rec = hub.store.get('settings', id) as Record<string, unknown> | undefined;
    if (!rec) return;
    const now = getPrefs();
    const patch: Partial<Prefs> = {};
    for (const k of synced) {
      if (!(k in rec) || rec[k] === undefined) continue;
      if (JSON.stringify(rec[k]) !== JSON.stringify(now[k])) (patch as Record<string, unknown>)[k] = rec[k];
    }
    if (Object.keys(patch).length) applyPrefs(patch);
  };
  pull();
  setPrefsWriter(write);
  const off = hub.store.subscribe(pull);
  return () => {
    off();
    setPrefsWriter(null);
  };
}

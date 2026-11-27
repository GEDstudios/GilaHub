import type { Hub } from '../core/hub';
import type { Item } from '../core/model';
import { getPrefs, setPrefs } from './prefs';

/**
 * Highlights: a handful of tasks I chose to keep in sight on Today, from any folder, whatever
 * their dates. Mine alone (in my prefs, which follow me to my devices; my person never sees it).
 */
export const isHighlight = (id: string, quick: readonly string[] = getPrefs().quick) => quick.includes(id);

/** In or out; returns the undo. */
export function setHighlight(id: string, on: boolean): () => void {
  const before = getPrefs().quick;
  const rest = before.filter((x) => x !== id);
  setPrefs({ quick: on ? [...rest, id] : rest });
  return () => setPrefs({ quick: before });
}

/** What's in it now: live, open and in my sight (a ticked one comes back if it's unticked, or when it repeats). */
export function highlights(hub: Hub, quick: readonly string[] = getPrefs().quick): Item[] {
  return quick.map((id) => hub.item(id)).filter((i): i is Item => !!i && !i.archived && !i.done && hub.isLive(i.listId));
}

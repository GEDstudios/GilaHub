import type { Hub } from '../core/actions';
import type { LineColor } from '../core/model';
import type { Route } from './router';
import type { IconName } from './ui/Icon';
import { listKey, listIdOf } from '../core/keys';

/**
 * Between Today and Projects you pin as many as you like: Search or any project. Past 5 tabs the
 * bar goes icons-only, past 7 it docks and scrolls (barDensity), and holding it lets you slide to
 * pick. 24 is a sanity cap, not a design limit.
 */
export const MAX_PINS = 24;
/** As stored: 'shop' is the Shopping project (from when it was a tab of its own). */
export const DEFAULT_PINS = ['shop'];
/** Tabs that still fit with their labels. */
export const COMFY_TABS = 5;

export interface TabDef {
  key: string;
  label: string;
  path: string;
  icon?: IconName;
  color?: LineColor;
  /** A project's own icon ("i:<name>" or an emoji). */
  glyph?: string;
}

/**
 * How the bar lays out n tabs (Today and Projects included):
 *   comfy  up to 5: icon and label
 *   snug   6–7: icons only, the active tab shows its label
 *   dock   8 or more: Today and Projects stay put around a scrolling middle
 * While it is being arranged every tab keeps its label, so it is an equal grid up to 6 slots
 * and a dock from 7 (`n` counts the gap a drag would land in).
 */
export type BarDensity = 'comfy' | 'snug' | 'dock';

export function barDensity(n: number, { editing = false }: { editing?: boolean } = {}): BarDensity {
  if (editing) return n <= 6 ? 'comfy' : 'dock';
  if (n <= COMFY_TABS) return 'comfy';
  return n <= 7 ? 'snug' : 'dock';
}

export function pinOptions(hub: Hub): TabDef[] {
  const lists = hub.lists();
  return [
    { key: 'search', label: 'Search', path: '/search', icon: 'search' },
    ...lists.map((l) => ({ key: listKey(l.id), label: l.name, path: `/l/${l.id}`, color: l.color, glyph: l.icon })),
  ];
}


/** Known keys only, each once, in order, at most MAX_PINS (pure, for tests). */
export function cleanPins(raw: readonly string[], valid: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  for (const k of raw) {
    if (seen.size >= MAX_PINS) break;
    if (valid.has(k)) seen.add(k);
  }
  return [...seen];
}

const validKeys = (hub: Hub) => new Set(pinOptions(hub).map((t) => t.key));

/** A stored 'shop' (the old Shopping tab) is the Shopping project's pin. */
const resolved = (hub: Hub, raw: readonly string[]): string[] => {
  const root = hub.shopRoot();
  return raw.map((k) => (k === 'shop' ? (root ? listKey(root.id) : '') : k));
};

export function pinsOf(hub: Hub): string[] {
  return cleanPins(resolved(hub, hub.me()?.tabs ?? DEFAULT_PINS), validKeys(hub));
}

/**
 * `next` with the stored entries it can't show back in their places: each goes right after the
 * nearest entry before it that is still there (pure, for tests). Writes keep pins to dormant
 * projects (Hub.listDormant), so archiving and restoring one doesn't lose them.
 */
export function keepDormant<T>(raw: readonly T[], next: readonly T[], key: (t: T) => string, keep: (t: T) => boolean): T[] {
  const out = [...next];
  const have = new Set(out.map(key));
  raw.forEach((r, i) => {
    if (have.has(key(r)) || !keep(r)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((o) => key(o) === key(raw[j]));
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, r);
    have.add(key(r));
  });
  return out;
}

const dormantKey = (hub: Hub) => (k: string) => { const id = listIdOf(k); return !!id && hub.listDormant(id); };

export function setPins(hub: Hub, pins: string[]): void {
  const raw = resolved(hub, (hub.me()?.tabs ?? []).filter((k): k is string => typeof k === 'string'));
  hub.upsertMember(hub.meId, { tabs: keepDormant(raw, cleanPins(resolved(hub, pins), validKeys(hub)), (k) => k, dormantKey(hub)) });
}

/**
 * `key` taken out of `pins` (if there) and put back at `at`, an index among the pins left
 * (clamped). A new key on a full bar changes nothing (pure, for tests).
 */
export function placePin(pins: readonly string[], key: string, at: number): string[] {
  if (!pins.includes(key) && pins.length >= MAX_PINS) return [...pins];
  const out = pins.filter((k) => k !== key);
  out.splice(Math.min(Math.max(Math.round(at), 0), out.length), 0, key);
  return out;
}

/** Pin `key` at `at` (or move it there); returns the pins before, for Undo. */
export function pinAt(hub: Hub, key: string, at: number): string[] {
  const before = pinsOf(hub);
  setPins(hub, placePin(before, key, at));
  return before;
}

/** Pin or unpin; returns whether it is pinned now. New pins go last, just before Projects. */
export function togglePin(hub: Hub, key: string): boolean {
  const pins = pinsOf(hub);
  if (pins.includes(key)) {
    setPins(hub, pins.filter((k) => k !== key));
    return false;
  }
  setPins(hub, [...pins, key]);
  return pinsOf(hub).includes(key);
}

/** The whole bar: Today, your pins, Projects. */
export function tabsOf(hub: Hub): TabDef[] {
  const opts = new Map(pinOptions(hub).map((t) => [t.key, t]));
  return [
    { key: 'today', label: 'Today', path: '/', icon: 'sun' },
    ...pinsOf(hub).map((k) => opts.get(k)!),
    { key: 'projects', label: 'Folders', path: '/lists', icon: 'folders' },
  ];
}

/** Which tab lights up for a route. */
export function activeTabKey(hub: Hub, r: Route): string | null {
  const pins = pinsOf(hub);
  const forList = (listId: string | undefined): string => {
    if (!listId) return 'projects';
    // Itself, or the nearest project it's inside that's in the bar.
    for (const l of [hub.list(listId), ...[...hub.listPath(listId)].reverse()]) if (l && pins.includes(listKey(l.id))) return listKey(l.id);
    return 'projects';
  };
  switch (r.name) {
    case 'today':
      return 'today';
    case 'shop':
      return forList(hub.shopRoot()?.id);
    case 'chores':
    case 'lists':
      return 'projects';
    case 'list':
      return forList(r.id);
    case 'item':
      return forList(hub.item(r.id)?.listId);
    default:
      return null;
  }
}

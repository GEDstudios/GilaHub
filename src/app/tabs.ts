import type { Hub } from '../core/actions';
import type { LineColor } from '../core/model';
import type { Route } from './router';
import type { IconName } from './ui/Icon';

/**
 * Between Today and Projects you pin as many as you like: Shopping, Chores, Search or any
 * project. Past 5 tabs the bar goes icons-only, past 7 it docks and scrolls (barDensity), and
 * holding it lets you slide to pick. 24 is a sanity cap, not a design limit.
 */
export const MAX_PINS = 24;
export const DEFAULT_PINS = ['shop', 'chores'];
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
 */
export type BarDensity = 'comfy' | 'snug' | 'dock';

export function barDensity(n: number): BarDensity {
  if (n <= COMFY_TABS) return 'comfy';
  return n <= 7 ? 'snug' : 'dock';
}

export function pinOptions(hub: Hub): TabDef[] {
  return [
    { key: 'shop', label: 'Shopping', path: '/shop', icon: 'basket' },
    { key: 'chores', label: 'Chores', path: '/chores', icon: 'sparkle' },
    { key: 'search', label: 'Search', path: '/search', icon: 'search' },
    ...hub.lists().map((l) => ({ key: `l:${l.id}`, label: l.name, path: `/l/${l.id}`, color: l.color, glyph: l.icon })),
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

export function pinsOf(hub: Hub): string[] {
  return cleanPins(hub.me()?.tabs ?? DEFAULT_PINS, validKeys(hub));
}

/** Is the bar as it came? (Settings offers "Back to the default" only when not.) */
export function isDefaultPins(pins: readonly string[]): boolean {
  return pins.join() === DEFAULT_PINS.join();
}

export function setPins(hub: Hub, pins: string[]): void {
  hub.upsertMember(hub.meId, { tabs: cleanPins(pins, validKeys(hub)) });
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
    { key: 'projects', label: 'Projects', path: '/lists', icon: 'folders' },
  ];
}

/** Which tab lights up for a route. */
export function activeTabKey(hub: Hub, r: Route): string | null {
  const pins = pinsOf(hub);
  const forList = (listId: string | undefined): string => {
    if (!listId) return 'projects';
    if (pins.includes(`l:${listId}`)) return `l:${listId}`;
    const kind = hub.list(listId)?.kind;
    if (kind === 'shopping' && pins.includes('shop')) return 'shop';
    if (kind === 'chores' && pins.includes('chores')) return 'chores';
    return 'projects';
  };
  switch (r.name) {
    case 'today':
      return 'today';
    case 'shop':
      return 'shop';
    case 'chores':
      return 'chores';
    case 'search':
      return 'search';
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

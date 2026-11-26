import type { Hub } from '../core/actions';
import { fold } from '../smart/normalize';
import type { LineColor, List } from '../core/model';
import type { Route } from './router';
import type { IconName } from './ui/Icon';

/**
 * Between Today and Projects you pin as many as you like: Shopping, Chores, Search or any
 * project. Past 5 tabs the bar goes icons-only, past 7 it docks and scrolls (barDensity), and
 * holding it lets you slide to pick. 24 is a sanity cap, not a design limit.
 */
export const MAX_PINS = 24;
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
  // A project called "Chores" beside other chores projects: the tab says it gathers them all.
  // When it's the only one, tab and project are the same thing, so the tab is just "Chores".
  const label = (name: string, kind: List['kind']) =>
    lists.some((l) => fold(l.name) === fold(name)) && lists.filter((l) => l.kind === kind).length > 1 ? `All ${name.toLowerCase()}` : name;
  return [
    { key: 'shop', label: label('Shopping', 'shopping'), path: '/shop', icon: 'basket' },
    { key: 'search', label: 'Search', path: '/search', icon: 'search' },
    ...lists.map((l) => ({ key: `l:${l.id}`, label: l.name, path: `/l/${l.id}`, color: l.color, glyph: l.icon })),
  ];
}

/**
 * A project the Shopping or Chores tab already shows: the only one of its kind, with that tab
 * in the bar. The bar's tray and the sidebar don't offer it a second time (it stays a project).
 */
export function coveredByTab(hub: Hub, listId: string, pins: readonly string[] = pinsOf(hub)): boolean {
  const kind = hub.list(listId)?.kind;
  const tab = kind === 'shopping' ? 'shop' : null;
  return !!tab && pins.includes(tab) && hub.lists().filter((l) => l.kind === kind).length === 1;
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

const dormantKey = (hub: Hub) => (k: string) => k.startsWith('l:') && hub.listDormant(k.slice(2));

export function setPins(hub: Hub, pins: string[]): void {
  const raw = (hub.me()?.tabs ?? []).filter((k): k is string => typeof k === 'string');
  hub.upsertMember(hub.meId, { tabs: keepDormant(raw, cleanPins(pins, validKeys(hub)), (k) => k, dormantKey(hub)) });
}

/** "Back to the default": really the default, archived pins and all. Undo puts back what was stored. */
export function resetPins(hub: Hub): () => void {
  const raw = hub.me()?.tabs;
  hub.upsertMember(hub.meId, { tabs: [...DEFAULT_PINS] });
  return () => hub.upsertMember(hub.meId, { tabs: raw });
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
    return 'projects';
  };
  switch (r.name) {
    case 'today':
      return 'today';
    case 'shop':
      return 'shop';
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

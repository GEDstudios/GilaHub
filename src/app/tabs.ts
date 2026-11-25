import type { Hub } from '../core/actions';
import type { LineColor } from '../core/model';
import type { Route } from './router';
import type { IconName } from './ui/Icon';

/** Between Today and Projects you choose up to three: Shopping, Chores, or any project. */
export const MAX_PINS = 3;
export const DEFAULT_PINS = ['shop', 'chores'];

export interface TabDef {
  key: string;
  label: string;
  path: string;
  icon?: IconName;
  color?: LineColor;
}

export function pinOptions(hub: Hub): TabDef[] {
  return [
    { key: 'shop', label: 'Shopping', path: '/shop', icon: 'bag' },
    { key: 'chores', label: 'Chores', path: '/chores', icon: 'sparkle' },
    ...hub.lists().map((l) => ({ key: `l:${l.id}`, label: l.name, path: `/l/${l.id}`, color: l.color })),
  ];
}

export function pinsOf(hub: Hub): string[] {
  const raw = hub.me()?.tabs ?? DEFAULT_PINS;
  const valid = new Set(pinOptions(hub).map((t) => t.key));
  return raw.filter((k) => valid.has(k)).slice(0, MAX_PINS);
}

export function setPins(hub: Hub, pins: string[]): void {
  hub.upsertMember(hub.meId, { tabs: pins.slice(0, MAX_PINS) });
}

export function togglePin(hub: Hub, key: string): boolean {
  const pins = pinsOf(hub);
  if (pins.includes(key)) {
    setPins(hub, pins.filter((k) => k !== key));
    return false;
  }
  if (pins.length >= MAX_PINS) return false;
  setPins(hub, [...pins, key]);
  return true;
}

/** The whole bar: Today, your pins, Projects. */
export function tabsOf(hub: Hub): TabDef[] {
  const opts = new Map(pinOptions(hub).map((t) => [t.key, t]));
  return [
    { key: 'today', label: 'Today', path: '/', icon: 'sun' },
    ...pinsOf(hub).map((k) => opts.get(k)!),
    { key: 'projects', label: 'Projects', path: '/lists', icon: 'lines' },
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

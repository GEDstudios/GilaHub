import { useSyncExternalStore } from 'react';
import { prefersDayFirst, weekStartsOn } from '../core/dates';

/**
 * My conveniences: how I like things (views, filters, what's open, sounds…). They're mine, not
 * this phone's: kept in a record only I can read and synced to all my devices (userPrefs.ts).
 * Only DEVICE_ONLY stays on the device. Never needed for correctness.
 */
export interface Prefs {
  h24: boolean | null;
  weekStart: 0 | 1 | null;
  badge: boolean;
  shoppingAlerts: boolean;
  lastList: string | null;
  shopFilter: string;
  /** Buy-again dismissals: item key → lastAt it was dismissed for. */
  dismissed: Record<string, number>;
  /** Show the done section in lists. */
  showDone: Record<string, boolean>;
  /** Vibrate on ticks, drags and picks (this device only). */
  haptics: boolean;
  /** Today: "n from earlier" is open. */
  earlierOpen: boolean;
  /** Today: what my person asked of me is open (it waits folded; it's rarely for right now). */
  asksOpen: boolean;
  /** Tasks whose subtasks are unfolded in lists (this device). */
  unfolded: string[];
  /** Today: the invite card stays away until then (ms; 0 = shown). */
  inviteHiddenUntil: number;
  /** When this device last downloaded a backup (ms), for Settings and the reset nudge. */
  lastBackupAt: number | null;
  /** The floating Ideas tag (the sheet stays reachable from Settings either way). */
  ideasTag: boolean;
  /** Small sounds on ticks, adds, drops and finished moments (this device only). */
  sounds: boolean;
  /** Today's "Waiting on you": only what's urgent (the rest one tap away). */
  asksUrgentOnly: boolean;
  /** A computer's cursor that leans, bounces and waves (null: on, unless motion is turned down). */
  livelyCursor: boolean | null;
  /** A project's tasks as a list, or as a grid of cards (this device). */
  taskView: 'list' | 'cards';
  /** The shopping as a list, or as cards (this device). */
  shopView: 'list' | 'cards';
  /** Each screen's filter ("today", "shop", "l:<id>"): tags, for whom, urgent only. */
  filters: Record<string, { tags: string[]; who: 'me' | 'partner' | null; urgent: boolean; lists?: string[] }>;
  /** Where something new from Today (or anywhere not in a folder) goes: my To-Do, or our last shared folder. */
  todayNew: 'mine' | 'ours';
  /** Today shows all of it, just mine, or just ours. */
  todayScope: 'all' | 'mine' | 'ours';
  /** My Highlights on Today: the tasks I put there, in the order I did. */
  quick: string[];
  /** Groups I folded on a folder's page ("<page>|<group>": a folder inside, a tag, one shown from elsewhere). */
  foldedGroups: string[];
  /** My order of a folder page's groups as lists (page id → group keys). Never the folders' own order. */
  groupOrder: Record<string, string[]>;
}

/** About this device itself, not about me: never synced. */
export const DEVICE_ONLY: ReadonlyArray<keyof Prefs> = ['lastBackupAt'];

const KEY = 'gila-hub:prefs';
const DEFAULTS: Prefs = {
  h24: null,
  weekStart: null,
  badge: false,
  shoppingAlerts: true,
  lastList: null,
  shopFilter: 'all',
  dismissed: {},
  showDone: {},
  haptics: true,
  earlierOpen: false,
  asksOpen: false,
  unfolded: [],
  inviteHiddenUntil: 0,
  lastBackupAt: null,
  ideasTag: true,
  sounds: true,
  asksUrgentOnly: false,
  livelyCursor: null,
  taskView: 'list',
  shopView: 'list',
  filters: {},
  todayNew: 'mine',
  todayScope: 'all',
  quick: [],
  foldedGroups: [],
  groupOrder: {},
};

export const PREF_KEYS = Object.keys(DEFAULTS) as Array<keyof Prefs>;

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: Prefs = read();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return current;
}

/** Where my changes go to reach my other devices (userPrefs.ts sets it once I'm known). */
let writer: ((patch: Partial<Prefs>) => void) | null = null;
export function setPrefsWriter(fn: ((patch: Partial<Prefs>) => void) | null): void {
  writer = fn;
}

/** Change mine: here at once, and on my other devices. */
export function setPrefs(patch: Partial<Prefs>): void {
  applyPrefs(patch);
  writer?.(patch);
}

/** Take what came from my other devices (here only; it's already everywhere else). */
export function applyPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode — keep in memory */
  }
  for (const fn of listeners) fn();
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

const locale = () => (typeof navigator !== 'undefined' ? navigator.language : 'en-IL');
const inIsrael = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Jerusalem';
  } catch {
    return false;
  }
};

/** 24-hour clock unless this device chose 12 in Settings. */
export function use24h(p: Prefs = current): boolean {
  return p.h24 ?? true;
}

export function weekStart(p: Prefs = current): 0 | 1 {
  if (p.weekStart !== null) return p.weekStart;
  return inIsrael() ? 0 : weekStartsOn(locale());
}

export function dayFirst(): boolean {
  return inIsrael() || prefersDayFirst(locale());
}

/** Working days: Israel works Sunday–Thursday. */
export function workdays(): number[] {
  return inIsrael() || /-IL$/i.test(locale()) || /^he/i.test(locale()) ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
}

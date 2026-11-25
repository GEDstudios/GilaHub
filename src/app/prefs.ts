import { useSyncExternalStore } from 'react';
import { prefersDayFirst, weekStartsOn } from '../core/dates';

/** Device-local conveniences (never synced, never needed for correctness). */
export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  h24: boolean | null;
  weekStart: 0 | 1 | null;
  badge: boolean;
  shoppingAlerts: boolean;
  emoji: boolean;
  lastList: string | null;
  shopFilter: string;
  /** Buy-again dismissals: item key → lastAt it was dismissed for. */
  dismissed: Record<string, number>;
  /** Show the done section in lists. */
  showDone: Record<string, boolean>;
}

const KEY = 'gila-hub:prefs';
const DEFAULTS: Prefs = {
  theme: 'system',
  h24: null,
  weekStart: null,
  badge: false,
  shoppingAlerts: true,
  emoji: true,
  lastList: null,
  shopFilter: 'all',
  dismissed: {},
  showDone: {},
};

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

export function setPrefs(patch: Partial<Prefs>): void {
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

export function use24h(p: Prefs = current): boolean {
  if (p.h24 !== null) return p.h24;
  try {
    const parts = new Intl.DateTimeFormat(locale(), { hour: 'numeric' }).formatToParts(new Date(2020, 0, 1, 15));
    return !parts.some((x) => x.type === 'dayPeriod');
  } catch {
    return true;
  }
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

export function applyTheme(theme: Prefs['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0c0c09' : '#fafafa');
}

import { useSyncExternalStore } from 'react';

/**
 * Search is a layer over the page you're on, not a page (components/SearchLayer.tsx). Anything
 * that used to go to /search (the header button, a pinned Search tab, the "/" key, the sidebar,
 * an old link) opens it here instead.
 */
let open = false;
/** Search within one project (its page's search button); null = everything. */
let scope: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openSearch(inList?: string | null): void {
  const next = typeof inList === 'string' ? inList : null;
  if (open && next === scope) return;
  open = true;
  scope = next;
  emit();
}

function searchScope(): string | null {
  return scope;
}

/** Widen to everything (the scope chip's ×). */
export function searchEverywhere(): void {
  scope = null;
  emit();
}

export function closeSearch(): void {
  if (!open) return;
  open = false;
  scope = null;
  emit();
}

function isSearchOpen(): boolean {
  return open;
}

export function useSearchScope(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    searchScope,
    searchScope,
  );
}

export function useSearchOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    isSearchOpen,
    isSearchOpen,
  );
}

const RECENT_KEY = 'gila-hub:recent-searches';

/** The last few things searched on this device (device-only; never synced). */
export function recentSearches(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(q: string): void {
  const t = q.trim();
  if (t.length < 2) return;
  try {
    const next = [t, ...recentSearches().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* storage blocked */
  }
}

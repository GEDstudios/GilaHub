import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'today' }
  | { name: 'shop' }
  | { name: 'chores' }
  | { name: 'lists' }
  | { name: 'list'; id: string }
  | { name: 'item'; id: string }
  | { name: 'settings' }
  | { name: 'search' };

export function parseRoute(path: string): Route {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/today') return { name: 'today' };
  if (p === '/shop') return { name: 'shop' };
  if (p === '/chores') return { name: 'chores' };
  if (p === '/lists') return { name: 'lists' };
  if (p === '/settings') return { name: 'settings' };
  if (p === '/search') return { name: 'search' };
  let m = p.match(/^\/l\/([A-Za-z0-9]+)$/);
  if (m) return { name: 'list', id: m[1] };
  m = p.match(/^\/i\/([A-Za-z0-9]+)$/);
  if (m) return { name: 'item', id: m[1] };
  return { name: 'today' };
}

export function href(r: Route): string {
  switch (r.name) {
    case 'today':
      return '/';
    case 'list':
      return `/l/${r.id}`;
    case 'item':
      return `/i/${r.id}`;
    default:
      return `/${r.name}`;
  }
}

const listeners = new Set<() => void>();
let depth = 0; // in-app history depth, so Back knows whether it can pop

function emit() {
  for (const fn of listeners) fn();
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    depth = Math.max(0, depth - 1);
    emit();
  });
}

export function navigate(to: Route | string, opts: { replace?: boolean } = {}): void {
  const url = typeof to === 'string' ? to : href(to);
  if (url === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, '', url);
  else {
    history.pushState(null, '', url);
    depth++;
  }
  window.scrollTo({ top: 0 });
  emit();
}

/** Go back within the app, or to a sensible parent when opened directly. */
export function back(fallback: Route): void {
  if (depth > 0) history.back();
  else navigate(fallback, { replace: true });
}

export function useRoute(): Route {
  const path = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => location.pathname,
  );
  return parseRoute(path);
}

export function query(name: string): string | null {
  return new URLSearchParams(location.search).get(name);
}

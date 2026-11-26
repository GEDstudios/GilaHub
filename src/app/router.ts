import { useSyncExternalStore } from 'react';
import { openSearch } from './search';

export type Route =
  | { name: 'today' }
  | { name: 'shop' }
  | { name: 'chores' }
  | { name: 'lists' }
  | { name: 'list'; id: string }
  | { name: 'item'; id: string }
  | { name: 'settings' };

export function parseRoute(path: string): Route {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/today') return { name: 'today' };
  if (p === '/shop') return { name: 'shop' };
  if (p === '/chores') return { name: 'chores' };
  if (p === '/lists') return { name: 'lists' };
  if (p === '/settings') return { name: 'settings' };
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

/**
 * Open sheets take a step in the history, so the phone's Back (or a swipe back) closes the
 * sheet you're on, not the screen under it. A sheet closed another way (×, a pull, Create)
 * takes its step back out; a navigation made meanwhile waits for that, so it isn't undone.
 */
type SheetStep = { id: number; close: () => void; popped: boolean };
const sheetSteps: SheetStep[] = [];
let sheetSeq = 1;
let unwinding = 0;
let waiting: Array<() => void> = [];

export function sheetOpened(close: () => void): { closed: () => void } {
  const step: SheetStep = { id: sheetSeq++, close, popped: false };
  let pushed = false;
  if (!memory && typeof history !== 'undefined') {
    try {
      history.pushState({ gilaSheet: step.id }, '', location.href);
      pushed = true;
    } catch {
      /* sandboxed: no step */
    }
  }
  sheetSteps.push(step);
  return {
    closed: () => {
      const at = sheetSteps.indexOf(step);
      if (at >= 0) sheetSteps.splice(at, 1);
      if (pushed && !step.popped && history.state?.gilaSheet === step.id) {
        unwinding++;
        history.back();
      }
    },
  };
}

/**
 * Leaving by Back: for a moment after the phone's Back, a field being written cancels instead of
 * saving as it loses focus (AutoTitle), the way Back means "never mind".
 */
let backAt = 0;
export const leavingByBack = (): boolean => Date.now() - backAt < 600;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    backAt = Date.now();
    // A sheet's own step, taken back out after it closed: nothing else moves.
    if (unwinding > 0) {
      unwinding--;
      if (!unwinding) {
        const run = waiting;
        waiting = [];
        run.forEach((fn) => fn());
      }
      return;
    }
    // Back with a sheet open: that sheet closes; the screen stays.
    const top = sheetSteps.pop();
    if (top) {
      top.popped = true;
      top.close();
      return;
    }
    depth = Math.max(0, depth - 1);
    emit();
  });
}

/**
 * Sandboxed frames (previews, embeds) may refuse pushState. Then we keep a small
 * in-memory history instead, so the app still navigates normally.
 */
let memory: string[] | null = null;

/** The path on screen now (also in a sandboxed frame, where history is kept in memory). */
export function currentPath(): string {
  return memory ? memory[memory.length - 1] : location.pathname;
}

export function navigate(to: Route | string, opts: { replace?: boolean } = {}): void {
  const url = typeof to === 'string' ? to : href(to);
  // Search isn't a page: it opens over the one you're on.
  if (url.split('?')[0] === '/search') {
    openSearch();
    return;
  }
  // A sheet that just closed is still taking its step back: go once it has.
  if (unwinding > 0) {
    waiting.push(() => navigate(to, opts));
    return;
  }
  if (url === currentPath() + (memory ? '' : location.search)) return;
  if (!memory) {
    try {
      if (opts.replace) history.replaceState(null, '', url);
      else history.pushState(null, '', url);
    } catch {
      memory = ['/'];
    }
  }
  if (memory) {
    const path = url.split('?')[0];
    if (opts.replace) memory[memory.length - 1] = path;
    else memory.push(path);
  }
  if (!opts.replace) depth++;
  try {
    window.scrollTo({ top: 0 });
  } catch {
    /* ignore */
  }
  emit();
}

/** Go back within the app, or to a sensible parent when opened directly. */
export function back(fallback: Route): void {
  if (memory && memory.length > 1) {
    memory.pop();
    depth = Math.max(0, depth - 1);
    emit();
  } else if (!memory && depth > 0) history.back();
  else navigate(fallback, { replace: true });
}

export function useRoute(): Route {
  const path = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    currentPath,
  );
  return parseRoute(path);
}

export function query(name: string): string | null {
  return new URLSearchParams(location.search).get(name);
}

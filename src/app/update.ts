import { useSyncExternalStore } from 'react';

/**
 * "Check for updates", honestly (SETTINGS §3.8, AUDIT P1-6): ask the service worker to look
 * for a new build and say what it found. Nothing here ever reloads; the person taps Refresh.
 *
 *   ready    a new version is installed (or already took over this session): Refresh to use it
 *   current  this is the newest build (also when no worker controls the page: it came from the network)
 *   offline  no connection, so we can't know
 *   failed   the check itself failed
 */
export type UpdateCheck = 'ready' | 'current' | 'offline' | 'failed';

/** The parts of a ServiceWorker / ServiceWorkerRegistration the check needs (fakes in tests). */
export interface WorkerLike {
  state: string;
  addEventListener(type: 'statechange', fn: () => void): void;
  removeEventListener(type: 'statechange', fn: () => void): void;
}
export interface RegistrationLike {
  update(): Promise<unknown>;
  installing: WorkerLike | null;
  waiting: WorkerLike | null;
}

/** Our worker skips waiting, so a found update activates within moments. */
const UPDATE_WAIT_MS = 8000;

/** Resolves true once the worker is activated, false if it was thrown away; at most `ms`. */
function settled(w: WorkerLike, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(t);
      w.removeEventListener('statechange', on);
      resolve(ok);
    };
    const on = () => {
      if (w.state === 'activated') done(true);
      else if (w.state === 'redundant') done(false);
    };
    // Still installing when time runs out: it is on its way, so a refresh will pick it up.
    const t = setTimeout(() => done(true), ms);
    w.addEventListener('statechange', on);
    on();
  });
}

export async function checkForUpdate(env: {
  online: boolean;
  /** A new version already took over this session (the gila:update event). */
  alreadyReady: boolean;
  registration: () => Promise<RegistrationLike | null | undefined>;
  waitMs?: number;
}): Promise<UpdateCheck> {
  if (env.alreadyReady) return 'ready';
  if (!env.online) return 'offline';
  let reg: RegistrationLike | null | undefined;
  try {
    reg = await env.registration();
    if (!reg) return 'current';
    await reg.update();
  } catch {
    return 'failed';
  }
  const incoming = reg.installing ?? reg.waiting;
  if (!incoming) return 'current';
  return (await settled(incoming, env.waitMs ?? UPDATE_WAIT_MS)) ? 'ready' : 'failed';
}

// ---------------------------------------------------------------- "a new version took over"

let ready = false;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('gila:update', () => {
    ready = true;
    for (const fn of listeners) fn();
  });
}

export function updateReady(): boolean {
  return ready;
}

/** True once a new version has taken over this page (main.tsx fires gila:update). */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => ready,
  );
}

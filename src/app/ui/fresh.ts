import { useSyncExternalStore } from 'react';
import { calm, DUR } from './tokens';

/**
 * "Just added": the row you made fades in and glows for a moment wherever it shows
 * (row--fresh row--flash). After an add from the New sheet the page also brings that
 * row into view, if it is on screen at all. Rows carry data-id for that.
 */
const FLASH_MS = DUR.flash;
let freshId: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function markFresh(id: string, opts: { scroll?: boolean } = {}): void {
  freshId = id;
  changed();
  clearTimeout(timer);
  timer = setTimeout(() => {
    freshId = null;
    changed();
  }, FLASH_MS);
  if (opts.scroll && typeof document !== 'undefined') {
    // Two frames: React has drawn the row by then.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
        const still = calm();
        el?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
      }),
    );
  }
}

/** Run `fn` when the row for `id` isn't in view after it has had a chance to draw. */
export function ifNotInView(id: string, fn: () => void): void {
  if (typeof document === 'undefined') return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const r = document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > innerHeight) fn();
    }),
  );
}

/** Is this row the one just added? */
export function useFresh(id: string): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => freshId === id,
    () => false,
  );
}

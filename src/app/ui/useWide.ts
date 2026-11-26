import { useSyncExternalStore } from 'react';

/** A computer-sized window (the sidebar's breakpoint): screens may lay out in columns. */
const QUERY = '(min-width: 960px)';

const subscribe = (cb: () => void) => {
  if (typeof matchMedia !== 'function') return () => {};
  const m = matchMedia(QUERY);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
const get = () => typeof matchMedia === 'function' && matchMedia(QUERY).matches;

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, get, () => false);
}

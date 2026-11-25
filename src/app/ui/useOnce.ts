import { useCallback, useEffect, useState } from 'react';

/** Hints already shown in this session (also covers private mode, where storage is blocked). */
const shown = new Set<string>();

const storeKey = (key: string) => `gila-hub:once:${key}`;

function seen(key: string): boolean {
  if (shown.has(key)) return true;
  try {
    return localStorage.getItem(storeKey(key)) === '1';
  } catch {
    return false;
  }
}

/**
 * A one-time hint: true the first time `when` holds on this device, and it stays up until
 * dismissed or the screen goes. Only one place shows a given hint.
 */
export function useOnce(key: string, when: boolean): [boolean, () => void] {
  const [state, setState] = useState<'wait' | 'show' | 'gone'>(() => (seen(key) ? 'gone' : 'wait'));

  useEffect(() => {
    if (state !== 'wait' || !when || seen(key)) return;
    shown.add(key);
    try {
      localStorage.setItem(storeKey(key), '1');
    } catch {
      /* storage blocked: the session set remembers it */
    }
    setState('show');
  }, [key, when, state]);

  const dismiss = useCallback(() => setState('gone'), []);
  return [state === 'show' && when, dismiss];
}

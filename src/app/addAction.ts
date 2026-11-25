import { useEffect } from 'react';

/**
 * The central "+" does what makes sense on the current screen: add to the shopping
 * list, add a chore, start a project… Screens register their action; the default is
 * the quick-add sheet.
 */
type Fn = () => void;
let current: Fn | null = null;

export function useAddAction(fn: Fn): void {
  useEffect(() => {
    current = fn;
    return () => {
      if (current === fn) current = null;
    };
  });
}

export function runAdd(fallback: Fn): void {
  (current ?? fallback)();
}

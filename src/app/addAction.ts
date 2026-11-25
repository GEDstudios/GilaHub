import { useEffect, useSyncExternalStore } from 'react';
import { primeKeyboard } from './ui/keyboard';

/**
 * "New" means one thing everywhere: open a sheet already pointed at where you are
 * (docs/03-DESIGN-SYSTEM.md, "Adding"). Each screen registers what its black "+" opens,
 * with a label; the header button, the N key and the sidebar's New all run it.
 * With nothing registered (Search, Settings) they open the plain composer.
 */
type Fn = () => void;
export interface AddAction {
  fn: Fn;
  label: string;
}

let current: AddAction | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** Make `action` the current one; returns the way to take it back. */
export function registerAdd(action: AddAction): () => void {
  current = action;
  changed();
  return () => {
    if (current !== action) return;
    current = null;
    changed();
  };
}

/** Register this screen's New for as long as it is mounted. */
export function useAddAction(fn: Fn, label = 'New'): void {
  useEffect(() => registerAdd({ fn, label }));
}

export function runAdd(fallback: Fn): void {
  primeKeyboard();
  (current?.fn ?? fallback)();
}

/** What New does here, in a few words ("Add an item", "New chore"…). */
export function addLabel(): string {
  return current?.label ?? 'New';
}

/** addLabel(), kept current for the sidebar. */
export function useAddLabel(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    addLabel,
    addLabel,
  );
}

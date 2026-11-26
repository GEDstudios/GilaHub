import { useEffect } from 'react';
import type { Hub } from '../core/actions';
import { History } from '../core/history';
import type { Store } from '../core/store';
import { Sheet } from './ui/overlays';

/**
 * Undo and redo, everywhere (⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Y): one History per store. Only what I did
 * counts: writes in the moments after I touched, clicked or typed, not the app's own upkeep
 * (repeats rolling over, a sync), and not my settings.
 */
const histories = new WeakMap<Store, History>();
let lastInput = 0;
let watching = false;

function watchInput(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const mark = () => (lastInput = performance.now());
  for (const ev of ['pointerdown', 'keydown', 'input', 'change', 'drop'] as const) window.addEventListener(ev, mark, { capture: true, passive: true });
  // A drag ends on a pointerup a while after its pointerdown.
  window.addEventListener('pointerup', mark, { capture: true, passive: true });
}

export function historyOf(hub: Hub): History {
  let h = histories.get(hub.store);
  if (!h) {
    watchInput();
    h = new History(hub.store, { record: (t) => t !== 'settings' && performance.now() - lastInput < 4000 });
    histories.set(hub.store, h);
    // For a look from the console (and tests).
    (globalThis as { __gilaHistory?: History }).__gilaHistory = h;
  }
  return h;
}

export function useHistory(hub: Hub): History {
  const h = historyOf(hub);
  useEffect(() => void historyOf(hub), [hub]);
  return h;
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = () => (isMac() ? '⌘' : 'Ctrl');

const SHORTCUTS: Array<{ keys: string[]; what: string }> = [
  { keys: ['N'], what: 'New task (here)' },
  { keys: ['/'], what: 'Search' },
  { keys: ['MOD', 'Z'], what: 'Undo' },
  { keys: ['MOD', '⇧', 'Z'], what: 'Redo' },
  { keys: ['1', '…', '9'], what: 'Go to a place on the bar' },
  { keys: ['G', 'T'], what: 'Go to Today' },
  { keys: ['G', 'F'], what: 'Go to Folders' },
  { keys: ['G', 'S'], what: 'Go to Settings' },
  { keys: ['Esc'], what: 'Close, or step back' },
  { keys: ['?'], what: 'These shortcuts' },
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet onClose={onClose} title="Shortcuts">
      <ul className="keys">
        {SHORTCUTS.map((s) => (
          <li key={s.what} className="keys__row">
            <span className="keys__what">{s.what}</span>
            <span className="keys__keys">
              {s.keys.map((k, i) => (k === '…' ? <span key={i}>–</span> : <kbd key={i}>{k === 'MOD' ? MOD() : k}</kbd>))}
            </span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

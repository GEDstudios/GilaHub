import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { settleMerge, type SettleSnap } from './motion';

const idOf = (row: { id: string }) => row.id;

/** How long a ticked row stays in place: the check pops, the tick draws, the title strikes, the row folds away. */
const SETTLE_MS = 520;

export interface Settle<T> {
  /** Keep `id` in place for a moment. Call it before the data changes (hub.toggle still runs at once). */
  hold: (id: string) => void;
  /** The rows to draw for one group, with any held rows put back where they were. */
  view: (group: string, rows: readonly T[]) => Array<{ row: T; settling: boolean }>;
  held: ReadonlySet<string>;
}

/**
 * Tick feedback for a screen of rows. Rows that can settle carry `data-settle={id}` and,
 * while settling, the class `is-settling` (see "Tick feedback" in components.css).
 */
export function useSettle<T extends { id: string }>(): Settle<T> {
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const snaps = useRef(new Map<string, SettleSnap<T>>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  const hold = useCallback((id: string) => {
    // The fold animates from the row's real height, measured before anything changes.
    try {
      for (const el of document.querySelectorAll<HTMLElement>(`[data-settle="${CSS.escape(id)}"]`)) el.style.setProperty('--h', `${el.offsetHeight}px`);
    } catch {
      /* no DOM: the fold falls back to a row's usual height */
    }
    setHeld((h) => new Set(h).add(id));
    clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        setHeld((h) => {
          const next = new Set(h);
          next.delete(id);
          return next;
        });
      }, SETTLE_MS),
    );
  }, []);

  const view = useCallback(
    (group: string, rows: readonly T[]) => {
      const out = settleMerge(rows, idOf, snaps.current.get(group), held);
      snaps.current.set(group, { order: out.map((o) => o.row.id), byId: new Map(out.map((o) => [o.row.id, o.row])) });
      return out;
    },
    [held],
  );

  return useMemo(() => ({ hold, view, held }), [hold, view, held]);
}

/** Lets a row deep in a list ask its screen to hold it (ItemRow reads this). */
export const SettleContext = createContext<Pick<Settle<unknown>, 'hold'> | null>(null);

export const useSettleHold = () => useContext(SettleContext)?.hold;

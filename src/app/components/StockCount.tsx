import { useCallback, useEffect, useRef, useState } from 'react';
import { isStocked, stockLow, type Item } from '../../core/model';
import type { StockPatch } from '../../core/hub/stock';
import { useHub } from '../context';
import { G } from '../ui/glyphs';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';

/**
 * Change what we count of something (the row's count, the task's panel). When that moves it
 * (stocked up: into its folder's "In stock"; down to its buy-at count: back among the tasks),
 * a toast says so, with Undo.
 */
export function useStockSet(id: string) {
  const hub = useHub();
  const { toast } = useOverlays();
  return (patch: StockPatch) => {
    const before = hub.item(id);
    if (!before) return;
    const undo = hub.setStock(id, patch);
    haptic('select');
    const now = hub.item(id);
    if (!now || now.stock == null || isStocked(before) === isStocked(now)) return;
    toast(isStocked(now) ? `${now.title}: in stock` : `${now.title}: time to buy`, { action: { label: 'Undo', run: undo } });
  };
}

/** How it reads now: time to buy (at or under its buy-at count), or urgent (at its urgent count). */
export function stockTone(item: Item): 'out' | 'low' | '' {
  const n = item.stock ?? 0;
  if (item.stockUrgentAt != null && n <= item.stockUrgentAt) return 'out';
  return stockLow(item) ? 'low' : '';
}

/**
 * Where a task's tick would be, something we count shows how many we have: the tick's place and
 * size, a number in its ring. Tap it and it opens, right there, into − n + of the same height;
 * the count is kept when it closes (after a moment, a tap elsewhere, or leaving), so a row that
 * then belongs elsewhere (In stock, or back among the tasks) moves only once you're done.
 */
export function StockCount({ item, readonly }: { item: Item; readonly?: boolean }) {
  const set = useStockSet(item.id);
  const n = item.stock ?? 0;
  // The count while it's open (null: closed).
  const [draft, setDraft] = useState<number | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({ draft, n, set });
  live.current = { draft, n, set };
  const close = useCallback(() => {
    const { draft: d, n: was, set: save } = live.current;
    if (timer.current) clearTimeout(timer.current);
    if (d == null) return;
    live.current.draft = null;
    setDraft(null);
    if (d !== was) save({ stock: d });
  }, []);
  const linger = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(close, 3500);
  };
  const open = draft != null;
  useEffect(() => {
    if (!open) return;
    linger();
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') close();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Leaving the page keeps what was counted.
  useEffect(() => close, [close]);

  const tone = stockTone({ ...item, stock: draft ?? n });
  if (open && !readonly) {
    const step = (d: number) => {
      haptic('select');
      setDraft((v) => Math.max(0, (v ?? n) + d));
      linger();
    };
    return (
      <span ref={box} className={`stockcount is-open ${tone ? `is-${tone}` : ''}`} onClick={(e) => e.stopPropagation()}>
        <span className="stockcount__ring">
          <button type="button" className="stockcount__step" aria-label={`${item.title}: one less`} disabled={draft <= 0} onClick={() => step(-1)}>
            <Icon name={G.less} />
          </button>
          <span className="stockcount__n num" aria-live="polite">
            {draft}
          </span>
          <button type="button" className="stockcount__step" aria-label={`${item.title}: one more`} onClick={() => step(1)}>
            <Icon name={G.add} />
          </button>
        </span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`stockcount ${tone ? `is-${tone}` : ''}`}
      aria-label={`${item.title}: ${n} in stock`}
      title={`${n} in stock`}
      disabled={readonly}
      onClick={(e) => {
        e.stopPropagation();
        haptic('select');
        setDraft(n);
      }}
    >
      <span className="stockcount__ring">
        <span className="stockcount__n num">{n}</span>
      </span>
    </button>
  );
}

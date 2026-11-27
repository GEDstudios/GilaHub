import { useEffect, useRef, useState } from 'react';
import type { Item } from '../../core/model';
import { useHub } from '../context';
import { haptic } from '../ui/haptics';
import { useOverlays } from '../ui/overlays';
import { Stepper } from '../ui/primitives';

/**
 * Change what we count of something, from anywhere (the row, the Stock page, the task): it
 * clicks, and when that just put it on a list, a toast says where (with Undo).
 */
export function useStockSet(id: string) {
  const hub = useHub();
  const { toast } = useOverlays();
  return (patch: Parameters<typeof hub.setStock>[1]) => {
    const before = hub.item(id)?.stockLink ?? null;
    const undo = hub.setStock(id, patch);
    haptic('select');
    const now = hub.item(id);
    if (now?.stockLink && now.stockLink !== before) {
      const at = hub.stockPlace(now);
      const where = at.parentId ? `“${hub.item(at.parentId)?.title ?? ''}”` : (hub.list(at.listId)?.name ?? 'the list');
      toast(`${now.title}: on ${where}`, { action: { label: 'Undo', run: undo } });
    }
  };
}

/** How it reads now: running low (at or under where it's bought), or out (at its urgent level). */
export function stockTone(hub: ReturnType<typeof useHub>, item: Item): 'out' | 'low' | '' {
  const n = item.stock ?? 0;
  if (item.stockUrgentAt != null && n <= item.stockUrgentAt) return 'out';
  return hub.stockLow(item) ? 'low' : '';
}

/**
 * Where a task's tick would be, something we count shows how many are in. Tap it: it opens into
 * − n + right there (used some, or filled back up), and closes by itself after a moment.
 */
export function StockCount({ item, readonly }: { item: Item; readonly?: boolean }) {
  const hub = useHub();
  const set = useStockSet(item.id);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linger = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 3500);
  };
  useEffect(() => {
    if (!open) return;
    linger();
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const n = item.stock ?? 0;
  const tone = stockTone(hub, item);
  if (open && !readonly)
    return (
      <span ref={box} className="stockcount--open">
        <Stepper
          size="sm"
          look="card"
          tone={tone}
          value={n}
          label={item.title}
          onChange={(v) => {
            set({ stock: v ?? 0 });
            linger();
          }}
        />
      </span>
    );
  return (
    <button
      type="button"
      className={`stockcount num ${tone ? `is-${tone}` : ''}`}
      aria-label={`${item.title}: ${n} in stock`}
      title={`${n} in stock`}
      disabled={readonly}
      onClick={(e) => {
        e.stopPropagation();
        haptic('select');
        setOpen(true);
      }}
    >
      {n}
    </button>
  );
}

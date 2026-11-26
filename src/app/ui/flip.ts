import { useLayoutEffect, useRef, type RefObject } from 'react';
import { calm, EASE } from './tokens';


/** Where each [data-key] child sits across its row, in px from the container's start (scrollers unrolled). */
function positions(root: HTMLElement): Map<string, number> {
  const base = root.getBoundingClientRect().left;
  const out = new Map<string, number>();
  root.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
    const scroller = el.parentElement && el.parentElement !== root ? el.parentElement : null;
    out.set(el.dataset.key!, el.getBoundingClientRect().left - base + (scroller?.scrollLeft ?? 0));
  });
  return out;
}

/**
 * FLIP for a row of keyed slots (the bar preview in Settings): when `layout` changes, every
 * [data-key] child that moved slides from where it was to where it is now (240ms spring).
 * Horizontal only. A changed `mode` (the bar's density) re-lays everything out, so it just
 * snaps. Reduced motion: no slide.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, layout: string, mode = '', ms = 240): void {
  const last = useRef<{ mode: string; at: Map<string, number> } | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const at = positions(root);
    const prev = last.current;
    last.current = { mode, at };
    if (!prev || prev.mode !== mode || calm()) return;
    root.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
      const from = prev.at.get(el.dataset.key!);
      const to = at.get(el.dataset.key!);
      if (from === undefined || to === undefined || Math.abs(from - to) < 0.5) return;
      el.animate?.([{ transform: `translateX(${from - to}px)` }, { transform: 'none' }], { duration: ms, easing: EASE.springSoft });
    });
    // The keys, compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, mode]);
}

/**
 * Replay a one-shot CSS animation class on an element: a shake (`is-nudge`) on something that
 * can't move or be picked, a wobble (`is-wobble`) on the card when its color changes.
 */
export function replay(el: Element | null | undefined, cls = 'is-nudge'): void {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

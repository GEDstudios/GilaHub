import { useEffect, useRef } from 'react';
import { haptic } from './haptics';
import { CLICK_SWALLOW_MS } from './tokens';

/**
 * Swipe a row sideways (touch): it follows the finger, what's under it shows (a coloured band
 * with what letting go will do), and past the line it says so (a tick of the phone, the band's
 * icon pops). Let go past the line and it happens; short of it, the row springs back.
 *
 * Only a sideways move takes it: one that starts more up-and-down than across is the page
 * scrolling, and a still press is left to the long-press that lifts the row (Sortable). A tap
 * after a swipe doesn't open the row. Calm when motion is turned down (it still works).
 *
 * The row gets `--swipe` (px) and `--swipe-p` (0–1, how far to the line) while it moves,
 * `is-swiping`, and `is-armed` past the line.
 */
export function useSwipe<T extends HTMLElement>(opts: { right?: () => void; left?: () => void; line?: number }) {
  const ref = useRef<T | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  const enabled = !!opts.right || !!opts.left;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number } | null = null;
    let mode: 'idle' | 'swipe' | 'scroll' = 'idle';
    let dx = 0;
    let armed = false;
    let swallow = false;
    const line = () => latest.current.line ?? Math.min(110, Math.max(72, el.offsetWidth * 0.26));

    const set = (x: number) => {
      dx = x;
      el.style.setProperty('--swipe', `${x}px`);
      // How far to the line, 0–1: what's revealed grows in with it.
      el.style.setProperty('--swipe-p', Math.min(1, Math.abs(x) / line()).toFixed(3));
      const over = Math.abs(x) >= line();
      if (over !== armed) {
        armed = over;
        el.classList.toggle('is-armed', over);
        if (over) haptic('select');
      }
    };
    const reset = () => {
      el.classList.remove('is-swiping', 'is-armed');
      el.style.setProperty('--swipe', '0px');
      el.style.setProperty('--swipe-p', '0');
      start = null;
      mode = 'idle';
      dx = 0;
      armed = false;
    };

    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      // Not from a control inside it (the check, a tag, a link).
      if ((e.target as Element).closest('button, a, input, textarea, [role="switch"], [role="checkbox"]')) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      mode = 'idle';
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const x = t.clientX - start.x;
      const y = t.clientY - start.y;
      if (mode === 'idle') {
        if (Math.abs(y) > 8 && Math.abs(y) > Math.abs(x)) {
          mode = 'scroll';
          return;
        }
        if (Math.abs(x) < 10) return;
        if ((x > 0 && !latest.current.right) || (x < 0 && !latest.current.left)) {
          mode = 'scroll';
          return;
        }
        mode = 'swipe';
        el.classList.add('is-swiping');
      }
      if (mode !== 'swipe') return;
      e.preventDefault();
      // Past the line it gets heavier (a rubber band), so it never runs away.
      const l = line();
      const a = Math.abs(x);
      const eased = a <= l ? a : l + (a - l) * 0.35;
      set(Math.sign(x) * eased);
    };
    const up = () => {
      if (mode === 'swipe') {
        swallow = true;
        setTimeout(() => (swallow = false), CLICK_SWALLOW_MS);
        const go = armed ? (dx > 0 ? latest.current.right : latest.current.left) : undefined;
        reset();
        if (go) {
          haptic('success');
          go();
        }
        return;
      }
      reset();
    };
    // A swipe isn't a tap: the click that follows it doesn't open the row.
    const click = (e: MouseEvent) => {
      if (!swallow) return;
      e.stopPropagation();
      e.preventDefault();
      swallow = false;
    };

    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', reset);
    el.addEventListener('click', click, true);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', reset);
      el.removeEventListener('click', click, true);
      reset();
    };
  }, [enabled]);

  return ref;
}

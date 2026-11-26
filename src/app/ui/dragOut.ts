import { useEffect, useRef } from 'react';
import { haptic } from './haptics';

export interface Point {
  x: number;
  y: number;
}

/**
 * Drag one thing out of where it sits (a subtask out from under its task, on a folder page):
 * a mouse drags it after a few pixels, a finger after holding it still a moment. A small chip
 * with its name follows the hand; `aim` lights what's under it; letting go calls `drop`.
 * The press never reaches what holds it (the task row it's under has a drag of its own).
 */
export function useDragOut<T extends HTMLElement>(opts: { label: string; enabled: boolean; aim: (p: Point | null) => void; drop: (p: Point) => void }) {
  const ref = useRef<T | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el || !opts.enabled) return;
    let start: (Point & { id: number; touch: boolean }) | null = null;
    let dragging = false;
    let hold: ReturnType<typeof setTimeout> | null = null;
    let chip: HTMLElement | null = null;
    let swallow = false;

    const lift = (p: Point) => {
      dragging = true;
      haptic('lift');
      el.classList.add('is-lifted-out');
      chip = document.createElement('div');
      chip.className = 'dropchip dropchip--float';
      chip.textContent = latest.current.label;
      document.body.appendChild(chip);
      move(p);
    };
    const move = (p: Point) => {
      if (chip) chip.style.transform = `translate(${p.x + 12}px, ${p.y - 46}px) rotate(-3deg)`;
      latest.current.aim(p);
    };
    const end = () => {
      if (hold) clearTimeout(hold);
      hold = null;
      start = null;
      chip?.remove();
      chip = null;
      el.classList.remove('is-lifted-out');
      if (dragging) latest.current.aim(null);
      dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', end);
    };
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const p = { x: e.clientX, y: e.clientY };
      if (!dragging) {
        const far = Math.hypot(p.x - start.x, p.y - start.y);
        // A finger that moves before the hold is the page scrolling.
        if (start.touch) {
          if (far > 8) end();
          return;
        }
        if (far > 6) lift(p);
        return;
      }
      move(p);
    };
    const onUp = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      if (dragging) {
        swallow = true;
        setTimeout(() => (swallow = false), 350);
        latest.current.drop({ x: e.clientX, y: e.clientY });
      }
      end();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest('button, a, input, textarea, [role="checkbox"]')) return;
      // Not the task row's own drag (it would lift the whole task).
      e.stopPropagation();
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === 'touch' };
      if (start.touch) hold = setTimeout(() => start && lift({ x: start.x, y: start.y }), 380);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', end);
    };
    // While a finger drags it, the page doesn't scroll.
    const onTouchMove = (e: TouchEvent) => {
      if (dragging) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (!swallow) return;
      e.stopPropagation();
      e.preventDefault();
      swallow = false;
    };
    el.addEventListener('pointerdown', onDown);
    // The list's own drag listens for these too: they stop here as well.
    const mine = (e: Event) => {
      if (!(e.target as Element).closest('button, a, input, textarea, [role="checkbox"]')) e.stopPropagation();
    };
    el.addEventListener('mousedown', mine);
    el.addEventListener('touchstart', mine, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('click', onClick, true);
    return () => {
      end();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('mousedown', mine);
      el.removeEventListener('touchstart', mine);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('click', onClick, true);
    };
  }, [opts.enabled]);
  return ref;
}

import { useEffect, useRef } from 'react';
import { haptic } from './haptics';

export interface Point {
  x: number;
  y: number;
}

/**
 * Drag one thing out of where it sits (a subtask out from under its task, on a folder page):
 * a mouse drags it after a few pixels, a finger after holding it still a moment. Lifted, it
 * looks like any task (a full row) and follows the hand; `aim` lights what's under it; letting go calls `drop`.
 * The press never reaches what holds it (the task row it's under has a drag of its own).
 */
export function useDragOut<T extends HTMLElement>(opts: { label: string; enabled: boolean; aim: (p: Point | null, from: Point) => void; drop: (p: Point, from: Point) => void }) {
  const ref = useRef<T | null>(null);
  const latest = useRef(opts);
  latest.current = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el || !opts.enabled) return;
    let start: (Point & { id: number; touch: boolean }) | null = null;
    // Where the hand first took it (kept after the drag ends, for the last aim).
    let origin: Point = { x: 0, y: 0 };
    let dragging = false;
    let hold: ReturnType<typeof setTimeout> | null = null;
    let chip: HTMLElement | null = null;
    let swallow = false;

    let grab = { x: 0, y: 0 };
    // Held, it's a task like any other: a full row, lifted, as wide as the list it came from.
    const lift = (p: Point) => {
      dragging = true;
      haptic('lift');
      const host = el.parentElement?.closest<HTMLElement>('.rows:not(.rows--sub)') ?? el;
      const hr = host.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      grab = { x: p.x - hr.left, y: p.y - r.top };
      chip = document.createElement('div');
      chip.className = 'dragout';
      chip.style.width = `${hr.width}px`;
      const card = document.createElement('div');
      card.className = 'lift is-lifted lift--row';
      const ul = document.createElement('ul');
      ul.className = 'rows';
      const row = el.cloneNode(true) as HTMLElement;
      row.classList.remove('row--nested', 'is-lifted-out');
      row.removeAttribute('data-id');
      row.removeAttribute('data-settle');
      ul.appendChild(row);
      card.appendChild(ul);
      chip.appendChild(card);
      document.body.appendChild(chip);
      el.classList.add('is-lifted-out');
      move(p);
    };
    const move = (p: Point) => {
      if (chip) chip.style.transform = `translate(${p.x - grab.x}px, ${p.y - grab.y}px)`;
      latest.current.aim(p, origin);
    };
    const end = () => {
      if (hold) clearTimeout(hold);
      hold = null;
      start = null;
      chip?.remove();
      chip = null;
      el.classList.remove('is-lifted-out');
      if (dragging) latest.current.aim(null, origin);
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
        latest.current.drop({ x: e.clientX, y: e.clientY }, origin);
      }
      end();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest('button, a, input, textarea, [role="checkbox"]')) return;
      // Not the task row's own drag (it would lift the whole task).
      e.stopPropagation();
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === 'touch' };
      origin = { x: e.clientX, y: e.clientY };
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

import { useEffect, useRef } from 'react';
import { haptic } from './haptics';

/**
 * Drag a whole group by its heading (`.aisle__head--drag` in a `section.aisle[data-tag]`): it
 * follows the hand up and down, a line shows where it would go, and letting go says which group
 * it goes before (null: the end). A mouse drags after a few pixels; a finger after holding still.
 */
export function useGroupDrag(enabled: boolean, onDrop: (tag: string, before: string | null) => void): void {
  const latest = useRef(onDrop);
  latest.current = onDrop;
  useEffect(() => {
    if (!enabled) return;
    let s: { sec: HTMLElement; tag: string; y: number; x: number; id: number; touch: boolean; on: boolean; hold?: ReturnType<typeof setTimeout> } | null = null;
    let mark: HTMLElement | null = null;
    let before: string | null | undefined;
    let swallow = false;

    const others = () => [...document.querySelectorAll<HTMLElement>('section.aisle[data-tag]')].filter((x) => x !== s?.sec);
    const lift = () => {
      if (!s) return;
      s.on = true;
      haptic('lift');
      s.sec.classList.add('is-moving');
      document.documentElement.classList.add('is-dragging');
    };
    const aim = (y: number) => {
      const list = others();
      const next = list.find((x) => {
        const r = x.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      const b = next ? next.dataset.tag! : null;
      if (b === before) return;
      before = b;
      mark?.classList.remove('is-drop-before', 'is-drop-after');
      mark = next ?? list.at(-1) ?? null;
      mark?.classList.add(next ? 'is-drop-before' : 'is-drop-after');
      haptic('select');
    };
    const end = () => {
      if (s?.hold) clearTimeout(s.hold);
      if (s) {
        s.sec.classList.remove('is-moving');
        s.sec.style.removeProperty('transform');
      }
      mark?.classList.remove('is-drop-before', 'is-drop-after');
      mark = null;
      before = undefined;
      s = null;
      document.documentElement.classList.remove('is-dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', end);
    };
    const move = (e: PointerEvent) => {
      if (!s || e.pointerId !== s.id) return;
      const dy = e.clientY - s.y;
      if (!s.on) {
        const far = Math.hypot(e.clientX - s.x, dy);
        if (s.touch) {
          if (far > 8) end();
          return;
        }
        if (far < 6) return;
        lift();
      }
      e.preventDefault();
      s.sec.style.transform = `translateY(${dy}px) rotate(-0.6deg)`;
      aim(e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (!s || e.pointerId !== s.id) return;
      if (s.on && before !== undefined) {
        swallow = true;
        setTimeout(() => (swallow = false), 350);
        latest.current(s.tag, before);
      }
      end();
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const head = (e.target as Element).closest<HTMLElement>('.aisle__head--drag');
      const sec = head?.closest<HTMLElement>('section.aisle[data-tag]');
      if (!head || !sec || (e.target as Element).closest('button, a')) return;
      s = { sec, tag: sec.dataset.tag!, y: e.clientY, x: e.clientX, id: e.pointerId, touch: e.pointerType === 'touch', on: false };
      if (s.touch) s.hold = setTimeout(lift, 380);
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', end);
    };
    const touchMove = (e: TouchEvent) => {
      if (s?.on) e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      if (!swallow) return;
      e.stopPropagation();
      e.preventDefault();
      swallow = false;
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('click', click, true);
    return () => {
      end();
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('touchmove', touchMove);
      document.removeEventListener('click', click, true);
    };
  }, [enabled]);
}

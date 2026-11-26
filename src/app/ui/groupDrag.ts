import { useEffect, useRef } from 'react';
import { haptic } from './haptics';

/**
 * Hold a group by its heading (`.aisle__head--drag` in a `section.aisle[data-sort]`) and move it
 * up or down among its own kind (`data-sort-scope`): like a task, it lifts (leaning, a shadow),
 * the others slide out of its way as it passes, and letting go settles it into the gap. A mouse
 * lifts it after a few pixels; a finger after holding it still a moment. `onDrop` gets its key
 * and the key of the group it now goes before (null: last).
 */
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useGroupDrag(enabled: boolean, onDrop: (key: string, before: string | null) => void): void {
  const latest = useRef(onDrop);
  latest.current = onDrop;
  useEffect(() => {
    if (!enabled) return;
    type Drag = {
      sec: HTMLElement;
      key: string;
      x: number;
      y: number;
      id: number;
      touch: boolean;
      on: boolean;
      hold?: ReturnType<typeof setTimeout>;
      peers: HTMLElement[];
      rects: DOMRect[];
      self: number;
      gap: number;
      t: number;
    };
    let d: Drag | null = null;
    let swallow = false;
    const quiet = calm();

    const others = () => (d ? d.peers.filter((x) => x !== d!.sec) : []);
    const lift = () => {
      if (!d) return;
      const scope = d.sec.dataset.sortScope ?? '';
      d.peers = [...document.querySelectorAll<HTMLElement>('section.aisle[data-sort]')].filter((x) => (x.dataset.sortScope ?? '') === scope);
      d.rects = d.peers.map((x) => x.getBoundingClientRect());
      d.self = d.peers.indexOf(d.sec);
      d.gap = d.rects.length > 1 ? Math.max(8, d.rects[1].top - d.rects[0].bottom) : 24;
      d.t = d.self;
      d.on = true;
      haptic('lift');
      for (const x of d.peers) if (x !== d.sec) x.classList.add('is-making-room');
      d.sec.classList.add('is-moving');
      document.documentElement.classList.add('is-dragging');
    };
    const place = (dy: number) => {
      if (!d) return;
      const me = d.rects[d.self];
      d.sec.style.transform = `translateY(${dy}px) rotate(${quiet ? 0 : 0.8}deg) scale(${quiet ? 1 : 1.015})`;
      const center = me.top + me.height / 2 + dy;
      const rest = others();
      const t = rest.filter((x) => {
        const r = d!.rects[d!.peers.indexOf(x)];
        return r.top + r.height / 2 < center;
      }).length;
      if (t !== d.t) haptic('select');
      d.t = t;
      const h = me.height + d.gap;
      rest.forEach((x, k) => {
        const o = d!.peers.indexOf(x);
        const shift = o > d!.self && k < t ? -h : o < d!.self && k >= t ? h : 0;
        x.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const clear = () => {
      if (!d) return;
      for (const x of d.peers) {
        x.classList.remove('is-making-room', 'is-moving', 'is-settling-in');
        x.style.removeProperty('transform');
      }
      d.sec.classList.remove('is-moving', 'is-settling-in');
      d.sec.style.removeProperty('transform');
      document.documentElement.classList.remove('is-dragging');
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    const cancel = () => {
      if (d?.hold) clearTimeout(d.hold);
      clear();
      d = null;
      stop();
    };
    const move = (e: PointerEvent) => {
      if (!d || e.pointerId !== d.id) return;
      const dy = e.clientY - d.y;
      if (!d.on) {
        const far = Math.hypot(e.clientX - d.x, dy);
        if (d.touch) {
          if (far > 8) cancel();
          return;
        }
        if (far < 6) return;
        lift();
      }
      e.preventDefault();
      place(dy);
    };
    const up = (e: PointerEvent) => {
      if (!d || e.pointerId !== d.id) return;
      stop();
      if (!d.on) return cancel();
      swallow = true;
      setTimeout(() => (swallow = false), 350);
      const done = d;
      d = null;
      const rest = done.peers.filter((x) => x !== done.sec);
      const before = rest[done.t]?.dataset.sort ?? null;
      const moved = done.t !== done.self;
      // Settle into the gap, then the page takes the new order.
      const me = done.rects[done.self];
      let top = done.rects[0].top;
      if (done.t > 0) {
        const prev = rest[done.t - 1];
        const r = done.rects[done.peers.indexOf(prev)];
        const shifted = prev.style.transform.match(/translateY\((-?[\d.]+)px\)/);
        top = r.bottom + (shifted ? Number(shifted[1]) : 0) + done.gap;
      }
      done.sec.classList.add('is-settling-in');
      done.sec.style.transform = `translateY(${top - me.top}px)`;
      haptic('drop');
      setTimeout(
        () => {
          for (const x of done.peers) {
            x.classList.remove('is-making-room', 'is-moving', 'is-settling-in');
            x.style.removeProperty('transform');
          }
          document.documentElement.classList.remove('is-dragging');
          if (moved) latest.current(done.key, before);
        },
        quiet ? 0 : 190,
      );
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || d) return;
      const head = (e.target as Element).closest<HTMLElement>('.aisle__head--drag');
      const sec = head?.closest<HTMLElement>('section.aisle[data-sort]');
      if (!head || !sec || (e.target as Element).closest('button, a')) return;
      d = { sec, key: sec.dataset.sort!, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === 'touch', on: false, peers: [], rects: [], self: 0, gap: 24, t: 0 };
      if (d.touch) d.hold = setTimeout(lift, 380);
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    };
    const touchMove = (e: TouchEvent) => {
      if (d?.on) e.preventDefault();
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
      cancel();
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('touchmove', touchMove);
      document.removeEventListener('click', click, true);
    };
  }, [enabled]);
}

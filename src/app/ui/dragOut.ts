import { useEffect, useRef } from 'react';
import { G } from './glyphs';
import { haptic } from './haptics';
import { GLYPHS } from './icons.gen';
import { CLICK_SWALLOW_MS, HOLD, SLOP } from './tokens';

interface Point {
  x: number;
  y: number;
}

/** Over something it goes into, the copy in the hand turns into a small chip saying how. */
export type ChipKind = 'subtask' | 'move';

/** A glyph as plain DOM (the copy in the hand is built outside React). */
function glyph(kind: ChipKind): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon icon--sm');
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('aria-hidden', 'true');
  const [light, line] = GLYPHS[kind === 'subtask' ? G.subtask : G.move];
  for (const [d, cls] of [[light, 'icon__light'], [line, 'icon__line']] as const) {
    if (!d) continue;
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('class', cls);
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * Drag one thing out of where it sits (a subtask out from under its task, on a folder page):
 * a mouse drags it after a few pixels, a finger after holding it still a moment. Lifted, it
 * looks like any task (a full row) and follows the hand; where it came from is a dashed slot.
 * `aim` marks where it would land and says how the copy shows it: the gap where it lands among
 * others (the row settles into it, as wide as that level: a preview of where it goes),
 * or a chip (over something it goes into, the row turns into a small chip just above the hand,
 * as Sortable's does, so the target stays in sight);
 * letting go calls `drop`, Escape puts it back. The press never reaches what holds it (the task
 * row it's under has a drag of its own).
 */
export function useDragOut<T extends HTMLElement>(opts: {
  label: string;
  enabled: boolean;
  aim: (p: Point | null, from: Point) => ChipKind | DOMRect | null | undefined | void;
  drop: (p: Point, from: Point) => void;
}) {
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
    let kind: ChipKind | null = null;
    // Escape put it back while the hand is still down: wait for it to let go.
    let cancelled = false;

    let grab = { x: 0, y: 0 };
    let width = 0;
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
      width = hr.width;
      chip.style.width = `${width}px`;
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
      chip.style.setProperty('--gx', `${grab.x}px`);
      chip.style.setProperty('--gy', `${grab.y}px`);
      kind = null;
      document.body.appendChild(chip);
      window.addEventListener('keydown', onKey, true);
      el.classList.add('is-lifted-out');
      document.documentElement.classList.add('is-dragging');
      move(p);
    };
    const move = (p: Point) => {
      const how = latest.current.aim(p, origin) || null;
      const slot = how && typeof how === 'object' ? how : null;
      if (chip) {
        chip.classList.toggle('is-snapped', !!slot);
        chip.style.transform = slot ? `translate(${Math.round(slot.left)}px, ${Math.round(slot.top)}px)` : `translate(${p.x - grab.x}px, ${p.y - grab.y}px)`;
        chip.style.width = `${slot ? slot.width : width}px`;
      }
      shape(typeof how === 'string' ? how : null);
    };
    // A row, or a chip saying how it goes in.
    const shape = (next: ChipKind | null) => {
      if (!chip || next === kind) return;
      kind = next;
      chip.querySelector('.dropchip')?.remove();
      chip.classList.toggle('is-chip', !!next);
      if (!next) return;
      const tag = document.createElement('span');
      tag.className = 'dropchip';
      const name = document.createElement('span');
      name.dir = 'auto';
      name.textContent = latest.current.label;
      tag.append(glyph(next), name);
      chip.appendChild(tag);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragging) return;
      e.preventDefault();
      e.stopPropagation();
      cancelled = true;
      settle();
    };
    /** The copy goes, the row comes back, nothing is marked. */
    const settle = () => {
      chip?.remove();
      chip = null;
      el.classList.remove('is-lifted-out');
      if (dragging) {
        document.documentElement.classList.remove('is-dragging');
        latest.current.aim(null, origin);
      }
      dragging = false;
      kind = null;
      window.removeEventListener('keydown', onKey, true);
    };
    const end = () => {
      if (hold) clearTimeout(hold);
      hold = null;
      start = null;
      cancelled = false;
      settle();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', end);
    };
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id || cancelled) return;
      const p = { x: e.clientX, y: e.clientY };
      if (!dragging) {
        const far = Math.hypot(p.x - start.x, p.y - start.y);
        // A finger that moves before the hold is the page scrolling.
        if (start.touch) {
          if (far > SLOP.hold) end();
          return;
        }
        if (far > SLOP.mouse) lift(p);
        return;
      }
      move(p);
    };
    const onUp = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      // The click that letting go makes lands on whatever holds both ends (often a task row,
      // which would open): it's eaten, wherever it lands.
      if (dragging || cancelled) eatClick();
      if (dragging) latest.current.drop({ x: e.clientX, y: e.clientY }, origin);
      end();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest('button, a, input, textarea, [role="checkbox"]')) return;
      // Not the task row's own drag (it would lift the whole task).
      e.stopPropagation();
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === 'touch' };
      origin = { x: e.clientX, y: e.clientY };
      if (start.touch) hold = setTimeout(() => start && lift({ x: start.x, y: start.y }), HOLD.press);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', end);
    };
    // While a finger drags it, the page doesn't scroll.
    const onTouchMove = (e: TouchEvent) => {
      if (dragging) e.preventDefault();
    };
    const eatClick = () => {
      const eat = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        window.removeEventListener('click', eat, true);
      };
      window.addEventListener('click', eat, true);
      setTimeout(() => window.removeEventListener('click', eat, true), CLICK_SWALLOW_MS);
    };
    el.addEventListener('pointerdown', onDown);
    // The list's own drag listens for these too: they stop here as well.
    const mine = (e: Event) => {
      if (!(e.target as Element).closest('button, a, input, textarea, [role="checkbox"]')) e.stopPropagation();
    };
    el.addEventListener('mousedown', mine);
    el.addEventListener('touchstart', mine, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      end();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('mousedown', mine);
      el.removeEventListener('touchstart', mine);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [opts.enabled]);
  return ref;
}

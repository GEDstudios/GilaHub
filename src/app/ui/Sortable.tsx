/**
 * Sortable: the one drag-to-reorder in Gila Hub. Task rows and steps (Children), a shopping
 * aisle (Shopping), project folders (Lists), and the Settings arrangers (BarEditor, HomeEditor)
 * all use it, so they feel the same.
 *
 * API
 *   <Sortable
 *     ids={ids}                         the order now (only items that can move)
 *     onMove={(next, id) => …}          called once, on drop, with the new order
 *     label={(id) => 'Milk'}            for screen-reader announcements
 *     renderOverlay={(id) => …}         the lifted copy (rows: <ul className="rows"><Row/></ul>)
 *     layout="rows" | "grid"            rows: a vertical list (default); grid: wrapping cards
 *     bounds="soft" | "refuse" | "none" rows default to "soft": the row rubber-bands at its list's
 *                                       edges. "refuse" also shakes the nearest [data-sort-bounds]
 *                                       (or the list) and buzzes `warn` once dragged >24px out.
 *     lean={(id) => ({ rest, land })}   degrees: the resting lean while lifted, and where it lands.
 *                                       Rows: 1.5 / 0. Folders: tilt(id) + 3 / tilt(id).
 *     liftClass="…"                     extra class on the lifted wrapper
 *     onPreview={(draft | null) => …}   the order as it would drop, on each new spot; null at the end
 *     onLift={(id) => …}                a drag started, with the lifted id
 *     grips                             items have a [data-grip] handle (keyboard reordering)
 *     disabled>
 *     …children, whose items call useSortableItem(id)…
 *   </Sortable>
 *
 *   const s = useSortableItem(id, { disabled });
 *   <li ref={s.ref} style={s.style} className={s.className} {...s.props}>…</li>
 *   With a grip (BarEditor, HomeEditor): s.props still go on the row (a long-press on the
 *   body lifts it on touch), and the handle is
 *   <button data-grip ref={s.gripRef} {...s.gripProps} aria-label="Reorder Milk">.
 *
 * Starting a drag
 *   - a grip ([data-grip]): pointer, after 3px, no delay (the grip is touch-action:none)
 *   - touch on the row body: a 320ms long-press within 6px; moving first scrolls the page
 *     (shorter would catch an unhurried tap, ~250ms, and lift the row instead of opening it)
 *   - mouse on the row body: after 4px
 *   - keyboard, from a focused grip: Space/Enter picks up, arrows move, Space drops, Esc cancels
 *   Buttons, links, inputs, switches and the check never start one. A button marked
 *   [data-drag] (a folder card) can be dragged by its body.
 *
 * Feel (DECISIONS #3)
 *   The lifted copy renders in a portaled DragOverlay, so no card clips it: scale 1.035, a
 *   resting lean plus a velocity tilt (±3deg), shadow --lift-3, and the `is-lifted` class. The
 *   tilt is written to --lean on the overlay in rAF, never through React state. The source
 *   becomes a dashed ghost slot (`is-ghost`). Neighbours slide 260ms with a little overshoot;
 *   the drop glides 320ms into the slot with a landing beat (gives to 0.975, swings back past
 *   its lean, settles). Haptics: lift, select on each new spot, drop. Auto-scroll starts only
 *   at the floating bar's top edge (scrollEdge).
 *   Reduced motion: no tilt, scale or overshoot; the shadow and the slot stay.
 */
import {
  closestCenter,
  DndContext,
  DragOverlay,
  getClientRect,
  KeyboardSensor,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type ClientRect,
  type DragEndEvent,
  type DraggableNode,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimationFunction,
  type KeyboardSensorOptions,
  type MeasuringConfiguration,
  type Modifier,
  type MouseSensorOptions,
  type PointerSensorOptions,
  type TouchSensorOptions,
} from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { haptic } from './haptics';
import { leanOf, moveId, rubber, tiltStep } from './motion';

// ---------------------------------------------------------------- timing

const NEIGHBOURS = { duration: 260, easing: 'cubic-bezier(.25,1.25,.5,1)' };
const DROP = { duration: 320, easing: 'cubic-bezier(.34,1.4,.64,1)' };
const CALM = { duration: 120, easing: 'ease' };
/** Rows follow the finger sideways only a little. */
const ROW_X = 0.15;
/** How far past its list (px of finger) before a "refuse" list says no. */
const REFUSE_AT = 24;

const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Where auto-scroll starts, as a fraction of the window (top and bottom alike): at the floating
 * bar's top edge, so a pause to aim over the last rows above the bar never scrolls the page.
 */
function scrollEdge(): number {
  if (typeof window === 'undefined' || !window.innerHeight) return 0.1;
  const bar = document.querySelector('.tabbar:not(.tabbar--preview)')?.getBoundingClientRect();
  const under = bar && bar.height ? window.innerHeight - bar.top : 0;
  return Math.min(0.14, Math.max(0.08, (under + 12) / window.innerHeight));
}

// ---------------------------------------------------------------- sensors

/** Controls inside an item that never start a drag from the row body. */
const NO_DRAG = 'button, a, input, textarea, select, label, [role="switch"], [role="checkbox"], [contenteditable="true"], [data-drag]';

const inGrip = (t: EventTarget | null) => t instanceof Element && !!t.closest('[data-grip]');

/** May a press on `target` start a drag from the body of `item`? */
function bodyPress(target: EventTarget | null, item: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (inGrip(target)) return false;
  const hit = target.closest(NO_DRAG);
  return !hit || hit === item || hit.hasAttribute('data-drag') || !(item instanceof Element && item.contains(hit));
}

/** A grip: pointer down inside [data-grip], starts after 3px. */
class GripSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: e }: ReactPointerEvent, { onActivation }: PointerSensorOptions) => {
        if (!e.isPrimary || e.button !== 0 || !inGrip(e.target)) return false;
        onActivation?.({ event: e });
        return true;
      },
    },
  ];
}

/** A long-press on the row body (touch). */
class RowTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: (ev: ReactTouchEvent, { onActivation }: TouchSensorOptions) => {
        const e = ev.nativeEvent;
        if (e.touches.length > 1 || !bodyPress(e.target, ev.currentTarget)) return false;
        onActivation?.({ event: e });
        return true;
      },
    },
  ];
}

/** A press-and-move on the row body (mouse). */
class RowMouseSensor extends MouseSensor {
  static activators = [
    {
      eventName: 'onMouseDown' as const,
      handler: (ev: ReactMouseEvent, { onActivation }: MouseSensorOptions) => {
        const e = ev.nativeEvent;
        if (e.button !== 0 || !bodyPress(e.target, ev.currentTarget)) return false;
        onActivation?.({ event: e });
        return true;
      },
    },
  ];
}

/** Keyboard reordering, only from a focused grip (Space on a check must still tick it). */
class GripKeyboardSensor extends KeyboardSensor {
  static activators = [
    {
      eventName: 'onKeyDown' as const,
      handler: (ev: ReactKeyboardEvent, options: KeyboardSensorOptions, ctx: { active: DraggableNode }) =>
        inGrip(ev.target) && KeyboardSensor.activators[0].handler(ev, options, ctx),
    },
  ];
}

// ---------------------------------------------------------------- measuring and drop

/** Measure the overlay by its untilted wrapper, so tilt and scale don't skew where it lands. */
const MEASURING: MeasuringConfiguration = {
  dragOverlay: { measure: (node) => getClientRect(node.classList.contains('lift') && node.parentElement ? node.parentElement : node) },
};

/** The overlay glides into the slot while the lifted copy settles to its landing lean. */
const dropAnimation: DropAnimationFunction = async ({ active, dragOverlay, transform }) => {
  const quiet = calm();
  const { duration, easing } = quiet ? CALM : DROP;
  const opacity = active.node.style.opacity;
  active.node.style.opacity = '0';
  dragOverlay.node.classList.add('is-dropping');
  // The store tells React about the new order a microtask after the drop, so find the slot
  // on the next frame, once the row sits in its new place.
  await new Promise(requestAnimationFrame);
  if (!active.node.isConnected) return;
  const slot = getClientRect(active.node, { ignoreTransform: true });
  const to = { x: transform.x - (dragOverlay.rect.left - slot.left), y: transform.y - (dragOverlay.rect.top - slot.top), scaleX: 1, scaleY: 1 };
  const runs = [
    dragOverlay.node.animate([{ transform: CSS.Transform.toString(transform) }, { transform: CSS.Transform.toString(to) }], { duration, easing, fill: 'forwards' }),
  ];
  const lift = dragOverlay.node.firstElementChild;
  if (lift instanceof HTMLElement && !quiet) {
    // The landing beat, the same whatever the distance: it gives, swings back past its lean, settles.
    const cs = getComputedStyle(lift);
    const land = parseFloat(lift.style.getPropertyValue('--land')) || 0;
    const bg = cs.getPropertyValue('--land-bg').trim();
    const to = bg ? { backgroundColor: bg } : {};
    runs.push(
      lift.animate(
        [
          { offset: 0, easing: 'cubic-bezier(.3,0,.5,1)', transform: cs.transform, boxShadow: cs.boxShadow, ...(bg ? { backgroundColor: cs.backgroundColor } : {}) },
          { offset: 0.55, easing: 'cubic-bezier(.3,0,.4,1)', transform: `rotate(${land - 0.6}deg) scale(0.975)`, boxShadow: 'none', ...to },
          { offset: 0.8, easing: 'ease-out', transform: `rotate(${land + 0.2}deg) scale(1.01)`, boxShadow: 'none', ...to },
          { offset: 1, transform: `rotate(${land}deg) scale(1)`, boxShadow: 'none', ...to },
        ],
        { duration, easing: 'linear', fill: 'forwards' },
      ),
    );
  }
  return Promise.all(runs.map((a) => a.finished))
    .catch(() => undefined)
    .then(() => {
      active.node.style.opacity = opacity;
    });
};

// ---------------------------------------------------------------- items

interface ItemCtx {
  register: (id: string, el: HTMLElement | null) => void;
  transition: { duration: number; easing: string };
}

const SortCtx = createContext<ItemCtx | null>(null);

/** One movable item. Spread `props` on its element; a grip takes `gripRef` and `gripProps`. */
export function useSortableItem(id: string, { disabled }: { disabled?: boolean } = {}) {
  const ctx = useContext(SortCtx);
  const s = useSortable({ id, disabled, transition: ctx?.transition ?? NEIGHBOURS });
  const { setNodeRef } = s;
  const register = ctx?.register;
  const ref = useCallback(
    (el: HTMLElement | null) => {
      setNodeRef(el);
      register?.(id, el);
    },
    [setNodeRef, register, id],
  );
  return {
    ref,
    style: { transform: CSS.Translate.toString(s.transform), transition: s.transition } as CSSProperties,
    className: `is-sortable ${s.isDragging ? 'is-ghost' : ''}`,
    /** Listeners for the item, plus how to reorder it. Rows keep their own role: no button role or tab stop. */
    props: { ...s.listeners, 'aria-describedby': s.attributes['aria-describedby'] } as Record<string, unknown>,
    /** For a [data-grip] handle: the keyboard activator. */
    gripRef: s.setActivatorNodeRef,
    gripProps: s.attributes as unknown as Record<string, unknown>,
    isGhost: s.isDragging,
  };
}

// ---------------------------------------------------------------- the list

export interface SortableProps {
  ids: string[];
  onMove: (next: string[], id: string) => void;
  label: (id: string) => string;
  renderOverlay: (id: string) => ReactNode;
  layout?: 'rows' | 'grid';
  bounds?: 'soft' | 'refuse' | 'none';
  lean?: (id: string) => { rest: number; land: number };
  liftClass?: string;
  onPreview?: (draft: string[] | null) => void;
  onLift?: (id: string) => void;
  grips?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

const ROW_LEAN = { rest: 1.5, land: 0 };

/** Live drag state, shared by the modifiers (render) and the frame loop (rAF). */
interface Drag {
  id: string;
  /** The list it moves within (null: unbounded). */
  box: HTMLElement | null;
  /** The item's rect when it lifted (viewport px). */
  start: ClientRect;
  /** How far the finger is past the list's edge (px). */
  over: number;
  overId: string;
  stop: () => void;
}

export function Sortable({
  ids,
  onMove,
  label,
  renderOverlay,
  layout = 'rows',
  bounds = layout === 'rows' ? 'soft' : 'none',
  lean,
  liftClass,
  onPreview,
  onLift,
  grips,
  disabled,
  children,
}: SortableProps) {
  const sensors = useSensors(
    useSensor(GripSensor, { activationConstraint: { distance: 3 } }),
    useSensor(RowTouchSensor, { activationConstraint: { delay: 320, tolerance: 6 } }),
    useSensor(RowMouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(GripKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const lift = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef({ ids, onMove, onPreview, onLift, label });
  latest.current = { ids, onMove, onPreview, onLift, label };
  const leanFor = useCallback((id: string) => lean?.(id) ?? ROW_LEAN, [lean]);
  const rows = layout === 'rows';

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);
  const quiet = calm();
  const ctx = useMemo<ItemCtx>(() => ({ register, transition: quiet ? CALM : NEIGHBOURS }), [register, quiet]);

  const modifiers = useMemo<Modifier[]>(() => {
    if (!rows) return [];
    const damp: Modifier = ({ transform }) => ({ ...transform, x: transform.x * ROW_X });
    const keep: Modifier = ({ transform }) => {
      const d = drag.current;
      if (!d?.box) return transform;
      const c = d.box.getBoundingClientRect();
      const r = rubber(transform.y, c.top - d.start.top, c.bottom - d.start.top - d.start.height);
      d.over = r.over;
      return { ...transform, y: r.v };
    };
    return bounds === 'none' ? [damp] : [damp, keep];
  }, [rows, bounds]);

  /** The frame loop: velocity tilt on the overlay, and the refuse shake. */
  const loop = (d: Drag, rest: number, follow: 'touchmove' | 'pointermove' | null, quietNow: boolean) => {
    let vx = 0;
    let vy = 0;
    let vt = 0;
    let lx = NaN;
    let ly = NaN;
    let lt = 0;
    let raf = 0;
    let refusing = false;
    const wall = bounds === 'refuse' && d.box ? ((d.box.closest('[data-sort-bounds]') as HTMLElement | null) ?? d.box) : null;
    const onPoint = (e: Event) => {
      const p = 'touches' in e ? (e as TouchEvent).touches[0] : (e as PointerEvent);
      if (!p) return;
      if (!Number.isNaN(lx)) {
        const dt = Math.max(8, e.timeStamp - lt);
        vx = vx * 0.5 + ((p.clientX - lx) / dt) * 0.5;
        vy = vy * 0.5 + ((p.clientY - ly) / dt) * 0.5;
      }
      lx = p.clientX;
      ly = p.clientY;
      lt = e.timeStamp;
    };
    if (follow) window.addEventListener(follow, onPoint, { passive: true });
    const frame = (now: number) => {
      if (now - lt > 50) {
        vx *= 0.8;
        vy *= 0.8;
      }
      if (!quietNow) {
        vt = tiltStep(vt, vx, vy);
        lift.current?.style.setProperty('--lean', `${leanOf(rest, vt, rows).toFixed(2)}deg`);
      }
      if (wall) {
        if (!refusing && d.over > REFUSE_AT) {
          refusing = true;
          wall.classList.add('is-refusing');
          haptic('warn');
          setTimeout(() => wall.classList.remove('is-refusing'), 260);
        } else if (refusing && d.over < 8) refusing = false;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      if (follow) window.removeEventListener(follow, onPoint);
      wall?.classList.remove('is-refusing');
    };
  };

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const id = String(active.id);
    const node = nodes.current.get(id) ?? null;
    const start = node ? getClientRect(node, { ignoreTransform: true }) : active.rect.current.initial;
    if (!start) return;
    const d: Drag = { id, box: bounds === 'none' ? null : (node?.parentElement ?? null), start, over: 0, overId: id, stop: () => undefined };
    drag.current = d;
    const follow =
      typeof TouchEvent !== 'undefined' && activatorEvent instanceof TouchEvent ? 'touchmove' : activatorEvent instanceof KeyboardEvent ? null : 'pointermove';
    d.stop = loop(d, leanFor(id).rest, follow, calm());
    document.documentElement.classList.add('is-dragging');
    setActiveId(id);
    haptic('lift');
    latest.current.onLift?.(id);
  };

  const onDragOver = ({ over }: DragOverEvent) => {
    const d = drag.current;
    if (!d || !over || String(over.id) === d.overId) return;
    d.overId = String(over.id);
    haptic('select');
    latest.current.onPreview?.(moveId(latest.current.ids, d.id, d.overId));
  };

  const finish = () => {
    drag.current?.stop();
    drag.current = null;
    document.documentElement.classList.remove('is-dragging');
    setActiveId(null);
    latest.current.onPreview?.(null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    finish();
    haptic('drop');
    if (over && String(over.id) !== id) latest.current.onMove(moveId(latest.current.ids, id, String(over.id)), id);
  };

  const announcements = useMemo<Announcements>(() => {
    const name = (id: string | number) => latest.current.label(String(id));
    const pos = (id: string | number) => latest.current.ids.indexOf(String(id)) + 1;
    return {
      onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
      onDragOver: ({ active, over }) => (over ? `${name(active.id)}, position ${pos(over.id)} of ${latest.current.ids.length}.` : undefined),
      onDragEnd: ({ active, over }) => (over ? `Dropped ${name(active.id)} at position ${pos(over.id)}.` : `Dropped ${name(active.id)}.`),
      onDragCancel: () => 'Cancelled.',
    };
  }, []);

  const landing = activeId ? leanFor(activeId) : ROW_LEAN;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={modifiers}
      measuring={MEASURING}
      autoScroll={{ threshold: { x: 0, y: scrollEdge() }, acceleration: 8 }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: grips
            ? 'Press space to pick up. Use the arrow keys to move, space to drop, escape to cancel.'
            : 'To reorder, press and hold, then drag.',
        },
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
    >
      <SortCtx.Provider value={ctx}>
        <SortableContext items={ids} strategy={rows ? verticalListSortingStrategy : rectSortingStrategy} disabled={disabled}>
          {children}
        </SortableContext>
      </SortCtx.Provider>
      {createPortal(
        <DragOverlay zIndex={70} dropAnimation={dropAnimation} className="dragwrap">
          {activeId ? (
            <div
              ref={lift}
              className={`lift is-lifted ${rows ? 'lift--row' : 'lift--card'} ${liftClass ?? ''}`}
              style={{ '--lean': `${landing.rest}deg`, '--land': `${landing.land}deg` } as CSSProperties}
            >
              {renderOverlay(activeId)}
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

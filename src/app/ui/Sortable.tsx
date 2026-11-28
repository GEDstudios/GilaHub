/**
 * Sortable: the one drag-to-reorder in Gila Hub. Task rows and steps (Children), a shopping
 * aisle (Shopping), folder folders (Lists), and the bottom bar's editors (BarEditor, BarEdit) and Edit Today (TodayArrange)
 * all use it, so they feel the same.
 *
 * API
 *   <Sortable
 *     ids={ids}                         the order now (only items that can move)
 *     onMove={(next, id) => …}          called once, on drop, with the new order
 *     label={(id) => 'Milk'}            for screen-reader announcements
 *     renderOverlay={(id, { outside }) => …}  the lifted copy (rows: <ul className="rows"><Row/></ul>);
 *                                       `outside`: over the `outside` target instead of the list
 *     layout="rows" | "grid" | "bar"    rows: a vertical list (default); grid: wrapping cards;
 *                                       bar: the bottom bar's tabs (horizontal, y damped, the dock
 *                                       steps at its edges, no page auto-scroll)
 *     bounds="soft" | "refuse" | "none" rows default to "soft": the row rubber-bands at its list's
 *                                       edges. "refuse" also shakes the nearest [data-sort-bounds]
 *                                       (or the list) and buzzes `warn` once dragged >24px out.
 *     lean={(id) => ({ rest, land })}   degrees: the resting lean while lifted, and where it lands.
 *                                       Rows: 1.5 / 0. Folders: tilt(id) + 3 / tilt(id).
 *     liftClass="…"                     extra class on the lifted wrapper
 *     onPreview={(draft | null) => …}   the order as it would drop, on each new spot; null at the end
 *     onLift={(id) => …}                a drag started, with the lifted id
 *     grips                             items have a [data-grip] handle (keyboard reordering)
 *     outside={{ hit, aim, drop, … }}   a target outside the list, found by the pointer alone (the
 *                                       live bar lives in App, far from this DndContext): while
 *                                       hit(p) the list lets go (no "over"), aim(p, id) runs every
 *                                       frame (then aim(null, id) once), and letting go there calls
 *                                       drop(id, p) instead of onMove, with a short fade
 *     hint={<PullHint />}               a small note above the one in the hand while it's in the list
 *     still                             items lift but never reorder (the bar's tray tokens)
 *     disabled>
 *     …children, whose items call useSortableItem(id)…
 *   </Sortable>
 *
 *   const s = useSortableItem(id, { disabled });
 *   <li ref={s.ref} style={s.style} className={s.className} {...s.props}>…</li>
 *   With a grip (TodayArrange): s.props still go on the row (a long-press on the body lifts it on
 *   touch), and the handle is
 *   <button data-grip ref={s.gripRef} {...s.gripProps} aria-label="Reorder Milk">.
 *   A whole-object grip (a bar tab): [data-grip] on the object itself, with s.props, and the
 *   keyboard activator (s.gripRef, s.gripProps) on a focusable element inside it. Controls inside
 *   the object (its ×) never lift it.
 *
 * Starting a drag
 *   - a grip ([data-grip]), mouse or pen: after 3px, no delay
 *   - a grip, touch: a 120ms press within 6px. A flick that starts on a grip scrolls the page
 *     (the grip is touch-action:pan-y; in the bar's dock, pan-x), since Settings' grips run down
 *     the right edge, where a right thumb scrolls; once it lifts, the drag stops the page panning.
 *   - touch on the row body: a 320ms long-press within 6px; moving first scrolls the page
 *     (shorter would catch an unhurried tap, ~250ms, and lift the row instead of opening it)
 *   - mouse on the row body: after 4px
 *   - keyboard, from a focused grip: Space/Enter picks up, arrows move, Space drops, Esc cancels
 *   Buttons, links, inputs, switches and the check never start one. A button marked
 *   [data-drag] (a folder card) can be dragged by its body.
 *
 * Feel (docs/03-DESIGN-SYSTEM.md, Motion)
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
  MeasuringStrategy,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type ClientRect,
  type CollisionDetection,
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
import {
  horizontalListSortingStrategy,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS, getEventCoordinates } from '@dnd-kit/utilities';
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
import { stepDock, type DockStep } from '../barEdit';
import { haptic } from './haptics';
import { leanOf, moveId, rubber, tiltStep } from './motion';
import { calm, DUR, EASE, HOLD, SLOP, Z } from './tokens';

// ---------------------------------------------------------------- timing

const NEIGHBOURS = { duration: 260, easing: 'cubic-bezier(.25,1.25,.5,1)' };
const DROP = { duration: DUR.slow, easing: EASE.springSoft };
const CALM = { duration: 120, easing: 'ease' };
/** Rows follow the finger sideways only a little, and bar tabs up and down. */
const ROW_X = 0.15;
/** Let go over an outside target: the copy fades and shrinks where it is. */
const OUT_DROP = 140;
/** A tab in the hand leans this way (in the bar, or a folder or token over it). */
const TAB_LEAN = -4;
/** How far past its list (px of finger) before a "refuse" list says no. */
const REFUSE_AT = 24;


/**
 * Where auto-scroll starts, as a fraction of the window (top and bottom alike): at the floating
 * bar's top edge, so a pause to aim over the last rows above the bar never scrolls the page.
 */
function scrollEdge(): number {
  if (typeof window === 'undefined' || !window.innerHeight) return 0.1;
  const bar = document.querySelector('.tabbar')?.getBoundingClientRect();
  const under = bar && bar.height ? window.innerHeight - bar.top : 0;
  return Math.min(0.14, Math.max(0.08, (under + 12) / window.innerHeight));
}

// ---------------------------------------------------------------- sensors

/** Controls inside an item that never start a drag from the row body. */
const NO_DRAG = 'button, a, input, textarea, select, label, [role="switch"], [role="checkbox"], [contenteditable="true"], [data-drag]';

/** Is a press on `t` on a grip: a handle, or a whole object, but never a control inside one? */
function inGrip(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  const grip = t.closest('[data-grip]');
  if (!grip) return false;
  const hit = t.closest(NO_DRAG);
  return !hit || hit === grip || !grip.contains(hit) || hit.hasAttribute('data-drag');
}

/** May a press on `target` start a drag from the body of `item`? */
function bodyPress(target: EventTarget | null, item: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (inGrip(target)) return false;
  const hit = target.closest(NO_DRAG);
  return !hit || hit === item || hit.hasAttribute('data-drag') || !(item instanceof Element && item.contains(hit));
}

/** A grip, with a mouse or pen: pointer down inside [data-grip], starts after 3px. (Touch: RowTouchSensor.) */
class GripSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: e }: ReactPointerEvent, { onActivation }: PointerSensorOptions) => {
        if (!e.isPrimary || e.button !== 0 || e.pointerType === 'touch' || !inGrip(e.target)) return false;
        onActivation?.({ event: e });
        return true;
      },
    },
  ];
}

/** On a grip, a touch lifts after this short press; moving sooner is a scroll. */
const GRIP_TOUCH = { delay: HOLD.handle, tolerance: SLOP.hold };

/**
 * Touch: a long-press on the row body, or a short press on its grip. One sensor for both, since
 * an item takes one touchstart listener.
 */
class RowTouchSensor extends TouchSensor {
  constructor(props: ConstructorParameters<typeof TouchSensor>[0]) {
    super(inGrip(props.event.target) ? { ...props, options: { ...props.options, activationConstraint: GRIP_TOUCH } } : props);
  }

  static activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: (ev: ReactTouchEvent, { onActivation }: TouchSensorOptions) => {
        const e = ev.nativeEvent;
        if (e.touches.length > 1 || !(inGrip(e.target) || bodyPress(e.target, ev.currentTarget))) return false;
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

/**
 * The overlay is measured by its untilted wrapper, so tilt and scale don't skew where it lands.
 * Items are re-measured as they move: the bar's dock scrolls under the hand, a task held over unfolds.
 */
const MEASURING: MeasuringConfiguration = {
  dragOverlay: { measure: (node) => getClientRect(node.classList.contains('lift') && node.parentElement ? node.parentElement : node) },
  droppable: { strategy: MeasuringStrategy.Always },
};

/** Let go over an outside target: the copy fades and shrinks on the spot (reduced motion: fades). */
const fadeOut: DropAnimationFunction = ({ dragOverlay }) => {
  const lift = dragOverlay.node.firstElementChild;
  const runs = [...dragOverlay.node.children].map((el) =>
    el === lift && !calm()
      ? el.animate([{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.8 }], { duration: OUT_DROP, easing: 'ease-in', fill: 'forwards' })
      : el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OUT_DROP, easing: 'ease-in', fill: 'forwards' }),
  );
  return Promise.all(runs.map((a) => a.finished))
    .catch(() => undefined)
    .then(() => undefined);
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

export interface Point {
  x: number;
  y: number;
}

/** A drop target outside the list, found by the pointer (viewport px). */
export interface Outside {
  hit: (p: Point) => boolean;
  /** Every frame while over it; then once with null when the pointer leaves it. */
  aim: (p: Point | null, id: string) => void;
  /** Let go over it (instead of onMove). */
  drop: (id: string, p: Point) => void;
  /** A drag started / ended (dropped or cancelled). */
  lift?: (id: string) => void;
  end?: () => void;
  /** Shown over the hand while it is over the target ("Let go to take it out"). */
  note?: ReactNode;
}

interface SortableProps {
  ids: string[];
  onMove: (next: string[], id: string) => void;
  label: (id: string) => string;
  renderOverlay: (id: string, state: { outside: boolean }) => ReactNode;
  layout?: 'rows' | 'grid' | 'bar';
  bounds?: 'soft' | 'refuse' | 'none';
  lean?: (id: string) => { rest: number; land: number };
  liftClass?: string;
  onPreview?: (draft: string[] | null) => void;
  onLift?: (id: string) => void;
  grips?: boolean;
  /** Screen-reader instructions, when the default doesn't say it all. */
  instructions?: string;
  outside?: Outside;
  /** A small note riding above the one in the hand while it's in the list (what a pull does). */
  hint?: ReactNode;
  still?: boolean;
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
  /** Where the pointer went down, and where it is now (viewport px; null for the keyboard). */
  origin: Point | null;
  p: Point | null;
  /** `p` is the pointer itself (from its own events), not worked out from the drag's offset,
   *  which shifts when rows open or close around the one in the hand. */
  felt: boolean;
  /** Over the outside target. */
  out: boolean;
  /** The bar's dock, stepping at its edges. */
  edge: DockStep;
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
  instructions,
  outside,
  hint,
  still,
  disabled,
  children,
}: SortableProps) {
  const sensors = useSensors(
    useSensor(GripSensor, { activationConstraint: { distance: SLOP.mouse } }),
    useSensor(RowTouchSensor, { activationConstraint: { delay: HOLD.press, tolerance: SLOP.hold } }),
    useSensor(RowMouseSensor, { activationConstraint: { distance: SLOP.mouse } }),
    useSensor(GripKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Over the outside target (the overlay turns into what lands there). */
  const [outNow, setOutNow] = useState(false);
  /** Where the hand holds the lifted copy, from its top-left (an outside copy sits over it). */
  const [grab, setGrab] = useState<Point>({ x: 0, y: 0 });
  const nodes = useRef(new Map<string, HTMLElement>());
  const lift = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** The drop that is under way went to the outside target. */
  const droppedOut = useRef(false);
  const latest = useRef({ ids, onMove, onPreview, onLift, label, outside });
  latest.current = { ids, onMove, onPreview, onLift, label, outside };
  const leanFor = useCallback((id: string) => lean?.(id) ?? ROW_LEAN, [lean]);
  const rows = layout === 'rows';
  const bar = layout === 'bar';

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);
  const quiet = calm();
  const ctx = useMemo<ItemCtx>(() => ({ register, transition: quiet ? CALM : NEIGHBOURS }), [register, quiet]);

  const modifiers = useMemo<Modifier[]>(() => {
    // First, before anything bends it: where the finger is, and whether that is the outside target.
    const probe: Modifier = ({ transform }) => {
      const d = drag.current;
      if (d?.origin) {
        if (!d.felt) d.p = { x: d.origin.x + transform.x, y: d.origin.y + transform.y };
        d.out = !!latest.current.outside?.hit(d.p!);
      }
      return transform;
    };
    if (bar) return [probe, ({ transform }) => (drag.current?.out ? transform : { ...transform, y: transform.y * ROW_X })];
    if (!rows) return [probe];
    // A row moves up and down, only a little sideways; over an outside target it follows the hand.
    const damp: Modifier = ({ transform }) => (drag.current?.out ? transform : { ...transform, x: transform.x * ROW_X });
    const keep: Modifier = ({ transform }) => {
      const d = drag.current;
      if (!d?.box) return transform;
      const c = d.box.getBoundingClientRect();
      const r = rubber(transform.y, c.top - d.start.top, c.bottom - d.start.top - d.start.height);
      d.over = r.over;
      return { ...transform, y: r.v };
    };
    return bounds === 'none' ? [probe, damp] : [probe, damp, keep];
  }, [rows, bar, bounds]);

  /** Nothing is "over" while the hand is at the outside target, or ever for still items. */
  const collisions = useCallback<CollisionDetection>((args) => (still || drag.current?.out ? [] : closestCenter(args)), [still]);

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
    let wasOut = false;
    const nav = bar ? (nodes.current.get(d.id)?.closest<HTMLElement>('.tabbar') ?? null) : null;
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
      d.p = { x: p.clientX, y: p.clientY };
      d.felt = true;
    };
    if (follow) window.addEventListener(follow, onPoint, { passive: true });
    const frame = (now: number) => {
      if (now - lt > 50) {
        vx *= 0.8;
        vy *= 0.8;
      }
      const out = d.out;
      if (out !== wasOut) {
        wasOut = out;
        haptic('select');
        setOutNow(out);
        if (!out) latest.current.outside?.aim(null, d.id);
      }
      if (out && d.p) latest.current.outside?.aim(d.p, d.id);
      else if (nav && d.p) stepDock(nav, d.p.x, now, d.edge, quietNow);
      if (!quietNow) {
        vt = tiltStep(vt, vx, vy);
        lift.current?.style.setProperty('--lean', `${leanOf(out ? TAB_LEAN : rest, vt, rows).toFixed(2)}deg`);
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
    const origin = activatorEvent instanceof KeyboardEvent ? null : getEventCoordinates(activatorEvent);
    const d: Drag = {
      id,
      box: bounds === 'none' ? null : (node?.parentElement ?? null),
      start,
      over: 0,
      overId: id,
      stop: () => undefined,
      origin,
      p: origin,
      felt: false,
      out: false,
      edge: { dir: 0, next: 0 },
    };
    drag.current = d;
    droppedOut.current = false;
    setGrab(origin ? { x: origin.x - start.left, y: origin.y - start.top } : { x: start.width / 2, y: start.height / 2 });
    setOutNow(false);
    const follow =
      typeof TouchEvent !== 'undefined' && activatorEvent instanceof TouchEvent ? 'touchmove' : activatorEvent instanceof KeyboardEvent ? null : 'pointermove';
    d.stop = loop(d, leanFor(id).rest, follow, calm());
    document.documentElement.classList.add('is-dragging');
    setActiveId(id);
    haptic('lift');
    latest.current.onLift?.(id);
    latest.current.outside?.lift?.(id);
  };

  const onDragOver = ({ over }: DragOverEvent) => {
    const d = drag.current;
    if (!d || !over || String(over.id) === d.overId) return;
    d.overId = String(over.id);
    haptic('select');
    latest.current.onPreview?.(moveId(latest.current.ids, d.id, d.overId));
  };

  const finish = () => {
    const d = drag.current;
    d?.stop();
    drag.current = null;
    document.documentElement.classList.remove('is-dragging');
    setActiveId(null);
    setOutNow(false);
    latest.current.onPreview?.(null);
    if (d?.out) latest.current.outside?.aim(null, d.id);
    latest.current.outside?.end?.();
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const d = drag.current;
    haptic('drop');
    if (d?.out && d.p && latest.current.outside) {
      droppedOut.current = true;
      latest.current.outside.drop(id, d.p);
      finish();
      return;
    }
    finish();
    if (!still && over && String(over.id) !== id) latest.current.onMove(moveId(latest.current.ids, id, String(over.id)), id);
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
  /** Let go over the outside target: no glide back to the slot, the copy just goes. */
  const drop = useCallback<DropAnimationFunction>((args) => (droppedOut.current ? fadeOut(args) : dropAnimation(args)), []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisions}
      modifiers={modifiers}
      measuring={MEASURING}
      // The bar's dock steps by itself (stepDock); elsewhere the page scrolls, but never while
      // the hand is at the outside target.
      autoScroll={bar ? false : { threshold: { x: 0, y: scrollEdge() }, acceleration: 8, canScroll: () => !drag.current?.out }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            instructions ??
            (grips ? 'Press space to pick up. Use the arrow keys to move, space to drop, escape to cancel.' : 'To reorder, press and hold, then drag.'),
        },
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
    >
      <SortCtx.Provider value={ctx}>
        <SortableContext
          items={ids}
          strategy={rows ? verticalListSortingStrategy : bar ? horizontalListSortingStrategy : rectSortingStrategy}
          disabled={disabled}
        >
          {children}
        </SortableContext>
      </SortCtx.Provider>
      {createPortal(
        <DragOverlay
          zIndex={Z.drag}
          dropAnimation={drop}
          className="dragwrap"
          style={{ '--gx': `${grab.x}px`, '--gy': `${grab.y}px` } as CSSProperties}
        >
          {activeId ? (
            <div
              ref={lift}
              className={`lift is-lifted ${rows ? 'lift--row' : bar ? 'lift--tab' : 'lift--card'} ${outNow ? 'is-outside' : ''} ${liftClass ?? ''}`}
              style={{ '--lean': `${outNow ? TAB_LEAN : landing.rest}deg`, '--land': `${landing.land}deg` } as CSSProperties}
            >
              {renderOverlay(activeId, { outside: outNow })}
            </div>
          ) : null}
          {activeId && outNow && outside?.note ? <div className="lift__note">{outside.note}</div> : null}
          {activeId && !outNow && hint ? <div className="lift__hint">{hint}</div> : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

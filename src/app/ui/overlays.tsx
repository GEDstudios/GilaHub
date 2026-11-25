import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { clamp, flickSpeed, foldToast, sheetCloses, sheetPull, toastSwipedAway } from './motion';

// ---------------------------------------------------------------- sheets

type SheetRender = (close: () => void) => ReactNode;
interface SheetEntry {
  id: number;
  render: SheetRender;
}

export interface ToastOpts {
  action?: { label: string; run: () => void };
  ms?: number;
  /**
   * Toasts of one group fold into one while it shows ("3 in the cart"); Undo then undoes
   * them all, newest first. `many` words the count.
   */
  group?: string;
  many?: (n: number) => string;
}

interface OverlayApi {
  openSheet: (render: SheetRender) => number;
  closeSheet: (id?: number) => void;
  toast: (message: string, opts?: ToastOpts) => void;
}

/** Plain ticks in a row fold into one toast: "3 done". */
export const doneMany = (n: number) => `${n} done`;

const OverlayCtx = createContext<OverlayApi | null>(null);

export function useOverlays(): OverlayApi {
  const v = useContext(OverlayCtx);
  if (!v) throw new Error('OverlayProvider missing');
  return v;
}

interface ToastEntry {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  group?: string;
  many?: (n: number) => string;
  count: number;
  /** Bumps when a toast of its group folds in, so it pops again. */
  bump: number;
  leaving?: boolean;
}

/** At most this many toasts show at once; older ones step aside. */
const MAX_TOASTS = 2;
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let seq = 1;

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [sheets, setSheets] = useState<SheetEntry[]>([]);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const live = useRef<ToastEntry[]>([]);
  live.current = toasts;
  const timers = useRef(new Map<number, { t?: ReturnType<typeof setTimeout>; end: number }>());
  const top = useKeyboardNearBottom();

  const closeSheet = useCallback((id?: number) => {
    setSheets((s) => (id === undefined ? s.slice(0, -1) : s.filter((x) => x.id !== id)));
  }, []);

  const openSheet = useCallback((render: SheetRender) => {
    const id = seq++;
    setSheets((s) => [...s, { id, render }]);
    return id;
  }, []);

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)?.t;
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((all) => all.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 200);
  }, []);

  const arm = useCallback(
    (id: number, ms: number) => {
      const t = timers.current.get(id)?.t;
      if (t) clearTimeout(t);
      timers.current.set(id, { t: setTimeout(() => dismiss(id), ms), end: Date.now() + ms });
    },
    [dismiss],
  );

  /** A finger on a toast holds it; letting go gives it a little more time. */
  const hold = useCallback(
    (id: number, held: boolean) => {
      if (!live.current.some((x) => x.id === id && !x.leaving)) return;
      const t = timers.current.get(id);
      if (t?.t) clearTimeout(t.t);
      if (held) timers.current.set(id, { end: t?.end ?? Date.now() });
      else arm(id, Math.max(1500, (t?.end ?? 0) - Date.now()));
    },
    [arm],
  );

  const toast = useCallback<OverlayApi['toast']>(
    (message, opts = {}) => {
      const ms = opts.ms ?? (opts.action ? 5500 : 3200);
      const next = { message, action: opts.action, group: opts.group, many: opts.many };
      const prev = [...live.current].reverse().find((x) => !x.leaving);
      const folded = prev ? foldToast(prev, next) : null;
      if (prev && folded) {
        const entry = { ...folded, bump: prev.bump + 1 };
        live.current = live.current.map((x) => (x.id === prev.id ? entry : x));
        setToasts(live.current);
        arm(prev.id, ms);
        return;
      }
      const id = seq++;
      const shown = live.current.filter((x) => !x.leaving);
      for (const old of shown.slice(0, Math.max(0, shown.length - (MAX_TOASTS - 1)))) dismiss(old.id);
      live.current = [...live.current, { id, ...next, count: 1, bump: 0 }];
      setToasts(live.current);
      arm(id, ms);
    },
    [arm, dismiss],
  );

  const api = useMemo(() => ({ openSheet, closeSheet, toast }), [openSheet, closeSheet, toast]);

  return (
    <OverlayCtx.Provider value={api}>
      {children}
      {sheets.map((s) => (
        <SheetHost key={s.id} onClosed={() => closeSheet(s.id)} render={s.render} />
      ))}
      {createPortal(
        <div className={`toasts ${top ? 'toasts--top' : ''}`} role="status" aria-live="polite">
          {toasts.map((t) => (
            <Toast key={t.id} entry={t} onDismiss={() => dismiss(t.id)} onHold={(h) => hold(t.id, h)} />
          ))}
        </div>,
        document.body,
      )}
    </OverlayCtx.Provider>
  );
}

/** One toast: swipe it sideways to send it away; a finger on it keeps it. */
function Toast({ entry: t, onDismiss, onHold }: { entry: ToastEntry; onDismiss: () => void; onHold: (held: boolean) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; dx: number; id: number; samples: Array<[number, number]> } | null>(null);
  const [gone, setGone] = useState<number>(0);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, dx: 0, id: e.pointerId, samples: [[e.timeStamp, e.clientX]] };
    onHold(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !el.current) return;
    d.dx = e.clientX - d.x;
    d.samples.push([e.timeStamp, e.clientX]);
    if (Math.abs(d.dx) > 6 && !el.current.hasPointerCapture(e.pointerId)) el.current.setPointerCapture(e.pointerId);
    el.current.style.transition = 'none';
    el.current.style.transform = `translateX(${d.dx}px)`;
    el.current.style.opacity = String(clamp(1 - Math.abs(d.dx) / 220, 0.2, 1));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    onHold(false);
    const node = el.current;
    if (!d || !node) return;
    if (toastSwipedAway(d.dx, flickSpeed(d.samples))) {
      setGone(Math.sign(d.dx) || 1);
      node.style.transition = calm() ? 'none' : 'transform 200ms var(--ease), opacity 200ms var(--ease)';
      node.style.transform = `translateX(${(Math.sign(d.dx) || 1) * 120}%)`;
      node.style.opacity = '0';
      onDismiss();
      e.preventDefault();
      return;
    }
    node.style.transition = calm() ? 'none' : 'transform 320ms var(--spring), opacity 200ms var(--ease)';
    node.style.transform = '';
    node.style.opacity = '';
  };

  return (
    <div
      ref={el}
      key={t.bump}
      className={`toast ${t.leaving && !gone ? 'is-leaving' : ''} ${t.bump ? 'is-bumped' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span dir="auto">{t.message}</span>
      {t.action ? (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            if (gone) return;
            t.action!.run();
            onDismiss();
          }}
        >
          {t.action.label}
        </button>
      ) : null}
    </div>
  );
}

/** True while the keyboard is up for a field near the bottom: toasts then show at the top. */
function useKeyboardNearBottom(): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const check = () => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || !a.matches('input, textarea, [contenteditable="true"]')) return setNear(false);
      const h = window.visualViewport?.height ?? window.innerHeight;
      setNear(a.getBoundingClientRect().bottom > h - 160);
    };
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    window.visualViewport?.addEventListener('resize', check);
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
      window.visualViewport?.removeEventListener('resize', check);
    };
  }, []);
  return near;
}

const SheetClosingCtx = createContext(false);

function SheetHost({ render, onClosed }: { render: SheetRender; onClosed: () => void }) {
  const [closing, setClosing] = useState(false);
  const done = useRef(false);
  const close = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setClosing(true);
    setTimeout(onClosed, 210);
  }, [onClosed]);
  return <SheetClosingCtx.Provider value={closing}>{render(close)}</SheetClosingCtx.Provider>;
}

/**
 * Pull a sheet down to close it: from its handle or title any time, or from its body once
 * it's scrolled to the top. The scrim fades with the finger; a short pull springs back.
 */
function useSheetPull(panel: React.RefObject<HTMLDivElement | null>, scrim: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  // A re-render mid-pull (a sync, a sheet's own state) must not drop the gesture.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    let s: { x: number; y: number; grip: boolean; on: boolean; dy: number; samples: Array<[number, number]> } | null = null;
    const paint = (dy: number) => {
      const y = sheetPull(dy);
      el.style.transform = `translateY(${y}px)`;
      if (scrim.current) scrim.current.style.opacity = String(clamp(1 - y / el.offsetHeight, 0, 1));
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || matchMedia('(min-width: 720px)').matches) return;
      const target = e.target as HTMLElement;
      const grip = !!target.closest('.sheet__handle, .sheet__title');
      // Fields, sliders and sideways strips keep their own gestures.
      if (!grip && target.closest('input, textarea, select, [contenteditable="true"], .tokens--scroll, [data-no-pull]')) return;
      const t = e.touches[0];
      s = { x: t.clientX, y: t.clientY, grip, on: false, dy: 0, samples: [[e.timeStamp, t.clientY]] };
    };
    const onMove = (e: TouchEvent) => {
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (!s.on) {
        if (!s.grip) {
          // The body only pulls when it's at the top and the finger goes down, not sideways.
          if (el.scrollTop > 0 || dy < 0 || Math.abs(dx) > Math.abs(dy)) {
            if (Math.abs(dx) > 6 || Math.abs(dy) > 6) s = null;
            return;
          }
          if (dy < 6) return;
        }
        s.on = true;
        el.classList.add('is-pulling');
      }
      e.preventDefault();
      s.dy = dy;
      s.samples.push([e.timeStamp, t.clientY]);
      paint(dy);
    };
    const onEnd = () => {
      const d = s;
      s = null;
      if (!d?.on) return;
      el.classList.remove('is-pulling');
      if (sheetCloses(d.dy, el.offsetHeight, flickSpeed(d.samples))) return close.current();
      const spring = calm() ? 'none' : 'transform 420ms cubic-bezier(.34,1.4,.64,1)';
      el.style.transition = spring;
      el.style.transform = '';
      if (scrim.current) {
        scrim.current.style.transition = calm() ? 'none' : 'opacity 300ms var(--ease)';
        scrim.current.style.opacity = '';
      }
      setTimeout(() => {
        el.style.transition = '';
        if (scrim.current) scrim.current.style.transition = '';
      }, 440);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [panel, scrim]);
}

/** The sheet chrome. Use inside `openSheet((close) => <Sheet onClose={close}>…</Sheet>)`. */
export function Sheet({
  onClose,
  title,
  children,
  label,
  wide,
}: {
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  label?: string;
  wide?: boolean;
}) {
  const closing = useContext(SheetClosingCtx);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  useSheetPull(panel, scrim, onClose);
  const close = useRef(onClose);
  close.current = onClose;

  // Once per sheet (not per render: typing in it must not move the focus back to the top).
  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea');
      if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
    }, 60);
    return () => {
      document.documentElement.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, []);

  return createPortal(
    <div className={`sheet ${closing ? 'is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
      <div className="sheet__scrim" ref={scrim} onClick={onClose} />
      <div className="sheet__panel" ref={panel} style={wide ? { maxWidth: 760 } : undefined}>
        <div className="sheet__handle" aria-hidden="true" />
        <button type="button" className="iconbtn sheet__close" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
        {title ? <h2 className="sheet__title">{title}</h2> : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}

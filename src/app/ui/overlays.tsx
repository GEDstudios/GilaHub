import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

// ---------------------------------------------------------------- sheets

type SheetRender = (close: () => void) => ReactNode;
interface SheetEntry {
  id: number;
  render: SheetRender;
}

interface OverlayApi {
  openSheet: (render: SheetRender) => number;
  closeSheet: (id?: number) => void;
  toast: (message: string, opts?: { action?: { label: string; run: () => void }; ms?: number }) => void;
}

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
  leaving?: boolean;
}

let seq = 1;

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [sheets, setSheets] = useState<SheetEntry[]>([]);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const closeSheet = useCallback((id?: number) => {
    setSheets((s) => (id === undefined ? s.slice(0, -1) : s.filter((x) => x.id !== id)));
  }, []);

  const openSheet = useCallback((render: SheetRender) => {
    const id = seq++;
    setSheets((s) => [...s, { id, render }]);
    return id;
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 200);
  }, []);

  const toast = useCallback<OverlayApi['toast']>(
    (message, opts = {}) => {
      const id = seq++;
      setToasts([{ id, message, action: opts.action }]);
      setTimeout(() => dismiss(id), opts.ms ?? (opts.action ? 5500 : 3200));
    },
    [dismiss],
  );

  const api = useMemo(() => ({ openSheet, closeSheet, toast }), [openSheet, closeSheet, toast]);

  return (
    <OverlayCtx.Provider value={api}>
      {children}
      {sheets.map((s) => (
        <SheetHost key={s.id} onClosed={() => closeSheet(s.id)} render={s.render} />
      ))}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.leaving ? 'is-leaving' : ''}`}>
              <span dir="auto">{t.message}</span>
              {t.action ? (
                <button
                  type="button"
                  className="toast__action"
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </OverlayCtx.Provider>
  );
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
  const drag = useRef<{ y: number; dy: number } | null>(null);

  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
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
  }, [onClose]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    const el = panel.current;
    if (!el || el.scrollTop > 0) return;
    drag.current = { y: e.clientY, dy: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = panel.current;
    if (!d || !el) return;
    d.dy = Math.max(0, e.clientY - d.y);
    if (d.dy > 4) el.style.transform = `translateY(${d.dy}px)`;
  };
  const onPointerUp = () => {
    const d = drag.current;
    const el = panel.current;
    drag.current = null;
    if (!d || !el) return;
    if (d.dy > 110) onClose();
    else el.style.transform = '';
  };

  return createPortal(
    <div className={`sheet ${closing ? 'is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
      <div className="sheet__scrim" onClick={onClose} />
      <div
        className="sheet__panel"
        ref={panel}
        style={wide ? { maxWidth: 760 } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="sheet__handle" />
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

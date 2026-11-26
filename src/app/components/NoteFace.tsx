import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { LineColor } from '../../core/model';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { lineVars } from '../ui/primitives';
import { SketchSheet, useShotPicker } from './Sketch';

/**
 * One note, drawn the same everywhere: stuck on a screen, big while you write it, small on Our
 * notes. It's laid out on a 124-point square of paper and scaled, so what you see while writing
 * is exactly what lands. A photo sits on it like a sticker (anywhere, turned, sized; it may hang
 * a little off the paper), cut to a shape and framed; and you can draw on the note itself
 * (strokes kept as tiny vector lines: sharp at any size).
 */

export const PAPER = 124;

export type PhotoShape = 'square' | 'squircle' | 'circle' | 'star' | 'heart' | 'flower';
export type PhotoBorder = 'none' | 'white' | 'ink' | 'tape';
/** Where the photo sits on the paper: its middle (x, y), its size (s) and its turn (r, degrees). */
export type PhotoPos = { x: number; y: number; s: number; r: number };
export type Stroke = { c: string; w: number; p: string };

export interface NoteLook {
  text: string;
  color: LineColor;
  by: string;
  photo: string | null;
  shape: PhotoShape;
  border: PhotoBorder;
  pos: PhotoPos;
  ink: Stroke[];
}

export const NOTE_COLORS: LineColor[] = ['lemon', 'pink', 'sky', 'mint', 'lilac'];
/** A new photo: stuck on near the top corner, a little crooked. */
export const PHOTO_HOME: PhotoPos = { x: 92, y: 30, s: 58, r: 7 };
const S_MIN = 22;
const S_MAX = 170;
/** How far past the paper's edge a photo's middle may go. */
const OVER = 10;

export const keepPos = (p: PhotoPos): PhotoPos => ({
  x: Math.round(Math.min(PAPER + OVER, Math.max(-OVER, p.x)) * 10) / 10,
  y: Math.round(Math.min(PAPER + OVER, Math.max(-OVER, p.y)) * 10) / 10,
  s: Math.round(Math.min(S_MAX, Math.max(S_MIN, p.s)) * 10) / 10,
  r: Math.round((((p.r + 540) % 360) - 180) * 10) / 10,
});

// ---------------------------------------------------------------- shapes

const star = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 21 : 50;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(52 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points='${pts.join(' ')}'/>`;
})();
const flower = (() => {
  let s = `<circle cx='50' cy='50' r='30'/>`;
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    s += `<circle cx='${(50 + 31 * Math.cos(a)).toFixed(1)}' cy='${(50 + 31 * Math.sin(a)).toFixed(1)}' r='19'/>`;
  }
  return s;
})();
const SHAPE_SVG: Record<Exclude<PhotoShape, 'square'>, string> = {
  squircle: `<path d='M50,0 C90,0 100,10 100,50 C100,90 90,100 50,100 C10,100 0,90 0,50 C0,10 10,0 50,0Z'/>`,
  circle: `<circle cx='50' cy='50' r='50'/>`,
  star,
  heart: `<path d='M50,94 C50,94 3,63 3,32 C3,14 17,4 31,4 C40,4 47,9 50,17 C53,9 60,4 69,4 C83,4 97,14 97,32 C97,63 50,94 50,94Z'/>`,
  flower,
};
const maskOf = (shape: PhotoShape): CSSProperties =>
  shape === 'square'
    ? { borderRadius: 3 }
    : (() => {
        const url = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>${SHAPE_SVG[shape]}</svg>`)}")`;
        return { WebkitMaskImage: url, maskImage: url, WebkitMaskSize: '100% 100%', maskSize: '100% 100%', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat' };
      })();

export const SHAPES: Array<{ id: PhotoShape; label: string }> = [
  { id: 'square', label: 'Square' },
  { id: 'squircle', label: 'Squircle' },
  { id: 'circle', label: 'Circle' },
  { id: 'heart', label: 'Heart' },
  { id: 'star', label: 'Star' },
  { id: 'flower', label: 'Flower' },
];
export const BORDERS: Array<{ id: PhotoBorder; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'white', label: 'White' },
  { id: 'ink', label: 'Black' },
  { id: 'tape', label: 'Tape' },
];

/** The photo, cut to its shape, in its border, where it sits on the paper. */
function ShapedPhoto({ look, lifted, bind }: { look: NoteLook; lifted?: boolean; bind?: Record<string, unknown> }) {
  const { shape, border, pos } = look;
  const mask = maskOf(shape);
  const pad = border === 'none' || border === 'tape' ? 0 : 2.5;
  const h = shape === 'square' ? pos.s * 0.78 : pos.s;
  return (
    <span
      className={`nf__photo nf__photo--${shape} ${border === 'tape' ? 'has-tape' : ''} ${lifted ? 'is-lifted' : ''} ${bind ? 'is-editable' : ''}`}
      style={{ left: pos.x - pos.s / 2, top: pos.y - h / 2, width: pos.s, height: h, transform: `rotate(${pos.r}deg)` }}
      {...bind}
    >
      <span className="nf__frame" style={{ ...mask, padding: pad, background: border === 'white' ? '#fff' : border === 'ink' ? '#0a0a04' : 'transparent' }}>
        <img src={look.photo!} alt="" draggable={false} style={mask} />
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- the words, fitted

/** Make an element's text as big as fits (it's on a fixed paper, so scale doesn't change it). */
function useFit(ref: React.RefObject<HTMLElement | null>, deps: unknown[], max: number, min: number) {
  useLayoutEffect(() => {
    const n = ref.current;
    if (!n) return;
    const fit = () => {
      let size = max;
      n.style.fontSize = `${size}px`;
      while (size > min && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)) {
        size -= 0.5;
        n.style.fontSize = `${size}px`;
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, max, min]);
}

// ---------------------------------------------------------------- the note

export function NoteFace({
  look,
  scale = 1,
  tilt = 0,
  write,
  draw,
  photo,
  className,
}: {
  look: NoteLook;
  scale?: number;
  tilt?: number;
  /** Writing it: the words are a field, fitted the same way. */
  write?: { onText: (t: string) => void; onBlur?: () => void; placeholder: string; autoFocus?: boolean };
  /** Drawing on it: a pen in this colour; each finished stroke comes back. */
  draw?: { color: string; onStroke: (s: Stroke) => void };
  /** Its photo can be picked up (hold), moved, turned and sized; a tap opens its menu. */
  photo?: { onPos: (p: PhotoPos) => void; onTap: () => void; selected: boolean };
  className?: string;
}) {
  const text = (look.text === '📷' || look.text === '✏️') && (look.photo || look.ink.length) ? '' : look.text;
  const field = useRef<HTMLTextAreaElement>(null);
  const shown = useRef<HTMLSpanElement>(null);
  const paper = useRef<HTMLSpanElement>(null);
  useFit(write ? field : shown, [text], 21, 7);
  const [live, setLive] = useState<PhotoPos | null>(null);
  const shownLook = live ? { ...look, pos: live } : look;
  const gesture = usePhotoGesture({
    enabled: !!photo && !draw,
    paper,
    get: () => look.pos,
    show: setLive,
    commit: (p) => photo?.onPos(p),
    onTap: () => photo?.onTap(),
  });
  return (
    <span className={`nf-wrap ${className ?? ''}`} style={{ width: PAPER * scale, height: PAPER * scale, '--tilt': `${tilt}deg` } as CSSProperties}>
      <span ref={paper} className="sticky nf" style={{ ...lineVars(look.color), transform: `scale(${scale})` } as CSSProperties}>
        {write ? (
          <textarea
            ref={field}
            className="sticky__text nf__text nf__write"
            dir="auto"
            value={text}
            placeholder={write.placeholder}
            maxLength={240}
            aria-label="Your note"
            readOnly={!!draw}
            data-autofocus={write.autoFocus || undefined}
            onChange={(e) => write.onText(e.target.value)}
            onBlur={write.onBlur}
          />
        ) : (
          <span ref={shown} className="sticky__text nf__text" dir="auto">
            {text}
          </span>
        )}
        <span className="sticky__by">{look.by}</span>
        {look.photo ? <ShapedPhoto look={shownLook} lifted={gesture.lifted || photo?.selected} bind={photo && !draw ? gesture.bind : undefined} /> : null}
        {look.ink.length ? (
          <svg className="nf__ink" viewBox={`0 0 ${PAPER} ${PAPER}`} aria-hidden="true">
            {look.ink.map((s, i) => (
              <polyline key={i} points={s.p} fill="none" stroke={s.c} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </svg>
        ) : null}
        {draw ? <DrawLayer pen={draw.color} onStroke={draw.onStroke} /> : null}
      </span>
    </span>
  );
}

/**
 * The photo in hand, the way a note is on a screen: hold it to pick it up. With a finger it
 * follows that finger, and a second finger anywhere turns and sizes it; let go, it's down. With
 * a mouse: drag it; then press anywhere else and drag to turn and size it (the wheel sizes,
 * Shift+wheel turns); click elsewhere to put it down. A quick tap is a tap (its menu).
 */
function usePhotoGesture({
  enabled,
  paper,
  get,
  show,
  commit,
  onTap,
}: {
  enabled: boolean;
  paper: React.RefObject<HTMLSpanElement | null>;
  get: () => PhotoPos;
  show: (p: PhotoPos | null) => void;
  commit: (p: PhotoPos) => void;
  onTap: () => void;
}) {
  const [lifted, setLifted] = useState(false);
  const live = useRef<PhotoPos | null>(null);
  const g = useRef<{ mode: 'wait' | 'mouse' | 'finger'; sx: number; sy: number; start: PhotoPos; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const getRef = useRef(get);
  getRef.current = get;
  const set = (p: PhotoPos | null) => {
    live.current = p;
    show(p);
  };
  /** Screen pixels per point of paper (the note is scaled). */
  const unit = () => (paper.current?.getBoundingClientRect().width || PAPER) / PAPER;
  const put = () => {
    if (live.current) commit(live.current);
    set(null);
  };
  const release = useRef<(() => void) | null>(null);
  useEffect(() => () => release.current?.(), []);

  const followFingers = (start: PhotoPos, sx: number, sy: number) => {
    let anchor: number | null = null;
    let base = { pos: start, ax: sx, ay: sy, d0: 1, a0: 0, two: false };
    const find = (l: TouchList, id: number | null) => [...l].find((t) => t.identifier === id);
    const rebase = (a: Touch, b?: Touch) => {
      base = b
        ? { pos: live.current ?? start, ax: a.clientX, ay: a.clientY, d0: Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)), a0: Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX), two: true }
        : { pos: live.current ?? start, ax: a.clientX, ay: a.clientY, d0: 1, a0: 0, two: false };
    };
    const onStart = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      const a = find(e.touches, anchor);
      const b = [...e.touches].find((t) => t.identifier !== anchor);
      if (a && b) rebase(a, b);
    };
    const onMove = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      if (anchor === null) {
        const near = [...e.touches].sort((p, q) => Math.hypot(p.clientX - sx, p.clientY - sy) - Math.hypot(q.clientX - sx, q.clientY - sy))[0];
        if (!near) return;
        anchor = near.identifier;
        rebase(near);
      }
      const a = find(e.touches, anchor);
      if (!a) return;
      const b = [...e.touches].find((t) => t.identifier !== anchor);
      if (b && !base.two) rebase(a, b);
      if (!b && base.two) rebase(a);
      const u = unit();
      const moved = { ...base.pos, x: base.pos.x + (a.clientX - base.ax) / u, y: base.pos.y + (a.clientY - base.ay) / u };
      if (b) {
        const d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        const ang = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
        set(keepPos({ ...moved, r: base.pos.r + ((ang - base.a0) * 180) / Math.PI, s: base.pos.s * (d / base.d0) }));
      } else set(keepPos(moved));
    };
    const onEnd = (e: TouchEvent) => {
      const a = find(e.touches, anchor);
      if (a && anchor !== null) {
        if (base.two) rebase(a);
        return;
      }
      if (e.touches.length && anchor === null) return;
      done();
    };
    const block = (e: Event) => e.preventDefault();
    const opts: AddEventListenerOptions = { passive: false, capture: true };
    const done = () => {
      document.removeEventListener('touchstart', onStart, opts);
      document.removeEventListener('touchmove', onMove, opts);
      document.removeEventListener('touchend', onEnd, opts);
      document.removeEventListener('touchcancel', onEnd, opts);
      document.removeEventListener('gesturestart', block, opts);
      release.current = null;
      g.current = null;
      put();
      setLifted(false);
      haptic('drop');
    };
    document.addEventListener('touchstart', onStart, opts);
    document.addEventListener('touchmove', onMove, opts);
    document.addEventListener('touchend', onEnd, opts);
    document.addEventListener('touchcancel', onEnd, opts);
    document.addEventListener('gesturestart', block, opts);
    release.current = done;
  };

  // Lifted with the mouse: anywhere else turns and sizes it; a plain click there puts it down.
  const el = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!lifted || release.current) return;
    let tw: { cx: number; cy: number; a0: number; d0: number; sx: number; sy: number; start: PhotoPos; moved: boolean } | null = null;
    const opts: AddEventListenerOptions = { capture: true };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || el.current?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.current!.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      tw = { cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), d0: Math.max(10, Math.hypot(e.clientX - cx, e.clientY - cy)), sx: e.clientX, sy: e.clientY, start: live.current ?? getRef.current(), moved: false };
    };
    const move = (e: PointerEvent) => {
      if (!tw) return;
      if (!tw.moved && Math.hypot(e.clientX - tw.sx, e.clientY - tw.sy) < 5) return;
      tw.moved = true;
      const a = Math.atan2(e.clientY - tw.cy, e.clientX - tw.cx);
      const d = Math.hypot(e.clientX - tw.cx, e.clientY - tw.cy);
      document.documentElement.dataset.twist = Math.abs(d - tw.d0) > Math.abs(a - tw.a0) * tw.d0 ? 'scale' : 'rotate';
      set(keepPos({ ...tw.start, r: tw.start.r + ((a - tw.a0) * 180) / Math.PI, s: tw.start.s * (d / tw.d0) }));
    };
    const up = (e: PointerEvent) => {
      if (!tw) return;
      const t = tw;
      tw = null;
      delete document.documentElement.dataset.twist;
      e.stopPropagation();
      const eat = (c: Event) => {
        c.stopPropagation();
        c.preventDefault();
      };
      document.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', eat, { capture: true }), 0);
      if (t.moved) put();
      else setLifted(false);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = live.current ?? getRef.current();
      const next = keepPos(e.shiftKey ? { ...p, r: p.r + e.deltaY * 0.15 } : { ...p, s: p.s * Math.exp(-e.deltaY * 0.0015) });
      set(next);
      commit(next);
    };
    const root = document.documentElement;
    root.classList.add('note-lifted');
    document.addEventListener('pointerdown', down, opts);
    document.addEventListener('pointermove', move, opts);
    document.addEventListener('pointerup', up, opts);
    el.current?.addEventListener('wheel', wheel, { passive: false });
    const target = el.current;
    return () => {
      root.classList.remove('note-lifted');
      delete root.dataset.twist;
      document.removeEventListener('pointerdown', down, opts);
      document.removeEventListener('pointermove', move, opts);
      document.removeEventListener('pointerup', up, opts);
      target?.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifted]);

  const bind = enabled
    ? {
        ref: (n: HTMLElement | null) => {
          el.current = n;
        },
        onPointerDown: (e: React.PointerEvent) => {
          e.stopPropagation();
          if (g.current?.mode === 'finger') return;
          const start = live.current ?? getRef.current();
          if (lifted && e.pointerType === 'mouse') {
            g.current = { mode: 'mouse', sx: e.clientX, sy: e.clientY, start };
            try {
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
            } catch {
              /* untracked */
            }
            return;
          }
          const finger = e.pointerType !== 'mouse';
          g.current = { mode: 'wait', sx: e.clientX, sy: e.clientY, start };
          g.current.timer = setTimeout(
            () => {
              if (g.current?.mode !== 'wait') return;
              haptic('lift');
              setLifted(true);
              if (finger) {
                g.current.mode = 'finger';
                followFingers(start, g.current.sx, g.current.sy);
              } else g.current.mode = 'mouse';
            },
            finger ? 300 : 380,
          );
        },
        onPointerMove: (e: React.PointerEvent) => {
          const s = g.current;
          if (!s || s.mode === 'finger') return;
          if (s.mode === 'wait') {
            if (Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > 6) {
              clearTimeout(s.timer);
              g.current = null;
            }
            return;
          }
          const u = unit();
          set(keepPos({ ...s.start, x: s.start.x + (e.clientX - s.sx) / u, y: s.start.y + (e.clientY - s.sy) / u }));
        },
        onPointerUp: (e: React.PointerEvent) => {
          const s = g.current;
          if (!s || s.mode === 'finger') return;
          clearTimeout(s.timer);
          g.current = null;
          if (s.mode === 'mouse') put();
          else if (Math.hypot(e.clientX - s.sx, e.clientY - s.sy) <= 6) onTap();
        },
        onPointerCancel: () => {
          const s = g.current;
          if (!s || s.mode === 'finger') return;
          clearTimeout(s.timer);
          g.current = null;
          set(null);
        },
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      }
    : undefined;
  return { lifted, bind };
}

/** Drawing on the note: a finger (or the mouse) leaves a line; lifted, it's kept. */
function DrawLayer({ pen, onStroke }: { pen: string; onStroke: (s: Stroke) => void }) {
  const el = useRef<HTMLSpanElement>(null);
  const [pts, setPts] = useState<Array<[number, number]> | null>(null);
  const at = (e: React.PointerEvent): [number, number] => {
    const r = el.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * PAPER * 10) / 10, Math.round(((e.clientY - r.top) / r.height) * PAPER * 10) / 10];
  };
  return (
    <span
      ref={el}
      className="nf__draw"
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* untracked */
        }
        setPts([at(e)]);
      }}
      onPointerMove={(e) => {
        if (!pts) return;
        const p = at(e);
        const last = pts[pts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.8) setPts([...pts, p]);
      }}
      onPointerUp={() => {
        if (pts) onStroke({ c: pen, w: 2.2, p: (pts.length === 1 ? [pts[0], [pts[0][0] + 0.1, pts[0][1]]] : pts).map(([x, y]) => `${x},${y}`).join(' ') });
        setPts(null);
      }}
      onPointerCancel={() => setPts(null)}
    >
      {pts ? (
        <svg className="nf__ink" viewBox={`0 0 ${PAPER} ${PAPER}`}>
          <polyline points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={pen} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------- the editor

const PENS = [
  { c: '#0a0a04', label: 'Black' },
  { c: '#ff3b30', label: 'Red' },
  { c: '#2f6bff', label: 'Blue' },
  { c: '#ffffff', label: 'White' },
];

/** The most ink a note keeps (it syncs as one small field). */
export const INK_MAX = 24_000;

/**
 * Writing a note (a new one, or my own), right on it, big and exactly as it'll look. Under it,
 * one quiet row: the paper's colours, and two round buttons: a photo, and a pencil to draw on
 * the note. The photo is a sticker on the note: hold it to move it (a second finger, or the
 * mouse anywhere, turns and sizes it); a tap opens its few choices.
 */
export function NoteEditor({
  look,
  set,
  onText,
  onTextDone,
  autoFocus,
}: {
  look: NoteLook;
  set: (patch: Partial<NoteLook>) => void;
  onText: (t: string) => void;
  onTextDone?: () => void;
  autoFocus?: boolean;
}) {
  const { openSheet, toast } = useOverlays();
  const [drawing, setDrawing] = useState(false);
  const [photoMenu, setPhotoMenu] = useState(false);
  const [pen, setPen] = useState(PENS[0].c);
  const picker = useShotPicker((photo) => {
    set(look.photo ? { photo } : { photo, pos: PHOTO_HOME });
    setDrawing(false);
  });
  const addStroke = (s: Stroke) => {
    const next = [...look.ink, s];
    if (JSON.stringify(next).length > INK_MAX) {
      toast('That’s all the ink a note holds');
      return;
    }
    set({ ink: next });
  };
  return (
    <div className="noteedit">
      <div className="noteedit__stage">
        <NoteFace
          look={look}
          scale={2.3}
          write={{ onText, onBlur: onTextDone, placeholder: 'Don’t forget the milk 💛', autoFocus }}
          draw={drawing ? { color: pen, onStroke: addStroke } : undefined}
          photo={{
            onPos: (pos) => set({ pos }),
            onTap: () => {
              haptic('select');
              setPhotoMenu(!photoMenu);
            },
            selected: photoMenu,
          }}
        />
      </div>

      {photoMenu && look.photo ? (
        <div className="noteedit__photo" role="group" aria-label="Photo">
          <div className="noteedit__choices" role="radiogroup" aria-label="Shape">
            {SHAPES.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={look.shape === s.id} aria-label={s.label} title={s.label} className={`noteedit__shape ${look.shape === s.id ? 'is-on' : ''}`} onClick={() => set({ shape: s.id })}>
                <span className="noteedit__shapeswatch" style={maskOf(s.id)} />
              </button>
            ))}
          </div>
          <div className="noteedit__choices" role="radiogroup" aria-label="Border">
            {BORDERS.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={look.border === b.id} className={`option option--sm ${look.border === b.id ? 'is-on' : ''}`} onClick={() => set({ border: b.id })}>
                {b.label}
              </button>
            ))}
          </div>
          <div className="noteedit__actions">
            <button type="button" className="textbtn" onClick={() => openSheet((close) => <SketchSheet src={look.photo!} onDone={(photo) => set({ photo })} onClose={close} />)}>
              <Icon name="scribble" className="icon--xs" /> Draw on it
            </button>
            <button type="button" className="textbtn" onClick={picker.pick}>
              Another photo
            </button>
            <button
              type="button"
              className="textbtn"
              onClick={() => {
                set({ photo: null });
                setPhotoMenu(false);
              }}
            >
              Take it off
            </button>
            <span className="noteedit__grow" />
            <button type="button" className="btn btn--sm" onClick={() => setPhotoMenu(false)}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      <div className="noteedit__bar">
        {drawing ? (
          <>
            {PENS.map((p) => (
              <button
                key={p.c}
                type="button"
                role="radio"
                aria-checked={pen === p.c}
                aria-label={p.label}
                className={`sketch__pen ${pen === p.c ? 'is-on' : ''}`}
                style={{ background: p.c }}
                onClick={() => {
                  haptic('select');
                  setPen(p.c);
                }}
              />
            ))}
            <button type="button" className="iconbtn" aria-label="Undo the last line" disabled={!look.ink.length} onClick={() => set({ ink: look.ink.slice(0, -1) })}>
              <Icon name="undo" />
            </button>
          </>
        ) : (
          NOTE_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={c === look.color} aria-label={c} className={`note__swatch ${c === look.color ? 'is-on' : ''}`} style={lineVars(c)} onClick={() => set({ color: c })} />
          ))
        )}
        <span className="noteedit__grow" />
        {look.photo || drawing ? null : (
          <button type="button" className="noteedit__round" aria-label="Add a photo" title="Add a photo" onClick={picker.pick}>
            <Icon name="image" className="icon--sm" />
          </button>
        )}
        <button
          type="button"
          className={`noteedit__round ${drawing ? 'is-on' : ''}`}
          aria-label={drawing ? 'Done drawing' : 'Draw on the note'}
          aria-pressed={drawing}
          title={drawing ? 'Done drawing' : 'Draw on the note'}
          onClick={() => {
            haptic('select');
            setDrawing(!drawing);
            setPhotoMenu(false);
          }}
        >
          <Icon name={drawing ? 'check' : 'edit'} className="icon--sm" />
        </button>
      </div>
      {picker.input}
    </div>
  );
}

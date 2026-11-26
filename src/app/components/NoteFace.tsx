import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LineColor } from '../../core/model';
import { haptic } from '../ui/haptics';
import { Icon, type IconName } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { lineVars } from '../ui/primitives';
import { SketchSheet, useShotPicker } from './Sketch';

/**
 * One note, drawn the same everywhere: stuck on a screen, big in its sheet while you write it,
 * small on Our notes. It's laid out on a 124-point square of paper and scaled, so what you see
 * while writing is exactly what lands on the screen. A photo on it has a shape (square to star),
 * a border, and a place (top, bottom, behind the words, or stuck on the corner); and you can
 * draw on the note itself (strokes kept as tiny vector lines: sharp at any size).
 */

export const PAPER = 124;

export type PhotoShape = 'square' | 'squircle' | 'circle' | 'star' | 'heart' | 'flower';
export type PhotoBorder = 'none' | 'white' | 'ink' | 'tape';
export type PhotoAt = 'top' | 'bottom' | 'behind' | 'corner';
export type Stroke = { c: string; w: number; p: string };

export interface NoteLook {
  text: string;
  color: LineColor;
  by: string;
  photo: string | null;
  shape: PhotoShape;
  border: PhotoBorder;
  at: PhotoAt;
  ink: Stroke[];
}

export const NOTE_COLORS: LineColor[] = ['lemon', 'pink', 'sky', 'mint', 'lilac'];

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
    ? { borderRadius: 4 }
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
export const PLACES: Array<{ id: PhotoAt; label: string; icon: IconName }> = [
  { id: 'top', label: 'Top', icon: 'chevron-up' },
  { id: 'bottom', label: 'Bottom', icon: 'chevron-down' },
  { id: 'behind', label: 'Behind', icon: 'layout' },
  { id: 'corner', label: 'Corner', icon: 'pin' },
];

/** The photo, cut to its shape, in its border. */
function ShapedPhoto({ src, shape, border, className }: { src: string; shape: PhotoShape; border: PhotoBorder; className?: string }) {
  const mask = maskOf(shape);
  const pad = border === 'none' || border === 'tape' ? 0 : 2.5;
  return (
    <span className={`nf__photo nf__photo--${shape} ${border === 'tape' ? 'has-tape' : ''} ${className ?? ''}`}>
      <span className="nf__frame" style={{ ...mask, padding: pad, background: border === 'white' ? '#fff' : border === 'ink' ? '#0a0a04' : 'transparent' }}>
        <img src={src} alt="" draggable={false} style={mask} />
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

const sizes = (look: NoteLook) => {
  if (!look.photo || look.at === 'corner') return { max: 21, min: 7 };
  if (look.at === 'behind') return { max: 19, min: 7 };
  return { max: 14, min: 6 };
};

// ---------------------------------------------------------------- the note

export function NoteFace({
  look,
  scale = 1,
  tilt = 0,
  write,
  draw,
  className,
  extra,
}: {
  look: NoteLook;
  scale?: number;
  tilt?: number;
  /** Writing it: the words are a field, fitted the same way. */
  write?: { onText: (t: string) => void; onBlur?: () => void; placeholder: string; autoFocus?: boolean };
  /** Drawing on it: a pen in this colour; each finished stroke comes back. */
  draw?: { color: string; onStroke: (s: Stroke) => void };
  className?: string;
  extra?: ReactNode;
}) {
  const text = look.text === '📷' && look.photo ? '' : look.text;
  const field = useRef<HTMLTextAreaElement>(null);
  const shown = useRef<HTMLSpanElement>(null);
  const { max, min } = sizes(look);
  useFit(write ? field : shown, [text, look.photo, look.at], max, min);
  const photo = look.photo ? <ShapedPhoto src={look.photo} shape={look.shape} border={look.border} className={`nf__photo--${look.at}`} /> : null;
  return (
    <span className={`nf-wrap ${className ?? ''}`} style={{ width: PAPER * scale, height: PAPER * scale, '--tilt': `${tilt}deg` } as CSSProperties}>
      <span
        className={`sticky nf nf--at-${look.photo ? look.at : 'none'}`}
        style={{ ...lineVars(look.color), transform: `scale(${scale})` } as CSSProperties}
      >
        {look.at === 'behind' || look.at === 'corner' ? photo : null}
        {look.at === 'top' ? photo : null}
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
        {look.at === 'bottom' ? photo : null}
        <span className="sticky__by">{look.by}</span>
        {look.ink.length ? (
          <svg className="nf__ink" viewBox={`0 0 ${PAPER} ${PAPER}`} aria-hidden="true">
            {look.ink.map((s, i) => (
              <polyline key={i} points={s.p} fill="none" stroke={s.c} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </svg>
        ) : null}
        {draw ? <DrawLayer pen={draw.color} onStroke={draw.onStroke} /> : null}
        {extra}
      </span>
    </span>
  );
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
 * Writing a note (a new one, or my own): the note itself, big and exactly as it'll look, and
 * under it three tabs: Write (the words, and the paper's colour), Photo (add one; its shape,
 * border and place; draw on it), Draw (pens, on the note itself; Undo).
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
  const [tab, setTab] = useState<'write' | 'photo' | 'draw'>('write');
  const [pen, setPen] = useState(PENS[0].c);
  const picker = useShotPicker((photo) => {
    set({ photo });
    setTab('photo');
  });
  const addStroke = (s: Stroke) => {
    const next = [...look.ink, s];
    if (JSON.stringify(next).length > INK_MAX) {
      toast('That’s all the ink a note holds');
      return;
    }
    set({ ink: next });
  };
  const scale = 2.3;
  return (
    <div className="noteedit">
      <div className="noteedit__stage">
        <NoteFace
          look={look}
          scale={scale}
          write={{ onText, onBlur: onTextDone, placeholder: 'Don’t forget the milk 💛', autoFocus }}
          draw={tab === 'draw' ? { color: pen, onStroke: addStroke } : undefined}
        />
      </div>

      <div className="noteedit__tabs" role="tablist" aria-label="Note">
        {(
          [
            ['write', 'Write', 'edit'],
            ['photo', 'Photo', 'image'],
            ['draw', 'Draw', 'scribble'],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`noteedit__tab ${tab === id ? 'is-on' : ''}`} onClick={() => setTab(id)}>
            <Icon name={icon} className="icon--sm" />
            {label}
          </button>
        ))}
      </div>

      <div className="noteedit__panel">
        {tab === 'write' ? (
          <Row label="Paper">
            {NOTE_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === look.color} aria-label={c} className={`note__swatch ${c === look.color ? 'is-on' : ''}`} style={lineVars(c)} onClick={() => set({ color: c })} />
            ))}
          </Row>
        ) : null}

        {tab === 'photo' ? (
          look.photo ? (
            <>
              <Row label="Shape">
                {SHAPES.map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={look.shape === s.id} aria-label={s.label} title={s.label} className={`noteedit__shape ${look.shape === s.id ? 'is-on' : ''}`} onClick={() => set({ shape: s.id })}>
                    <span className="noteedit__shapeswatch" style={maskOf(s.id)} />
                  </button>
                ))}
              </Row>
              <Row label="Border">
                {BORDERS.map((b) => (
                  <button key={b.id} type="button" role="radio" aria-checked={look.border === b.id} className={`option option--sm ${look.border === b.id ? 'is-on' : ''}`} onClick={() => set({ border: b.id })}>
                    {b.label}
                  </button>
                ))}
              </Row>
              <Row label="Place">
                {PLACES.map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={look.at === p.id} className={`option option--sm ${look.at === p.id ? 'is-on' : ''}`} onClick={() => set({ at: p.id })}>
                    {p.label}
                  </button>
                ))}
              </Row>
              <div className="noteedit__actions">
                <button type="button" className="textbtn" onClick={() => openSheet((close) => <SketchSheet src={look.photo!} onDone={(photo) => set({ photo })} onClose={close} />)}>
                  <Icon name="scribble" className="icon--xs" /> Draw on the photo
                </button>
                <button type="button" className="textbtn" onClick={picker.pick}>
                  Another photo
                </button>
                <button type="button" className="textbtn" onClick={() => set({ photo: null })}>
                  Take it off
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="noteedit__addphoto" onClick={picker.pick}>
              <Icon name="image" />
              Add a photo
            </button>
          )
        ) : null}

        {tab === 'draw' ? (
          <Row label="Pen">
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
            <span className="noteedit__grow" />
            <button type="button" className="iconbtn" aria-label="Undo the last line" disabled={!look.ink.length} onClick={() => set({ ink: look.ink.slice(0, -1) })}>
              <Icon name="undo" />
            </button>
            <button type="button" className="textbtn" disabled={!look.ink.length} onClick={() => set({ ink: [] })}>
              Clear
            </button>
          </Row>
        ) : null}
        {tab === 'draw' ? <p className="noteedit__hint">Draw right on the note</p> : null}
      </div>
      {picker.input}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="noteedit__row" role="radiogroup" aria-label={label}>
      <span className="noteedit__label">{label}</span>
      <div className="noteedit__choices">{children}</div>
    </div>
  );
}

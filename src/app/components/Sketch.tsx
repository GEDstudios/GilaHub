import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { haptic } from '../ui/haptics';
import { Sheet, useOverlays } from '../ui/overlays';
import { G } from '../ui/glyphs';
import { IconButton } from '../ui/primitives';

/**
 * Draw on a screenshot: circle the thing, scribble an arrow, write "this!". The picture fills
 * the sheet; a finger (or the mouse) draws in the chosen pen. Undo takes back the last line.
 * "Attach" hands back a JPEG small enough to sync (an idea's picture, Hub.setIdeaShot).
 */

const PENS = [
  { id: 'red', color: '#ff3b30', label: 'Red' },
  { id: 'lemon', color: '#e8ff1f', label: 'Yellow' },
  { id: 'ink', color: '#111111', label: 'Black' },
  { id: 'white', color: '#ffffff', label: 'White' },
] as const;

/** The longest side kept, in pixels: sharp enough to read a phone screen, small enough to sync. */
const MAX_SIDE = 1100;

type Stroke = { color: string; w: number; pts: Array<[number, number]> };

/** Read a picked file as a data URL. */
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function SketchSheet({ src, onDone, onClose, title = 'Draw on it' }: { src: string; onDone: (jpeg: string) => void; onClose: () => void; title?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const [pen, setPen] = useState<string>(PENS[0].color);
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);

  const paint = () => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !img.current) return;
    ctx.drawImage(img.current, 0, 0, c.width, c.height);
    for (const s of strokes.current) line(ctx, s);
  };

  useEffect(() => {
    const i = new Image();
    i.onload = () => {
      const c = canvas.current;
      if (!c) return;
      const k = Math.min(1, MAX_SIDE / Math.max(i.naturalWidth, i.naturalHeight));
      c.width = Math.round(i.naturalWidth * k);
      c.height = Math.round(i.naturalHeight * k);
      img.current = i;
      paint();
      setReady(true);
    };
    i.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const at = (e: RPointerEvent<HTMLCanvasElement>): [number, number] => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };
  /** A pen that looks the same on screen whatever the picture's size. */
  const width = () => {
    const c = canvas.current!;
    return Math.max(3, (c.width / c.getBoundingClientRect().width) * 4.5);
  };

  const down = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { color: pen, w: width(), pts: [at(e)] };
    const ctx = canvas.current!.getContext('2d')!;
    line(ctx, drawing.current);
  };
  const move = (e: RPointerEvent<HTMLCanvasElement>) => {
    const s = drawing.current;
    if (!s) return;
    const p = at(e);
    s.pts.push(p);
    const ctx = canvas.current!.getContext('2d')!;
    line(ctx, { ...s, pts: s.pts.slice(-2) });
  };
  const up = () => {
    if (!drawing.current) return;
    strokes.current.push(drawing.current);
    drawing.current = null;
    setCount(strokes.current.length);
  };

  const undo = () => {
    strokes.current.pop();
    setCount(strokes.current.length);
    haptic('select');
    paint();
  };
  const clear = () => {
    strokes.current = [];
    setCount(0);
    haptic('select');
    paint();
  };
  const done = () => {
    const c = canvas.current;
    if (!c || !ready) return;
    // Keep it light: lower the quality for a big, busy picture.
    let out = c.toDataURL('image/jpeg', 0.74);
    if (out.length > 220_000) out = c.toDataURL('image/jpeg', 0.55);
    haptic('tick');
    onDone(out);
    onClose();
  };

  return (
    <Sheet onClose={onClose} title={title}>
      <div className="sketch" data-no-pull>
        <canvas
          ref={canvas}
          className={`sketch__canvas ${ready ? '' : 'is-loading'}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          aria-label="Your picture. Draw on it with a finger."
        />
        <div className="sketch__tools">
          <div className="sketch__pens" role="radiogroup" aria-label="Pen">
            {PENS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={pen === p.color}
                aria-label={p.label}
                className={`sketch__pen ${pen === p.color ? 'is-on' : ''}`}
                style={{ background: p.color }}
                onClick={() => {
                  haptic('select');
                  setPen(p.color);
                }}
              />
            ))}
          </div>
          <IconButton icon={G.undo} label="Undo the last line" disabled={!count} onClick={undo} />
          <button type="button" className="textbtn" disabled={!count} onClick={clear}>
            Clear
          </button>
        </div>
        <button type="button" className="btn btn--block" disabled={!ready} onClick={done}>
          Attach
        </button>
      </div>
    </Sheet>
  );
}

function line(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.pts.length === 1) {
    ctx.beginPath();
    ctx.arc(s.pts[0][0], s.pts[0][1], s.w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(s.pts[0][0], s.pts[0][1]);
  for (const [x, y] of s.pts.slice(1)) ctx.lineTo(x, y);
  ctx.stroke();
}

/** A picture made small enough to sync: its longest side at most `max`, as a JPEG. */
export function shrinkImage(src: string, max = 720): Promise<string> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => {
      const k = Math.min(1, max / Math.max(i.naturalWidth, i.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(i.naturalWidth * k);
      c.height = Math.round(i.naturalHeight * k);
      c.getContext('2d')!.drawImage(i, 0, 0, c.width, c.height);
      let out = c.toDataURL('image/jpeg', 0.8);
      if (out.length > 160_000) out = c.toDataURL('image/jpeg', 0.6);
      resolve(out);
    };
    i.onerror = () => reject(new Error('unreadable'));
    i.src = src;
  });
}

/** Pick a picture (a screenshot from the phone's photos), then draw on it (or, `sketch: false`, take it as it is). */
export function useShotPicker(onPicked: (jpeg: string) => void, { sketch = true }: { sketch?: boolean } = {}): { pick: () => void; input: ReactNode } {
  const { openSheet, toast } = useOverlays();
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      hidden
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
          const src = await readImage(file);
          if (sketch) openSheet((close) => <SketchSheet src={src} onDone={onPicked} onClose={close} />);
          else onPicked(await shrinkImage(src));
        } catch {
          toast('Couldn’t open that picture');
        }
      }}
    />
  );
  return { pick: () => ref.current?.click(), input };
}


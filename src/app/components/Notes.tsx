import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { shortAgo } from '../../core/dates';
import type { LineColor, Note } from '../../core/model';
import { NOTE_MAX, NOTE_MIN } from '../../core/actions';
import { useHub, useRt } from '../context';
import { href, navigate, useRoute, type Route } from '../router';
import { notifyMembers } from '../runtime';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { SketchSheet, useShotPicker } from './Sketch';
import { lineVars } from '../ui/primitives';

/**
 * Sticky notes: one of us leaves a note on a screen for the other ("Don't forget the milk 💛"
 * on Shopping). It sits stuck to that screen, taped on and a little crooked, until the one it's
 * for reads it and peels it off. The little paper by the Ideas tag leaves a new one here.
 */

const COLORS: LineColor[] = ['lemon', 'pink', 'sky', 'mint', 'lilac'];

/** Where a note can be stuck: every screen but Settings. */
export function placeOf(route: Route): string | null {
  if (route.name === 'list') return `list:${route.id}`;
  if (route.name === 'item') return `item:${route.id}`;
  return route.name === 'settings' ? null : route.name;
}

function routeOf(place: string): Route {
  const [kind, id] = place.split(':');
  if (kind === 'list' && id) return { name: 'list', id };
  if (kind === 'item' && id) return { name: 'item', id };
  if (kind === 'shop' || kind === 'chores' || kind === 'lists') return { name: kind };
  return { name: 'today' };
}

/** Where a note's screen is, as a link. */
export const placeUrl = (place: string): string => href(routeOf(place));

/** "Shopping", "Projects", a project's name, a task's title. */
export function placeName(hub: ReturnType<typeof useHub>, place: string): string {
  const [kind, id] = place.split(':');
  if (kind === 'list') return hub.list(id)?.name ?? 'a project';
  if (kind === 'item') return hub.item(id)?.title ?? 'a task';
  return { today: 'Today', shop: 'Shopping', chores: 'Chores', lists: 'Projects' }[kind] ?? 'Today';
}

/** A small, stable tilt per note. */
const tiltOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return [-5, -3, 3, 5, -4, 4][Math.abs(h) % 6];
};

/** Words that fill the paper: as big as they fit, smaller when there are more of them. */
function FitText({ text, max, min = 11, className = 'sticky__text' }: { text: string; max: number; min?: number; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const n = el.current;
    if (!n) return;
    const fit = () => {
      let size = max;
      n.style.fontSize = `${size}px`;
      while (size > min && (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)) {
        size -= 1;
        n.style.fontSize = `${size}px`;
      }
    };
    fit();
    // Again once the handwriting font is in, and whenever the paper changes size.
    void document.fonts?.ready.then(fit);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(n.parentElement ?? n);
    return () => ro?.disconnect();
  }, [text, max, min]);
  return (
    <span ref={el} className={`${className} is-fit`} dir="auto">
      {text}
    </span>
  );
}

/** A note's photo (drawn on, maybe): a tap draws on it again; × takes it off. */
function NotePhoto({ src, onChange }: { src: string; onChange?: (jpeg: string | null) => void }) {
  const { openSheet } = useOverlays();
  return (
    <span className="sticky__photo">
      {onChange ? (
        <>
          <button type="button" className="sticky__photobtn" aria-label="Draw on the photo" onClick={() => openSheet((close) => <SketchSheet src={src} onDone={onChange} onClose={close} />)}>
            <img src={src} alt="" />
          </button>
          <button type="button" className="sticky__unphoto" aria-label="Take the photo off" onClick={() => onChange(null)}>
            <Icon name="x" className="icon--xs" />
          </button>
        </>
      ) : (
        <img src={src} alt="" draggable={false} />
      )}
    </span>
  );
}

/** On a note being written: a photo to add (then draw on). */
function PhotoAdd({ onPick }: { onPick: (jpeg: string) => void }): ReactNode {
  const picker = useShotPicker(onPick);
  return (
    <>
      <button type="button" className="sticky__addphoto" aria-label="Add a photo to draw on" title="Add a photo" onClick={picker.pick}>
        <Icon name="image" className="icon--sm" />
      </button>
      {picker.input}
    </>
  );
}

// ---------------------------------------------------------------- leaving one

/** The little paper by the Ideas tag: leave a note on this screen for my person. */
export function NoteButton() {
  const hub = useHub();
  const route = useRoute();
  const { openSheet } = useOverlays();
  const partner = hub.partner();
  const place = placeOf(route);
  if (!partner || !place) return null;
  return (
    <button
      type="button"
      className="notebtn"
      aria-label={`Leave a note for ${partner.name} here`}
      title={`Leave a note for ${partner.name}`}
      onClick={() => {
        haptic('select');
        openSheet((close) => <NewNoteSheet place={place} onClose={close} />);
      }}
    >
      <span className="notebtn__paper">
        <Icon name="plus" className="icon--xs" />
      </span>
    </button>
  );
}

function NewNoteSheet({ place, onClose }: { place: string; onClose: () => void }) {
  const hub = useHub();
  const rt = useRt();
  const { toast } = useOverlays();
  const partner = hub.partner();
  const [text, setText] = useState('');
  const [color, setColor] = useState<LineColor>('lemon');
  const [shot, setShot] = useState<string | null>(null);
  const where = placeName(hub, place);
  const stick = () => {
    const id = hub.addNote(place, text.trim() || (shot ? '📷' : ''), color);
    if (!id) return;
    if (shot) hub.setShot('note', id, shot);
    haptic('tick');
    onClose();
    toast(`Stuck on ${where} for ${partner?.name ?? 'them'}`, { action: { label: 'Undo', run: () => hub.peelNote(id) } });
    if (partner) void notifyMembers(rt, [partner.id], { title: `📝 ${hub.me()?.name ?? 'Your person'} left you a note`, body: text.trim(), url: href(routeOf(place)), tag: `note-${id}` });
  };
  return (
    <Sheet onClose={onClose} title={`A note for ${partner?.name ?? 'your person'}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          stick();
        }}
      >
        <p className="note__where">
          It stays on <strong dir="auto">{where}</strong> till {partner?.name ?? 'they'} peels it off
        </p>
        <div className="sticky sticky--big" style={{ ...lineVars(color), '--tilt': '-2deg' } as CSSProperties}>
          {shot ? <NotePhoto src={shot} onChange={setShot} /> : <PhotoAdd onPick={setShot} />}
          <textarea
            className="sticky__write"
            dir="auto"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Don’t forget the milk 💛"
            aria-label="Your note"
            rows={4}
            maxLength={240}
            data-autofocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) stick();
            }}
          />
          <span className="sticky__by">— {hub.me()?.name}</span>
        </div>
        <div className="note__colors" role="radiogroup" aria-label="Paper">
          {COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} className={`note__swatch ${c === color ? 'is-on' : ''}`} style={lineVars(c)} onClick={() => setColor(c)} />
          ))}
        </div>
        <button type="submit" className="btn btn--block" disabled={!text.trim() && !shot}>
          Stick it
        </button>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------- finding one

/** How wide a note is on the page (px); the layer works out where that leaves it. */
const NOTE_W = 124;

/**
 * The notes stuck on this screen. Each sits where it was left (both of us see the same spot),
 * new ones up by the top corner, a little fanned. A tap reads it; either of us ticks it off (it
 * goes to the collected notes, on Projects). Hold one to pick it up (see StuckNote).
 */
export function NotesLayer() {
  const hub = useHub();
  const route = useRoute();
  const place = placeOf(route);
  const [lifted, setLifted] = useState<string | null>(null);
  const board = useRef<HTMLDivElement>(null);
  if (!place) return null;
  const notes = hub.notesOn(place).slice(0, 8).reverse();
  if (!notes.length) return null;
  return (
    <div className={`stickyboard ${lifted ? 'is-arranging' : ''}`} ref={board}>
      {notes.map((n, i) => (
        <StuckNote key={n.id} note={n} index={notes.length - 1 - i} board={board} lifted={lifted === n.id} onLift={(on) => setLifted(on ? n.id : null)} />
      ))}
    </div>
  );
}

type Place = { x: number; y: number; rot: number; scale: number };
const clampScale = (s: number) => Math.min(NOTE_MAX, Math.max(NOTE_MIN, s));
const turned = (rot: number) => {
  let r = ((rot + 540) % 360) - 180;
  if (Math.abs(r) < 2.5) r = 0; // a little snap to straight
  return r;
};

function StuckNote({
  note,
  index,
  board,
  lifted,
  onLift,
}: {
  note: Note;
  index: number;
  board: React.RefObject<HTMLDivElement | null>;
  lifted: boolean;
  onLift: (on: boolean) => void;
}) {
  const hub = useHub();
  const { openSheet, toast } = useOverlays();
  const el = useRef<HTMLDivElement>(null);
  const mine = note.by === hub.meId;
  const photo = hub.shotOf('note', note.id);
  const width = () => board.current?.getBoundingClientRect().width || 360;
  // Where it is: where it was left, else up by the top corner, fanned by age.
  const home = (): Place => ({
    x: note.x ?? Math.max(0, (width() - NOTE_W - 16 - index * 14) / width()),
    y: note.y ?? 62 + index * 22,
    rot: note.rot ?? tiltOf(note.id),
    scale: note.scale ?? 1,
  });
  // The latest "where it is", for handlers set up earlier (the twist and the wheel).
  const homeRef = useRef(home);
  homeRef.current = home;
  const [live, setLive] = useState<Place | null>(null);
  const liveRef = useRef<Place | null>(null);
  const show = (p: Place | null) => {
    liveRef.current = p;
    setLive(p);
  };
  const at = live ?? home();
  const [peeling, setPeeling] = useState(false);
  const keep = (p: Place): Place => {
    const w = width();
    return { ...p, x: Math.min(1 - 40 / w, Math.max(-60 / w, p.x)), y: Math.max(8, p.y), scale: clampScale(p.scale), rot: turned(p.rot) };
  };
  const put = () => {
    if (liveRef.current) {
      hub.placeNote(note.id, liveRef.current);
      haptic('drop');
    }
    show(null);
  };

  /**
   * Hold it (a moment) and it comes off the page. With a finger: it follows that finger, and a
   * second finger anywhere turns and sizes it around the first; let go and it's put down. With
   * a mouse: drag it; the wheel sizes it, Shift+wheel turns it; click elsewhere to put it down.
   * A quick tap reads it.
   */
  const g = useRef<{ mode: 'wait' | 'mouse' | 'finger'; sx: number; sy: number; start: Place; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const tap = useRef(false);
  const release = useRef<(() => void) | null>(null);
  useEffect(() => () => release.current?.(), []);

  // Before the hold lands, the page scrolls as usual; once it's in hand, nothing under it moves.
  useEffect(() => {
    const n = el.current;
    if (!n) return;
    const stop = (e: TouchEvent) => {
      if (g.current && g.current.mode !== 'wait') e.preventDefault();
    };
    n.addEventListener('touchmove', stop, { passive: false });
    return () => n.removeEventListener('touchmove', stop);
  }, []);

  // Lifted with the mouse: press anywhere else and drag to turn it (round its middle) and size it
  // (nearer, smaller; further, bigger). A plain click elsewhere puts it down.
  useEffect(() => {
    const n = el.current;
    if (!n || !lifted || release.current) return;
    let twist: { cx: number; cy: number; a0: number; d0: number; sx: number; sy: number; start: Place; moved: boolean } | null = null;
    const opts: AddEventListenerOptions = { capture: true };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || n.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      const r = n.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      twist = { cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), d0: Math.max(12, Math.hypot(e.clientX - cx, e.clientY - cy)), sx: e.clientX, sy: e.clientY, start: liveRef.current ?? homeRef.current(), moved: false };
    };
    const move = (e: PointerEvent) => {
      const t = twist;
      if (!t) return;
      if (!t.moved && Math.hypot(e.clientX - t.sx, e.clientY - t.sy) < 5) return;
      t.moved = true;
      const a = Math.atan2(e.clientY - t.cy, e.clientX - t.cx);
      const d = Math.hypot(e.clientX - t.cx, e.clientY - t.cy);
      show(keep({ ...t.start, rot: t.start.rot + ((a - t.a0) * 180) / Math.PI, scale: t.start.scale * (d / t.d0) }));
    };
    const up = (e: PointerEvent) => {
      const t = twist;
      if (!t) return;
      twist = null;
      e.stopPropagation();
      // Nothing under it gets this click.
      const eat = (c: Event) => {
        c.stopPropagation();
        c.preventDefault();
      };
      document.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', eat, { capture: true }), 0);
      if (t.moved) put();
      else onLift(false);
    };
    document.addEventListener('pointerdown', down, opts);
    document.addEventListener('pointermove', move, opts);
    document.addEventListener('pointerup', up, opts);
    return () => {
      document.removeEventListener('pointerdown', down, opts);
      document.removeEventListener('pointermove', move, opts);
      document.removeEventListener('pointerup', up, opts);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifted]);

  // The wheel, while it's lifted (mouse): size, or with Shift, turn.
  useEffect(() => {
    const n = el.current;
    if (!n || !lifted) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = liveRef.current ?? homeRef.current();
      const next = e.shiftKey ? { ...p, rot: p.rot + e.deltaY * 0.15 } : { ...p, scale: p.scale * Math.exp(-e.deltaY * 0.0015) };
      show(keep(next));
      hub.placeNote(note.id, keep(next));
    };
    n.addEventListener('wheel', wheel, { passive: false });
    return () => n.removeEventListener('wheel', wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifted]);

  /** In hand with a finger: follow the touches on the whole screen until that finger lifts. */
  const followFingers = (start: Place, sx: number, sy: number) => {
    let anchor: number | null = null;
    let base = { place: start, ax: sx, ay: sy, d0: 1, a0: 0, two: false };
    const find = (list: TouchList, id: number | null) => [...list].find((t) => t.identifier === id);
    const rebase = (a: Touch, b?: Touch) => {
      base = b
        ? { place: liveRef.current ?? start, ax: a.clientX, ay: a.clientY, d0: Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)), a0: Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX), two: true }
        : { place: liveRef.current ?? start, ax: a.clientX, ay: a.clientY, d0: 1, a0: 0, two: false };
    };
    const onStart = (e: TouchEvent) => {
      // A second finger is for the note: nothing under it gets the touch.
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      const a = find(e.touches, anchor);
      const b = [...e.touches].find((t) => t.identifier !== anchor);
      if (a && b) {
        rebase(a, b);
        haptic('select');
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      if (anchor === null) {
        // The holding finger: the touch nearest where the hold began.
        const near = [...e.touches].sort((p, q) => Math.hypot(p.clientX - sx, p.clientY - sy) - Math.hypot(q.clientX - sx, q.clientY - sy))[0];
        if (!near) return;
        anchor = near.identifier;
        rebase(near);
      }
      const a = find(e.touches, anchor);
      if (!a) return;
      const b = [...e.touches].find((t) => t.identifier !== anchor);
      const w = width();
      if (b && !base.two) rebase(a, b);
      if (!b && base.two) rebase(a);
      const moved = { ...base.place, x: base.place.x + (a.clientX - base.ax) / w, y: base.place.y + (a.clientY - base.ay) };
      if (b) {
        const d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        const ang = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
        show(keep({ ...moved, rot: base.place.rot + ((ang - base.a0) * 180) / Math.PI, scale: base.place.scale * (d / base.d0) }));
      } else show(keep(moved));
    };
    const onEnd = (e: TouchEvent) => {
      const a = find(e.touches, anchor);
      if (a && anchor !== null) {
        // The second finger lifted: keep moving with the first.
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
      onLift(false);
    };
    document.addEventListener('touchstart', onStart, opts);
    document.addEventListener('touchmove', onMove, opts);
    document.addEventListener('touchend', onEnd, opts);
    document.addEventListener('touchcancel', onEnd, opts);
    // iPhone's own pinch-zoom stays out of it.
    document.addEventListener('gesturestart', block, opts);
    release.current = done;
  };

  const down = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('.sticky__check')) return;
    if (g.current?.mode === 'finger') return;
    e.stopPropagation();
    tap.current = false;
    const start = liveRef.current ?? home();
    // Already in hand (mouse): drag straight away.
    if (lifted && e.pointerType === 'mouse') {
      g.current = { mode: 'mouse', sx: e.clientX, sy: e.clientY, start };
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        /* untracked pointer */
      }
      return;
    }
    const finger = e.pointerType !== 'mouse';
    g.current = { mode: 'wait', sx: e.clientX, sy: e.clientY, start };
    g.current.timer = setTimeout(() => {
      if (g.current?.mode !== 'wait') return;
      haptic('lift');
      onLift(true);
      if (finger) {
        g.current.mode = 'finger';
        followFingers(start, g.current.sx, g.current.sy);
      } else g.current.mode = 'mouse';
    }, 380);
  };

  const move = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.mode === 'finger') return;
    if (s.mode === 'wait') {
      // Moving before the hold lands: it was a scroll, not for the note.
      if (Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > 8) {
        clearTimeout(s.timer);
        g.current = null;
      }
      return;
    }
    show(keep({ ...s.start, x: s.start.x + (e.clientX - s.sx) / width(), y: s.start.y + (e.clientY - s.sy) }));
  };

  const up = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.mode === 'finger') return;
    clearTimeout(s.timer);
    g.current = null;
    if (s.mode === 'mouse') {
      put();
      return;
    }
    // A plain tap: the click that follows opens it (opening here would let that click land on the sheet's veil).
    tap.current = Math.hypot(e.clientX - s.sx, e.clientY - s.sy) <= 8;
  };

  const cancel = () => {
    const s = g.current;
    if (!s || s.mode === 'finger') return;
    clearTimeout(s.timer);
    g.current = null;
    show(null);
  };

  const read = () => {
    haptic('select');
    openSheet((close) => <NoteSheet ids={[note.id]} onClose={close} />);
  };

  const tick = () => {
    haptic('success');
    setPeeling(true);
    setTimeout(() => {
      const undo = hub.peelNote(note.id);
      toast('Kept in our notes 💛 (on Projects)', { action: { label: 'Undo', run: undo } });
    }, 420);
  };

  return (
    <div
      ref={el}
      data-note={note.id}
      className={`stuck ${lifted ? 'is-lifted' : ''} ${live ? 'is-moving' : ''} ${peeling ? 'is-peeling' : ''}`}
      style={{ left: `${at.x * 100}%`, top: at.y, '--rot': `${at.rot}deg`, '--scale': at.scale } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`A note ${mine ? `for ${hub.member(note.to)?.name ?? 'them'}` : `from ${hub.member(note.by)?.name ?? 'your person'}`}: ${note.text}. Hold to move it; with a second finger, turn and size it.`}
      onKeyDown={(e) => {
        if (e.key === 'Enter') read();
      }}
      onClick={() => {
        if (!tap.current) return;
        tap.current = false;
        read();
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className={`sticky ${photo ? 'has-photo' : ''}`} style={lineVars(note.color)}>
        {photo ? <NotePhoto src={photo} /> : null}
        <FitText text={note.text === '📷' && photo ? '' : note.text} max={photo ? 15 : 22} min={8} />
        <span className="sticky__by">{mine ? `for ${hub.member(note.to)?.name ?? 'them'}` : `— ${hub.member(note.by)?.name ?? ''}`}</span>
      </span>
      <button
        type="button"
        className="sticky__check"
        aria-label="Keep it in our notes"
        onClick={(e) => {
          e.stopPropagation();
          tick();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Icon name="check" className="icon--sm" />
      </button>
    </div>
  );
}

/** A note, big: read it, then peel it off (or, mine, take it down). */
function NoteSheet({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const notes = ids.map((id) => hub.store.get('note', id)).filter((n): n is Note => !!n && !n.deleted && !n.peeledAt);
  const [peeling, setPeeling] = useState<string | null>(null);
  if (!notes.length) return null;
  const peel = (n: Note, away = false) => {
    haptic('tick');
    setPeeling(n.id);
    setTimeout(() => {
      const undo = away ? hub.deleteNote(n.id) : hub.peelNote(n.id);
      toast(away ? 'Taken down' : 'Kept in our notes 💛 (on Projects)', { action: { label: 'Undo', run: undo } });
      setPeeling(null);
      if (notes.length === 1) onClose();
    }, 380);
  };
  return (
    <Sheet onClose={onClose} title={notes.length > 1 ? `${notes.length} notes` : 'A note'}>
      <div className="notesheet">
        {notes.map((n) => {
          const mine = n.by === hub.meId;
          const from = hub.member(n.by);
          return (
            <div key={n.id} className="notesheet__one">
              {mine ? (
                <MyNote note={n} peeling={peeling === n.id} />
              ) : (
                <div className={`sticky sticky--big ${peeling === n.id ? 'is-peeling' : ''}`} style={{ ...lineVars(n.color), '--tilt': `${tiltOf(n.id) / 2}deg` } as CSSProperties}>
                  {hub.shotOf('note', n.id) ? <NotePhoto src={hub.shotOf('note', n.id)!} /> : null}
                  <FitText text={n.text === '📷' && hub.shotOf('note', n.id) ? '' : n.text} max={30} min={14} />
                  <span className="sticky__by">
                    — {from?.name ?? ''} · {shortAgo(n.createdAt)}
                  </span>
                </div>
              )}
              <button type="button" className="btn btn--block" onClick={() => peel(n)}>
                <Icon name="check" className="icon--sm" /> Keep it in our notes 💛
              </button>
              {mine ? (
                <p className="editlink">
                  <button type="button" className="textbtn" onClick={() => peel(n, true)}>
                    Take it down
                  </button>
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/** My own note, opened: its words and paper change right on it (saved as I leave the field). */
function MyNote({ note, peeling }: { note: Note; peeling: boolean }) {
  const hub = useHub();
  const [text, setText] = useState(note.text === '📷' ? '' : note.text);
  const photo = hub.shotOf('note', note.id);
  const latest = useRef(text);
  latest.current = text;
  // Closing the sheet mid-sentence still keeps it.
  useEffect(() => () => hub.editNote(note.id, { text: latest.current }), [hub, note.id]);
  return (
    <>
      <div className={`sticky sticky--big ${peeling ? 'is-peeling' : ''}`} style={{ ...lineVars(note.color), '--tilt': `${tiltOf(note.id) / 2}deg` } as CSSProperties}>
        {photo ? <NotePhoto src={photo} onChange={(j) => hub.setShot('note', note.id, j)} /> : <PhotoAdd onPick={(j) => hub.setShot('note', note.id, j)} />}
        <textarea
          className="sticky__write"
          dir="auto"
          value={text}
          maxLength={240}
          rows={4}
          aria-label="Your note"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => hub.editNote(note.id, { text })}
        />
        <span className="sticky__by">
          For {hub.member(note.to)?.name ?? 'them'} · {shortAgo(note.createdAt)}
        </span>
      </div>
      <div className="note__colors" role="radiogroup" aria-label="Paper">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === note.color}
            aria-label={c}
            className={`note__swatch ${c === note.color ? 'is-on' : ''}`}
            style={lineVars(c)}
            onClick={() => hub.editNote(note.id, { color: c })}
          />
        ))}
      </div>
    </>
  );
}

/** On Today: notes for me stuck on other screens, one line each, there in a tap. */
export function NotesElsewhere() {
  const hub = useHub();
  const byPlace = new Map<string, Note[]>();
  for (const n of hub.notesForMe()) if (n.place !== 'today') byPlace.set(n.place, [...(byPlace.get(n.place) ?? []), n]);
  if (!byPlace.size) return null;
  return (
    <>
      {[...byPlace].slice(0, 3).map(([place, ns]) => {
        const from = hub.member(ns[0].by);
        return (
          <button key={place} type="button" className="notice notice--note" style={lineVars(ns[0].color)} onClick={() => navigate(routeOf(place))}>
            <span className="notice__sticky" aria-hidden="true" />
            <span className="notice__text">
              <strong>
                {from?.name ?? 'Your person'} left you {ns.length > 1 ? `${ns.length} notes` : 'a note'}
              </strong>{' '}
              on <span dir="auto">{placeName(hub, place)}</span>
            </span>
            <Icon name="chevron-right" />
          </button>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- the collected ones

/**
 * Every note we've read and ticked off, kept together on Projects like a corkboard: a little
 * of us to look back on. A tap shows it big, with where it was and when; it can be thrown away.
 */
export function CollectedNotes() {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const notes = hub.collectedNotes();
  // Notes are for the two of us: the board waits for my person.
  if (!notes.length && !hub.partner()) return null;
  return (
    <section className="collected" aria-label="Our notes">
      <h2 className="collected__head">
        <span className="collected__pin" aria-hidden="true" />
        Our notes {notes.length ? <span className="collected__n num">{notes.length}</span> : null}
      </h2>
      <div className={`pinboard ${notes.length ? '' : 'is-empty'}`}>
        {notes.length ? null : (
          <p className="pinboard__empty">
            <span className="sticky sticky--mini sticky--ghost" aria-hidden="true" />
            Notes you tick off land here, to look back on
          </p>
        )}
        {notes.map((n) => (
          <button
            key={n.id}
            type="button"
            className="sticky sticky--mini"
            style={{ ...lineVars(n.color), '--tilt': `${tiltOf(n.id) * 0.8}deg` } as CSSProperties}
            onClick={() => openSheet((close) => <CollectedSheet id={n.id} onClose={close} />)}
          >
            {hub.shotOf('note', n.id) ? <NotePhoto src={hub.shotOf('note', n.id)!} /> : null}
            <FitText text={n.text === '📷' && hub.shotOf('note', n.id) ? '' : n.text} max={hub.shotOf('note', n.id) ? 12 : 17} min={9} />
            <span className="sticky__by">— {hub.member(n.by)?.name ?? ''}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CollectedSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const n = hub.store.get('note', id);
  if (!n) return null;
  const day = new Date(n.createdAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <Sheet onClose={onClose} title="A note">
      <div className="sticky sticky--big" style={{ ...lineVars(n.color), '--tilt': `${tiltOf(n.id) / 2}deg` } as CSSProperties}>
        {hub.shotOf('note', n.id) ? <NotePhoto src={hub.shotOf('note', n.id)!} /> : null}
        <FitText text={n.text === '📷' && hub.shotOf('note', n.id) ? '' : n.text} max={30} min={14} />
        <span className="sticky__by">
          — {hub.member(n.by)?.name ?? ''} · on <span dir="auto">{placeName(hub, n.place)}</span> · {day}
        </span>
      </div>
      <div className="shotview__actions">
        <button
          type="button"
          className="textbtn"
          onClick={() => {
            const undo = hub.deleteNote(id);
            onClose();
            toast('Thrown away', { action: { label: 'Undo', run: undo } });
          }}
        >
          Throw it away
        </button>
      </div>
    </Sheet>
  );
}

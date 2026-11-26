import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { shortAgo } from '../../core/dates';
import type { Note } from '../../core/model';
import { NOTE_MAX, NOTE_MIN } from '../../core/actions';
import { useHub, useRt } from '../context';
import { href, navigate, useRoute, type Route } from '../router';
import { notifyMembers } from '../runtime';
import { haptic } from '../ui/haptics';
import { flyInto, tabTarget } from '../ui/fly';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { NoteEditor, NoteFace, PAPER, PHOTO_HOME, type NoteLook, type PhotoPos, type PhotoShape, type Stroke } from './NoteFace';
import { lineVars } from '../ui/primitives';

/**
 * Sticky notes: one of us leaves a note on a screen for the other ("Don't forget the milk 💛"
 * on Shopping). It sits stuck to that screen, taped on and a little crooked, until the one it's
 * for reads it and peels it off. The little paper by the Ideas tag leaves a new one here.
 */

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
  if (kind === 'list') return hub.list(id)?.name ?? 'a folder';
  if (kind === 'item') return hub.item(id)?.title ?? 'a task';
  return { today: 'Today', shop: 'Shopping', chores: 'Chores', lists: 'Folders' }[kind] ?? 'Today';
}

/** Where a kept note lands on the board, the same every time (from its id): its place in the shuffle, and a pin or tape. */
function messOf(id: string): { order: number; hold: 'pin' | 'tape'; pin: string } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const pins = ['pink', 'sky', 'lemon', 'mint', 'lilac', 'amber'];
  return { order: h >>> 0, hold: (h >>> 7) & 1 ? 'pin' : 'tape', pin: pins[(h >>> 11) % pins.length] };
}

/** A small, stable tilt per note. */
const tiltOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return [-5, -3, 3, 5, -4, 4][Math.abs(h) % 6];
};

/** Where a note's photo sits (older notes had a named place: top, bottom, behind, corner). */
function posOf(n: Note): PhotoPos {
  const v = (n.photoPos ?? '').split(',').map(Number);
  if (v.length === 4 && v.every(Number.isFinite)) return { x: v[0], y: v[1], s: v[2], r: v[3] };
  switch (n.photoAt) {
    case 'bottom':
      return { x: 62, y: 92, s: 52, r: -3 };
    case 'behind':
      return { x: 62, y: 62, s: 112, r: 0 };
    case 'corner':
      return { x: 108, y: 14, s: 54, r: 9 };
    case 'top':
      return { x: 62, y: 32, s: 52, r: 0 };
    default:
      return PHOTO_HOME;
  }
}
const posText = (p: PhotoPos) => `${p.x},${p.y},${p.s},${p.r}`;

/** A note as NoteFace draws it, signed `by`. */
export function lookOf(hub: ReturnType<typeof useHub>, n: Note, by: string): NoteLook {
  let ink: Stroke[] = [];
  try {
    ink = n.ink ? (JSON.parse(n.ink) as Stroke[]) : [];
  } catch {
    /* unreadable ink: none */
  }
  return {
    text: n.text,
    color: n.color,
    by,
    photo: hub.shotOf('note', n.id),
    shape: (n.photoShape as PhotoShape) || 'squircle',
    // Every photo wears a white border now (the old choices read as white too).
    border: 'white',
    pos: posOf(n),
    ink,
    size: n.textSize ?? null,
  };
}

// ---------------------------------------------------------------- leaving one

/** The little paper by the Ideas tag: leave a note on this screen for my person. */
/** Leaving a note on this screen for my person: who it's for and how to start one (none where notes can't go). */
export function useNoteHere(): { to: string; open: () => void } | null {
  const hub = useHub();
  const route = useRoute();
  const { openSheet } = useOverlays();
  const partner = hub.partner();
  const place = placeOf(route);
  if (!partner || !place) return null;
  return {
    to: partner.name,
    open: () => {
      haptic('select');
      openSheet((close) => <NewNoteSheet place={place} onClose={close} />);
    },
  };
}


function NewNoteSheet({ place, onClose }: { place: string; onClose: () => void }) {
  const hub = useHub();
  const rt = useRt();
  const { toast } = useOverlays();
  const partner = hub.partner();
  const [look, setLook] = useState<NoteLook>({ text: '', color: 'lemon', by: `— ${hub.me()?.name ?? ''}`, photo: null, shape: 'squircle', border: 'white', pos: PHOTO_HOME, ink: [], size: null });
  const set = (p: Partial<NoteLook>) => setLook((l) => ({ ...l, ...p }));
  const where = placeName(hub, place);
  const ready = !!look.text.trim() || !!look.photo || look.ink.length > 0;
  const stick = () => {
    const id = hub.addNote(place, look.text.trim() || (look.photo ? '📷' : look.ink.length ? '✏️' : ''), look.color);
    if (!id) return;
    if (look.photo) hub.setShot('note', id, look.photo);
    hub.editNote(id, { photoShape: look.shape, photoBorder: look.border, photoPos: posText(look.pos), ink: look.ink.length ? JSON.stringify(look.ink) : null, textSize: look.size });
    haptic('tick');
    onClose();
    toast(`Stuck on ${where} for ${partner?.name ?? 'them'}`, { action: { label: 'Undo', run: () => hub.deleteNote(id) } });
    if (partner) void notifyMembers(rt, [partner.id], { title: `📝 ${hub.me()?.name ?? 'Your person'} left you a note`, body: look.text.trim() || (look.photo ? '📷 A photo' : '✏️ A drawing'), url: href(routeOf(place)), tag: `note-${id}` });
  };
  return (
    <Sheet onClose={onClose} title={`A note for ${partner?.name ?? 'your person'}`}>
      <p className="note__where">
        It stays on <strong dir="auto">{where}</strong> till {partner?.name ?? 'they'} peels it off
      </p>
      <NoteEditor look={look} set={set} onText={(text) => set({ text })} autoFocus />
      <button type="button" className="btn btn--block noteedit__go" disabled={!ready} onClick={stick}>
        Stick it
      </button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- finding one


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
  const width = () => board.current?.getBoundingClientRect().width || 360;
  // Where it is: where it was left, else up by the top corner, fanned by age.
  const home = (): Place => ({
    x: note.x ?? Math.max(0, (width() - PAPER - 16 - index * 14) / width()),
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
  const g = useRef<{ mode: 'wait' | 'mouse' | 'finger' | 'drag'; sx: number; sy: number; start: Place; timer?: ReturnType<typeof setTimeout> } | null>(null);
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
      // Mostly nearer/further: sizing; mostly round: turning.
      const turn = Math.abs(a - t.a0) * t.d0;
      document.documentElement.dataset.twist = Math.abs(d - t.d0) > turn ? 'scale' : 'rotate';
      show(keep({ ...t.start, rot: t.start.rot + ((a - t.a0) * 180) / Math.PI, scale: t.start.scale * (d / t.d0) }));
    };
    const up = (e: PointerEvent) => {
      const t = twist;
      if (!t) return;
      twist = null;
      delete document.documentElement.dataset.twist;
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
    // The cursor says it: anywhere on the screen turns it (or sizes it, mid-drag).
    const root = document.documentElement;
    root.classList.add('note-lifted');
    return () => {
      document.removeEventListener('pointerdown', down, opts);
      document.removeEventListener('pointermove', move, opts);
      document.removeEventListener('pointerup', up, opts);
      root.classList.remove('note-lifted');
      delete root.dataset.twist;
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
      // A finger picks it up a touch sooner than the mouse.
    }, finger ? 300 : 380);
  };

  const move = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.mode === 'finger') return;
    if (s.mode === 'wait') {
      // Moving before the hold lands: just drag it about (no need to hold first). Turning and
      // sizing still wait for a hold.
      if (Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > 6) {
        clearTimeout(s.timer);
        s.mode = 'drag';
        haptic('select');
        try {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        } catch {
          /* untracked pointer */
        }
      } else return;
    }
    show(keep({ ...s.start, x: s.start.x + (e.clientX - s.sx) / width(), y: s.start.y + (e.clientY - s.sy) }));
  };

  const up = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || s.mode === 'finger') return;
    clearTimeout(s.timer);
    g.current = null;
    if (s.mode === 'mouse' || s.mode === 'drag') {
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

  // Kept: picked up, it glides into Folders (where our notes are kept), which catches it.
  const tick = () => {
    haptic('select');
    const flight = flyInto(el.current, tabTarget('projects'), { color: `var(--${note.color})` });
    setPeeling(true);
    void flight.then(() => {
      haptic('success');
      const undo = hub.peelNote(note.id);
      toast('Kept in our notes 💛 (in Folders)', { action: { label: 'Undo', run: undo } });
    });
  };

  return (
    <div
      ref={el}
      data-note={note.id}
      className={`stuck ${lifted ? 'is-lifted' : ''} ${live ? 'is-moving' : ''} ${peeling ? 'is-peeling' : ''}`}
      style={{ left: `${at.x * 100}%`, top: at.y, '--rot': `${at.rot}deg`, '--scale': at.scale } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`A note ${mine ? `for ${hub.member(note.to)?.name ?? 'them'}` : `from ${hub.member(note.by)?.name ?? 'your person'}`}: ${note.text}. Drag to move it; hold it to turn and size it.`}
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
      <NoteFace look={lookOf(hub, note, mine ? `for ${hub.member(note.to)?.name ?? 'them'}` : `— ${hub.member(note.by)?.name ?? ''}`)} />
      {lifted ? (
        <button
          type="button"
          className="stuck__done"
          aria-label="Done moving it"
          title="Done"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            haptic('drop');
            onLift(false);
          }}
        >
          <Icon name="x" className="icon--sm" />
        </button>
      ) : null}
      <button
        type="button"
        className="sticky__check"
        aria-label="Keep to our notes"
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
  const peel = (n: Note, away = false, from?: Element | null) => {
    haptic('tick');
    // Kept: the note flies out of the sheet into Folders, as the sheet goes.
    if (!away) void flyInto(from?.closest('.notesheet__one')?.querySelector('.nf-wrap') ?? null, tabTarget('projects'), { color: `var(--${n.color})` }).then(() => haptic('success'));
    setPeeling(n.id);
    setTimeout(() => {
      const undo = away ? hub.deleteNote(n.id) : hub.peelNote(n.id);
      toast(away ? 'Deleted' : 'Kept in our notes 💛 (in Folders)', { action: { label: 'Undo', run: undo } });
      setPeeling(null);
      if (notes.length === 1) onClose();
    }, away ? 380 : 120);
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
                <div className={`noteedit__stage ${peeling === n.id ? 'is-peeling' : ''}`}>
                  <NoteFace look={lookOf(hub, n, `— ${from?.name ?? ''} · ${shortAgo(n.createdAt)}`)} scale={2.3} tilt={tiltOf(n.id) / 2} />
                </div>
              )}
              <button type="button" className="btn btn--block notesheet__keep" onClick={(e) => peel(n, false, e.currentTarget)}>
                <Icon name="check" className="icon--sm" /> Keep to our notes 💛
              </button>
              {mine ? (
                <p className="notesheet__delete">
                  <button type="button" className="textbtn textbtn--danger" onClick={() => peel(n, true)}>
                    <Icon name="trash" className="icon--sm" /> Delete
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

/** My own note, opened: changed right on it, exactly as it shows (words saved as I leave them). */
function MyNote({ note, peeling }: { note: Note; peeling: boolean }) {
  const hub = useHub();
  const [text, setText] = useState(note.text === '📷' || note.text === '✏️' ? '' : note.text);
  const latest = useRef(text);
  latest.current = text;
  // Closing the sheet mid-sentence still keeps it.
  useEffect(() => () => hub.editNote(note.id, { text: latest.current }), [hub, note.id]);
  const look = { ...lookOf(hub, note, `For ${hub.member(note.to)?.name ?? 'them'} · ${shortAgo(note.createdAt)}`), text };
  const set = (p: Partial<NoteLook>) => {
    if (p.photo !== undefined) hub.setShot('note', note.id, p.photo);
    hub.editNote(note.id, {
      color: p.color,
      photoShape: p.shape,
      photoBorder: p.border,
      photoPos: p.pos ? posText(p.pos) : undefined,
      ink: p.ink === undefined ? undefined : p.ink.length ? JSON.stringify(p.ink) : null,
      textSize: p.size,
    });
  };
  return (
    <div className={`notemine ${peeling ? 'is-peeling' : ''}`}>
      <NoteEditor look={look} set={set} onText={setText} onTextDone={() => hub.editNote(note.id, { text })} />
    </div>
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
        {/* An even grid, in a shuffled order (the same each time), each turned its own way. */}
        {[...notes]
          .sort((a, b) => messOf(a.id).order - messOf(b.id).order)
          .map((n, i) => {
            const m = messOf(n.id);
            return (
              <button
                key={n.id}
                type="button"
                className={`pinboard__note pinboard__note--${m.hold}`}
                style={{ '--i': i, '--pin': `var(--${m.pin})` } as CSSProperties}
                aria-label={n.text}
                onClick={() => openSheet((close) => <CollectedSheet id={n.id} onClose={close} />)}
              >
                <NoteFace look={lookOf(hub, n, `— ${hub.member(n.by)?.name ?? ''}`)} scale={0.8} tilt={tiltOf(n.id)} />
              </button>
            );
          })}
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
      <div className="noteedit__stage">
        <NoteFace look={lookOf(hub, n, `— ${hub.member(n.by)?.name ?? ''} · ${placeName(hub, n.place)} · ${day}`)} scale={2.3} tilt={tiltOf(n.id) / 2} />
      </div>
      <div className="shotview__actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            // Back where it was left, stuck on its screen again; the toast goes there.
            const undo = hub.unpeelNote(id);
            haptic('success');
            onClose();
            toast(`Back on ${placeName(hub, n.place)}`, { action: { label: 'Undo', run: undo } });
            navigate(routeOf(n.place));
          }}
        >
          <Icon name="undo" className="icon--sm" />
          Put it back on {placeName(hub, n.place)}
        </button>
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

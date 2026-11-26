import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { shortAgo } from '../../core/dates';
import type { LineColor, Note } from '../../core/model';
import { NOTE_MAX, NOTE_MIN } from '../../core/actions';
import { useHub, useRt } from '../context';
import { href, navigate, useRoute, type Route } from '../router';
import { notifyMembers } from '../runtime';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
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
  const where = placeName(hub, place);
  const stick = () => {
    const id = hub.addNote(place, text, color);
    if (!id) return;
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
        <button type="submit" className="btn btn--block" disabled={!text.trim()}>
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
 * new ones up by the top corner, a little fanned. A tap reads it; the one it's for ticks it off
 * (it goes to the collected notes, on Projects). Hold one to pick it up: drag it anywhere, turn
 * it by the round handle on its corner; tap anywhere else to put it down.
 */
export function NotesLayer() {
  const hub = useHub();
  const route = useRoute();
  const place = placeOf(route);
  const [lifted, setLifted] = useState<string | null>(null);
  const board = useRef<HTMLDivElement>(null);
  // Tap anywhere else: put it down.
  useEffect(() => {
    if (!lifted) return;
    const off = (e: PointerEvent) => {
      if (!(e.target as Element)?.closest?.(`[data-note="${lifted}"]`)) setLifted(null);
    };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [lifted]);
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
    x: note.x ?? Math.max(0, (width() - NOTE_W - 16 - index * 14) / width()),
    y: note.y ?? 62 + index * 22,
    rot: note.rot ?? tiltOf(note.id),
    scale: note.scale ?? 1,
  });
  const [live, setLive] = useState<Place | null>(null);
  const liveRef = useRef<Place | null>(null);
  const show = (p: Place | null) => {
    liveRef.current = p;
    setLive(p);
  };
  const at = live ?? home();
  const [peeling, setPeeling] = useState(false);

  /**
   * The gesture. One finger: a hold picks it up, then it follows the finger; a quick tap (no
   * hold, no move) reads it. Two fingers, any time: pinch to size it, twist to turn it, both to
   * move it, like a sticker. The round handle does size and turn for one finger (or a mouse).
   */
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<{
    mode: 'wait' | 'move' | 'pinch' | 'handle';
    sx: number;
    sy: number;
    start: Place;
    timer?: ReturnType<typeof setTimeout>;
    d0?: number;
    a0?: number;
    c0?: { x: number; y: number };
    center?: { x: number; y: number };
  } | null>(null);
  const tap = useRef(false);

  // While it's in hand, the page mustn't scroll (or zoom) under the fingers.
  useEffect(() => {
    const n = el.current;
    if (!n) return;
    const stop = (e: TouchEvent) => {
      if (e.touches.length > 1 || (g.current && g.current.mode !== 'wait')) e.preventDefault();
    };
    n.addEventListener('touchmove', stop, { passive: false });
    return () => n.removeEventListener('touchmove', stop);
  }, []);

  const two = () => {
    const [a, b] = [...fingers.current.values()];
    return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };
  const centerOf = () => {
    const r = el.current!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  const down = (e: React.PointerEvent, handle = false) => {
    if ((e.target as Element).closest('.sticky__check')) return;
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* a pointer the browser doesn't track (synthetic): no capture */
    }
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tap.current = false;
    clearTimeout(g.current?.timer);
    const start = liveRef.current ?? home();
    if (handle) {
      const c = centerOf();
      g.current = { mode: 'handle', sx: e.clientX, sy: e.clientY, start, center: c, d0: Math.hypot(e.clientX - c.x, e.clientY - c.y), a0: Math.atan2(e.clientY - c.y, e.clientX - c.x) };
      return;
    }
    if (fingers.current.size >= 2) {
      const t = two();
      g.current = { mode: 'pinch', sx: t.c.x, sy: t.c.y, start, d0: t.d, a0: t.a, c0: t.c };
      if (!lifted) onLift(true);
      haptic('select');
      return;
    }
    g.current = { mode: lifted ? 'move' : 'wait', sx: e.clientX, sy: e.clientY, start };
    if (!lifted)
      g.current.timer = setTimeout(() => {
        if (g.current?.mode !== 'wait') return;
        g.current.mode = 'move';
        haptic('lift');
        onLift(true);
      }, 380);
  };

  const move = (e: React.PointerEvent) => {
    if (!fingers.current.has(e.pointerId)) return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = g.current;
    if (!s) return;
    const w = width();
    const keep = (p: Place): Place => ({ ...p, x: Math.min(1 - 40 / w, Math.max(-60 / w, p.x)), y: Math.max(8, p.y), scale: clampScale(p.scale) });
    const turned = (rot: number) => {
      let r = ((rot + 540) % 360) - 180;
      if (Math.abs(r) < 2.5) r = 0; // a little snap to straight
      return r;
    };
    if (s.mode === 'wait') {
      // Moving before the hold lands: it was a scroll, not for the note.
      if (Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > 8) {
        clearTimeout(s.timer);
        g.current = null;
      }
      return;
    }
    if (s.mode === 'move') {
      show(keep({ ...s.start, x: s.start.x + (e.clientX - s.sx) / w, y: s.start.y + (e.clientY - s.sy) }));
    } else if (s.mode === 'pinch' && fingers.current.size >= 2) {
      const t = two();
      show(
        keep({
          x: s.start.x + (t.c.x - s.c0!.x) / w,
          y: s.start.y + (t.c.y - s.c0!.y),
          rot: turned(s.start.rot + ((t.a - s.a0!) * 180) / Math.PI),
          scale: s.start.scale * (t.d / Math.max(1, s.d0!)),
        }),
      );
    } else if (s.mode === 'handle') {
      const c = s.center!;
      const d = Math.hypot(e.clientX - c.x, e.clientY - c.y);
      const a = Math.atan2(e.clientY - c.y, e.clientX - c.x);
      show(keep({ ...s.start, rot: turned(s.start.rot + ((a - s.a0!) * 180) / Math.PI), scale: s.start.scale * (d / Math.max(1, s.d0!)) }));
    }
  };

  const up = (e: React.PointerEvent) => {
    fingers.current.delete(e.pointerId);
    const s = g.current;
    if (!s) return;
    // One of two fingers lifted: carry on with the other as a plain move.
    if (s.mode === 'pinch' && fingers.current.size === 1) {
      const [f] = [...fingers.current.values()];
      g.current = { mode: 'move', sx: f.x, sy: f.y, start: liveRef.current ?? s.start };
      return;
    }
    if (fingers.current.size) return;
    g.current = null;
    clearTimeout(s.timer);
    if (s.mode !== 'wait') {
      if (liveRef.current) {
        hub.placeNote(note.id, liveRef.current);
        haptic('drop');
      }
      show(null);
      return;
    }
    // A plain tap: the click that follows opens it (opening here would let that click land on the sheet's veil).
    tap.current = Math.hypot(e.clientX - s.sx, e.clientY - s.sy) <= 8;
  };

  const cancel = (e: React.PointerEvent) => {
    fingers.current.delete(e.pointerId);
    if (fingers.current.size) return;
    clearTimeout(g.current?.timer);
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
      toast('Collected · it’s on Our notes, in Projects', { action: { label: 'Undo', run: undo } });
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
      aria-label={`A note ${mine ? `for ${hub.member(note.to)?.name ?? 'them'}` : `from ${hub.member(note.by)?.name ?? 'your person'}`}: ${note.text}. Hold to move it; pinch to size and turn it.`}
      onKeyDown={(e) => {
        if (e.key === 'Enter') read();
      }}
      onClick={() => {
        if (!tap.current) return;
        tap.current = false;
        read();
      }}
      onPointerDown={(e) => down(e)}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="sticky" style={lineVars(note.color)}>
        <span className="sticky__text" dir="auto">
          {note.text}
        </span>
        <span className="sticky__by">{mine ? `for ${hub.member(note.to)?.name ?? 'them'}` : `— ${hub.member(note.by)?.name ?? ''}`}</span>
      </span>
      <button
        type="button"
        className="sticky__check"
        aria-label="Read: tick it off"
        onClick={(e) => {
          e.stopPropagation();
          tick();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Icon name="check" className="icon--sm" />
      </button>
      {lifted ? (
        <span className="sticky__turn" aria-hidden="true" onPointerDown={(e) => down(e, true)} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
          <Icon name="refresh" className="icon--xs" />
        </span>
      ) : null}
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
      toast(away ? 'Taken down' : 'Collected · it’s on Our notes, in Projects', { action: { label: 'Undo', run: undo } });
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
              <div className={`sticky sticky--big ${peeling === n.id ? 'is-peeling' : ''}`} style={{ ...lineVars(n.color), '--tilt': `${tiltOf(n.id) / 2}deg` } as CSSProperties}>
                <span className="sticky__text" dir="auto">
                  {n.text}
                </span>
                <span className="sticky__by">
                  {mine ? `For ${hub.member(n.to)?.name ?? 'them'}` : `— ${from?.name ?? ''}`} · {shortAgo(n.createdAt)}
                </span>
              </div>
              <button type="button" className="btn btn--block" onClick={() => peel(n)}>
                <Icon name="check" className="icon--sm" /> Got it
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
            <span className="sticky__text" dir="auto">
              {n.text}
            </span>
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
        <span className="sticky__text" dir="auto">
          {n.text}
        </span>
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

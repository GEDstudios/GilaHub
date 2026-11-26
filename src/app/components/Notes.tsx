import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { shortAgo } from '../../core/dates';
import type { LineColor, Note } from '../../core/model';
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
  const forMe = note.to === hub.meId;
  const width = () => board.current?.getBoundingClientRect().width || 360;
  // Where it is: where it was left, else up by the top corner, fanned by age.
  const home = () => ({
    x: note.x ?? Math.max(0, (width() - NOTE_W - 16 - index * 14) / width()),
    y: note.y ?? 62 + index * 22,
    rot: note.rot ?? tiltOf(note.id),
  });
  const [live, setLive] = useState<{ x: number; y: number; rot: number } | null>(null);
  const at = live ?? home();
  const [peeling, setPeeling] = useState(false);

  // One gesture at a time: a hold lifts it, then a drag moves it (or, from the handle, turns it).
  const g = useRef<{ mode: 'wait' | 'move' | 'turn' | 'tap'; sx: number; sy: number; start: { x: number; y: number; rot: number }; timer?: ReturnType<typeof setTimeout>; cx?: number; cy?: number; a0?: number } | null>(null);
  // While a note is held, the page mustn't scroll under the finger.
  useEffect(() => {
    const n = el.current;
    if (!n) return;
    const stop = (e: TouchEvent) => {
      if (g.current && (g.current.mode === 'move' || g.current.mode === 'turn')) e.preventDefault();
    };
    n.addEventListener('touchmove', stop, { passive: false });
    return () => n.removeEventListener('touchmove', stop);
  }, []);

  const down = (e: React.PointerEvent, turn = false) => {
    if ((e.target as Element).closest('.sticky__check')) return;
    e.stopPropagation();
    const start = home();
    if (turn) {
      const r = el.current!.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      g.current = { mode: 'turn', sx: e.clientX, sy: e.clientY, start, cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx) };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    g.current = { mode: lifted ? 'move' : 'wait', sx: e.clientX, sy: e.clientY, start };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (!lifted)
      g.current.timer = setTimeout(() => {
        if (g.current?.mode !== 'wait') return;
        g.current.mode = 'move';
        haptic('select');
        onLift(true);
      }, 380);
  };
  const move = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s) return;
    const dx = e.clientX - s.sx;
    const dy = e.clientY - s.sy;
    if (s.mode === 'wait') {
      // Moving before the hold lands: it was a scroll, not for the note.
      if (Math.hypot(dx, dy) > 8) {
        clearTimeout(s.timer);
        g.current = null;
      }
      return;
    }
    if (s.mode === 'move') {
      const w = width();
      setLive({ x: Math.min(1 - 40 / w, Math.max(-60 / w, s.start.x + dx / w)), y: Math.max(8, s.start.y + dy), rot: s.start.rot });
    } else if (s.mode === 'turn') {
      const a = Math.atan2(e.clientY - s.cy!, e.clientX - s.cx!);
      let rot = s.start.rot + ((a - s.a0!) * 180) / Math.PI;
      rot = ((rot + 540) % 360) - 180;
      // A little snap to straight.
      if (Math.abs(rot) < 2.5) rot = 0;
      setLive({ ...s.start, rot });
    }
  };
  const up = (e: React.PointerEvent) => {
    const s = g.current;
    g.current = null;
    if (!s) return;
    clearTimeout(s.timer);
    const moved = Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > 8;
    if ((s.mode === 'move' || s.mode === 'turn') && live) {
      hub.placeNote(note.id, live);
      haptic('drop');
      setLive(null);
      return;
    }
    // A plain tap: read it.
    if (s.mode === 'wait' && !moved) {
      haptic('select');
      openSheet((close) => <NoteSheet ids={[note.id]} onClose={close} />);
    }
  };

  const tick = () => {
    haptic('success');
    setPeeling(true);
    setTimeout(() => {
      const undo = hub.peelNote(note.id);
      toast('Collected · it’s with your notes in Projects', { action: { label: 'Undo', run: undo } });
    }, 420);
  };

  return (
    <div
      ref={el}
      data-note={note.id}
      className={`stuck ${lifted ? 'is-lifted' : ''} ${live ? 'is-moving' : ''} ${peeling ? 'is-peeling' : ''}`}
      style={{ left: `${at.x * 100}%`, top: at.y, '--rot': `${at.rot}deg` } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`A note ${mine ? `for ${hub.member(note.to)?.name ?? 'them'}` : `from ${hub.member(note.by)?.name ?? 'your person'}`}: ${note.text}. Hold to move it.`}
      onKeyDown={(e) => {
        if (e.key === 'Enter') openSheet((close) => <NoteSheet ids={[note.id]} onClose={close} />);
      }}
      onPointerDown={(e) => down(e)}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        clearTimeout(g.current?.timer);
        g.current = null;
        setLive(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="sticky" style={lineVars(note.color)}>
        <span className="sticky__text" dir="auto">
          {note.text}
        </span>
        <span className="sticky__by">{mine ? `for ${hub.member(note.to)?.name ?? 'them'}` : `— ${hub.member(note.by)?.name ?? ''}`}</span>
      </span>
      {forMe ? (
        <button type="button" className="sticky__check" aria-label="Read it: tick it off" onClick={tick} onPointerDown={(e) => e.stopPropagation()}>
          <Icon name="check" className="icon--sm" />
        </button>
      ) : null}
      {lifted ? (
        <span className="sticky__turn" aria-hidden="true" onPointerDown={(e) => down(e, true)} onPointerMove={move} onPointerUp={up}>
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
  const peel = (n: Note) => {
    haptic('tick');
    setPeeling(n.id);
    setTimeout(() => {
      const undo = hub.peelNote(n.id);
      toast(n.by === hub.meId ? 'Taken down' : 'Collected · it’s with your notes in Projects', { action: { label: 'Undo', run: undo } });
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
              <button type="button" className={`btn btn--block ${mine ? 'btn--quiet' : ''}`} onClick={() => peel(n)}>
                {mine ? 'Take it down' : (<><Icon name="check" className="icon--sm" /> Got it</>)}
              </button>
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
  if (!notes.length) return null;
  return (
    <section className="collected" aria-label="Our notes">
      <h2 className="collected__head">
        <span className="collected__pin" aria-hidden="true" />
        Our notes <span className="collected__n num">{notes.length}</span>
      </h2>
      <div className="pinboard">
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

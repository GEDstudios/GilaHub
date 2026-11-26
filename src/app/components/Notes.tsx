import { useState, type CSSProperties } from 'react';
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
    if (partner) void notifyMembers(rt, [partner.id], { title: `${hub.me()?.name ?? 'Your person'} left you a note`, body: text.trim(), url: href(routeOf(place)), tag: `note-${id}` });
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

/** The notes stuck on this screen, up by the top corner: the newest on top, the rest peeking. */
export function NotesLayer() {
  const hub = useHub();
  const route = useRoute();
  const { openSheet } = useOverlays();
  const place = placeOf(route);
  if (!place) return null;
  const notes = hub.notesOn(place);
  if (!notes.length) return null;
  const top = notes[0];
  return (
    <button
      type="button"
      className="stickies"
      aria-label={`${notes.length > 1 ? `${notes.length} notes` : 'A note'} from ${hub.member(top.by)?.name ?? 'your person'}: ${top.text}`}
      onClick={() => {
        haptic('select');
        openSheet((close) => <NoteSheet ids={notes.map((n) => n.id)} onClose={close} />);
      }}
    >
      {notes.slice(0, 3).reverse().map((n, i, shown) => (
        <StickyFace key={n.id} note={n} under={shown.length - 1 - i} />
      ))}
      {notes.length > 1 ? <span className="stickies__n num">{notes.length}</span> : null}
    </button>
  );
}

function StickyFace({ note, under }: { note: Note; under: number }) {
  const hub = useHub();
  const mine = note.by === hub.meId;
  return (
    <span
      className={`sticky ${under ? 'is-under' : ''} ${mine ? 'is-mine' : ''}`}
      style={{ ...lineVars(note.color), '--tilt': `${tiltOf(note.id) + under * 4}deg`, '--under': under } as CSSProperties}
      aria-hidden="true"
    >
      <span className="sticky__text" dir="auto">
        {note.text}
      </span>
      <span className="sticky__by">{mine ? `for ${hub.member(note.to)?.name ?? 'them'}` : `— ${hub.member(note.by)?.name ?? ''}`}</span>
    </span>
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
      toast(n.by === hub.meId ? 'Taken down' : 'Peeled off', { action: { label: 'Undo', run: undo } });
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
                {mine ? 'Take it down' : 'Peel it off'}
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

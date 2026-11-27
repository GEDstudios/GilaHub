import { useAutosize } from '../ui/AutoTitle';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react';
import { shortAgo, shortDay } from '../../core/dates';
import type { Idea } from '../../core/model';
import { useHub } from '../context';
import { usePrefs } from '../usePrefs';
import { ideasMarkdown, ideasUnseen, ideasView } from '../views';
import { markFresh, useFresh } from '../ui/fresh';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Check, Disclosure, lineVars, TextButton, Button } from '../ui/primitives';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { useSettle } from '../ui/useSettle';
import { SketchSheet, useShotPicker } from './Sketch';
import { G } from '../ui/glyphs';
import { howMany } from '../labels';
import type { Hub } from '../../core/hub';

/**
 * Ideas: our wish list for Gila Hub itself. A small paper tag sits in the page
 * header on every screen (IdeaTag, drawn once by the App shell; it scrolls with the page); it opens the Ideas sheet, where
 * either of us writes, edits, reorders and resolves. Settings has a switch for the tag and a
 * row that opens the same sheet.
 */

// ---------------------------------------------------------------- last seen (this device)

const SEEN_KEY = 'gh.ideasSeen';
const seenListeners = new Set<() => void>();

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

let seenAt = readSeen();

/** Everything up to now counts as seen: the sheet was opened (or closed) on this device. */
function markSeen(): void {
  seenAt = Date.now();
  try {
    localStorage.setItem(SEEN_KEY, String(seenAt));
  } catch {
    /* storage blocked: remembered until the page reloads */
  }
  seenListeners.forEach((l) => l());
}

function useSeenAt(): number {
  return useSyncExternalStore(
    (l) => {
      seenListeners.add(l);
      return () => seenListeners.delete(l);
    },
    () => seenAt,
  );
}

/** Open the Ideas sheet (the tag, and Settings). */
export function useOpenIdeas(): () => void {
  const { openSheet } = useOverlays();
  return useCallback(() => {
    const since = seenAt;
    markSeen();
    openSheet((close) => (
      <IdeasSheet
        since={since}
        onClose={() => {
          markSeen();
          close();
        }}
      />
    ));
  }, [openSheet]);
}

// ---------------------------------------------------------------- the tag

/** How many ideas are open, and whether my person has done something new with them (for a badge). */
export function useIdeasBadge(): { n: number; fresh: boolean; partner: ReturnType<Hub['partner']> } {
  const hub = useHub();
  const seen = useSeenAt();
  const partner = hub.partner();
  return { n: ideasView(hub).open.length, fresh: !!partner && !!ideasUnseen(hub, seen), partner };
}

/**
 * The tag: a paper label in the header, by the avatar, with a punched hole, a light bulb and
 * the open count. A dot in my partner's color says they added or changed something since I
 * last looked. It steps aside for sheets and the keyboard (CSS).
 */
export function IdeaTag() {
  const hub = useHub();
  const prefs = usePrefs();
  const seen = useSeenAt();
  const open = useOpenIdeas();

  if (!prefs.ideasTag) return null;
  const n = ideasView(hub).open.length;
  const partner = hub.partner();
  const news = partner ? ideasUnseen(hub, seen) : null;
  const fresh = !!partner && !!news;
  const said = !partner || !news ? '' : news === 'new' ? `new from ${partner.name}` : `${partner.name} ${news} your idea`;
  const label = ['Ideas for Gila Hub', n ? `${n} open` : '', said].filter(Boolean).join(', ');

  return (
    <button
      type="button"
      className="ideatag"
      aria-label={label}
      title="Ideas for Gila Hub"
      onClick={() => {
        haptic('select');
        open();
      }}
    >
      <span className="ideatag__body">
        <span className="ideatag__paper">
          <Icon name={G.idea} />
          {n ? <span className="ideatag__n num">{n}</span> : null}
        </span>
        {fresh ? <span className="ideatag__dot" style={lineVars(partner.color)} /> : null}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- the sheet

/** Enter commits, Shift+Enter is a new line. */
const isCommit = (e: KeyboardEvent) => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing;

function Composer() {
  const hub = useHub();
  const [text, setText] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useShotPicker(setShot);
  useAutosize(text, field);
  const add = (e?: FormEvent) => {
    e?.preventDefault();
    const id = hub.addIdea(text.trim() || (shot ? 'See the picture' : ''));
    if (!id) return;
    if (shot) hub.setIdeaShot(id, shot);
    haptic('tick');
    markFresh(id);
    setText('');
    setShot(null);
  };
  return (
    <form className={`addrow ideas__compose ${shot ? 'has-shot' : ''}`} onSubmit={add}>
      <span className="addrow__plus" aria-hidden="true">
        <Icon name={G.add} />
      </span>
      <textarea
        ref={field}
        rows={1}
        dir="auto"
        value={text}
        placeholder="What should Gila Hub do better?"
        aria-label="New idea"
        enterKeyHint="send"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (isCommit(e)) add(e);
        }}
      />
      {shot ? (
        <span className="ideas__pending">
          <img src={shot} alt="Your picture" />
          <button type="button" className="ideas__unshot" aria-label="Take the picture off" onClick={() => setShot(null)}>
            <Icon name={G.close} className="icon--xs" />
          </button>
        </span>
      ) : (
        <button type="button" className="slot__btn ideas__shotbtn" aria-label="Add a screenshot to draw on" title="Add a screenshot" onClick={picker.pick}>
          <Icon name={G.photo} />
        </button>
      )}
      {picker.input}
      {text.trim() || shot ? (
        <Button small type="submit" className="ideas__add">
          Add
        </Button>
      ) : null}
    </form>
  );
}

/** An idea's picture, small, under its text: tap to see it big, draw on it again, or take it off. */
function Shot({ idea }: { idea: Idea }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const src = hub.ideaShot(idea.id);
  if (!idea.shotN) return null;
  if (!src) return <span className="idea__shot is-loading" aria-label="Picture on its way" />;
  return (
    <button type="button" className="idea__shot" aria-label="See the picture" onClick={() => openSheet((close) => <ShotSheet id={idea.id} onClose={close} />)}>
      <img src={src} alt="" />
    </button>
  );
}

function ShotSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const hub = useHub();
  const { openSheet, toast } = useOverlays();
  const src = hub.ideaShot(id);
  if (!src) return null;
  return (
    <Sheet onClose={onClose} title="The picture">
      <img className="shotview" src={src} alt={hub.idea(id)?.text ?? ''} />
      <div className="shotview__actions">
        <Button
          icon={G.draw}
          block
          onClick={() => openSheet((close) => <SketchSheet src={src} onDone={(jpeg) => hub.setIdeaShot(id, jpeg)} onClose={close} title="Draw on it" />)}
        >
          Draw on it
        </Button>
        <TextButton
          onClick={() => {
            hub.setIdeaShot(id, null);
            onClose();
            toast('Picture taken off', { undo: () => hub.setIdeaShot(id, src) });
          }}
        >
          Take it off
        </TextButton>
      </div>
    </Sheet>
  );
}

/**
 * The text, edited in place: blur or Enter saves, Esc puts it back. Only a change is saved: a
 * tap in and out never writes (it would undo my partner's newer wording and credit me), and
 * while I haven't typed, their edit shows up in the field.
 */
function IdeaText({ idea }: { idea: Idea }) {
  const hub = useHub();
  const [draft, setDraft] = useState<string | null>(null);
  const base = useRef('');
  const field = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  useAutosize(draft ?? '', field);
  useEffect(() => {
    if (draft === null || draft !== base.current) return;
    base.current = idea.text;
    setDraft(idea.text);
    // Only when the text arrives from my partner; my own typing is `draft`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea.text]);
  useEffect(() => {
    const el = field.current;
    if (draft === null || !el || document.activeElement === el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [draft]);

  if (draft === null)
    return (
      <button
        type="button"
        className="idea__text"
        dir="auto"
        onClick={() => {
          base.current = idea.text;
          setDraft(idea.text);
        }}
      >
        <span className="row__title">{idea.text}</span>
      </button>
    );
  return (
    <textarea
      ref={field}
      className="row__title idea__edit"
      rows={1}
      dir="auto"
      value={draft}
      aria-label="Edit idea"
      enterKeyHint="done"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (isCommit(e)) {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          // Only the edit, not the sheet.
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        if (!cancelled.current && draft.trim() !== base.current.trim()) hub.editIdea(idea.id, draft);
        cancelled.current = false;
        setDraft(null);
      }}
    />
  );
}

function useMeta(idea: Idea): string {
  const hub = useHub();
  const name = (id: string | null | undefined) => hub.member(id)?.name ?? 'Someone';
  if (idea.resolvedAt) return `Resolved by ${name(idea.resolvedBy)} · ${shortDay(idea.resolvedAt)}`;
  const edited = idea.editedBy && idea.editedBy !== idea.by ? ` · edited by ${name(idea.editedBy)}` : '';
  return `${name(idea.by)} · ${shortAgo(idea.createdAt)}${edited}`;
}

/** An open idea: [author dot][text, meta][check][grip]. */
function OpenRow({ idea, settling, onResolve }: { idea: Idea; settling: boolean; onResolve: (id: string) => void }) {
  const hub = useHub();
  const s = useSortableItem(idea.id, { disabled: settling });
  const fresh = useFresh(idea.id);
  const meta = useMeta(idea);
  return (
    <li
      ref={s.ref}
      style={s.style}
      {...s.props}
      data-settle={idea.id}
      data-id={idea.id}
      className={`row idea ${s.className} ${settling ? 'is-settling' : ''} ${fresh ? 'row--fresh row--flash' : ''}`}
    >
      <span className="idea__dot" style={lineVars(hub.member(idea.by)?.color)} aria-hidden="true" />
      <div className="row__body">
        <IdeaText idea={idea} />
        <span className="row__meta" dir="auto">
          {meta}
        </span>
        <Shot idea={idea} />
      </div>
      <Check on={settling} color={hub.me()?.color} onToggle={() => onResolve(idea.id)} label={idea.text} disabled={settling} />
      <button type="button" data-grip ref={s.gripRef} {...s.gripProps} className="slot__btn slot__grip" aria-label={`Move ${idea.text}`}>
        <Icon name={G.grip} />
      </button>
    </li>
  );
}

/** The lifted copy while dragging. */
function LiftedRow({ idea }: { idea: Idea }) {
  const hub = useHub();
  const meta = useMeta(idea);
  return (
    <ul className="rows">
      <li className="row idea">
        <span className="idea__dot" style={lineVars(hub.member(idea.by)?.color)} aria-hidden="true" />
        <div className="row__body">
          <span className="idea__text" dir="auto">
            <span className="row__title">{idea.text}</span>
          </span>
          <span className="row__meta" dir="auto">
            {meta}
          </span>
        </div>
        <span className="check" aria-hidden="true" />
        <span className="slot__btn slot__grip" aria-hidden="true">
          <Icon name={G.grip} />
        </span>
      </li>
    </ul>
  );
}

/** A resolved idea: muted and struck; the check reopens it, × deletes it (with Undo). */
function ResolvedRow({ idea }: { idea: Idea }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const meta = useMeta(idea);
  return (
    <li className="row idea is-done" data-id={idea.id}>
      <span className="idea__dot" style={lineVars(hub.member(idea.by)?.color)} aria-hidden="true" />
      <div className="row__body">
        <span className="row__title" dir="auto">
          {idea.text}
        </span>
        <span className="row__meta" dir="auto">
          {meta}
        </span>
        <Shot idea={idea} />
      </div>
      {/* Filled in the color of whoever resolved it */}
      <Check on color={hub.member(idea.resolvedBy)?.color} onToggle={() => hub.reopenIdea(idea.id)} label={idea.text} />
      <button
        type="button"
        className="slot__btn"
        aria-label={`Delete ${idea.text}`}
        onClick={() => {
          haptic('tick');
          const undo = hub.deleteIdea(idea.id);
          toast('Idea deleted', { undo });
        }}
      >
        <Icon name={G.close} />
      </button>
    </li>
  );
}


/** `since`: when this device last looked, so news about my ideas opens Resolved. */
function IdeasSheet({ onClose, since }: { onClose: () => void; since: number }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const { open, resolved } = ideasView(hub);
  // Kept here, not in the fold: deleting its last row unmounts it, and Undo must find it open.
  const [resolvedOpen, setResolvedOpen] = useState(() => ideasUnseen(hub, since) === 'resolved');
  const settle = useSettle<Idea>();
  const rows = settle.view('open', open);

  const resolve = (id: string) => {
    settle.hold(id);
    hub.resolveIdea(id);
  };

  const copy = async () => {
    const n = open.length;
    try {
      await navigator.clipboard.writeText(ideasMarkdown(hub));
      toast(`Copied ${howMany(n, 'idea')}`);
    } catch {
      toast('Couldn’t copy here.');
    }
  };

  return (
    <Sheet onClose={onClose} title="Ideas for Gila Hub">
      <Composer />
      {open.length || resolved.length ? null : <p className="ideas__empty">Nothing yet. Write the first one.</p>}
      {rows.length ? (
        <Sortable
          ids={open.map((i) => i.id)}
          grips
          onMove={(next) => hub.reorderIdeas(next)}
          label={(id) => hub.idea(id)?.text ?? ''}
          renderOverlay={(id) => {
            const idea = hub.idea(id);
            return idea ? <LiftedRow idea={idea} /> : null;
          }}
        >
          {/* A drag here moves an idea, never the sheet. */}
          <ul className="rows ideas" data-no-pull>
            {rows.map(({ row, settling }) => (
              <OpenRow key={row.id} idea={row} settling={settling} onResolve={resolve} />
            ))}
          </ul>
        </Sortable>
      ) : null}
      {resolved.length ? (
        <Disclosure title="Resolved" count={resolved.length} open={resolvedOpen} onToggle={setResolvedOpen}>
          <ul className="rows ideas">
            {resolved.map((i) => (
              <ResolvedRow key={i.id} idea={i} />
            ))}
          </ul>
        </Disclosure>
      ) : null}
      {open.length ? (
        <div className="ideas__foot">
          <TextButton icon={G.copy} onClick={() => void copy()}>
            Copy open ideas
          </TextButton>
        </div>
      ) : null}
    </Sheet>
  );
}

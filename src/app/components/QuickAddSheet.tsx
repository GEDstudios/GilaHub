import { navigate } from '../router';
import { useAlsoShop } from '../alsoShop';
import { useEffect, useRef, useState } from 'react';
import { suggestFromCatalog } from '../../smart/categorize';
import { splitPasted } from '../../smart/normalize';
import { composerPlaceholder, splitSteps } from '../compose';
import { useHub } from '../context';
import { getPrefs, usePrefs } from '../prefs';
import { projectView } from '../views';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { useBackGuard } from '../ui/backGuard';
import { lineVars } from '../ui/primitives';
import { UrgentTag } from '../ui/tags';
import { EChip, InlineEditor, useSummary, type Field } from './editors';
import { listChip, ParsedToken, tagChip, useCompose, type ComposeSeed } from './QuickAdd';

/**
 * New: the one way to add, from the black + on every screen. You write straight onto the
 * colour card, with every option right under it: the project, subtasks (typed in a list, or in
 * the words: "Pack: towels, hats"), date, repeat, notification, who, who sees it, urgent. It opens pointed at where you
 * are: `listId` (any kind of project), `parentId` (a step of this item), `defaultDue` (a
 * day), else the last folder you added to, else To do. Add puts it there and closes.
 */
/**
 * A thing half-written in New is kept on this device while the sheet is open, so a reload (an
 * update, a pull, the phone's own) brings it back as it was: the words, the project, the chips,
 * the subtasks. Closing the sheet, or adding, lets it go.
 */
const DRAFT_KEY = 'gila-hub:composer';
const DRAFT_TTL = 24 * 3600_000;

export interface ComposerDraft {
  text: string;
  listId: string;
  parentId: string | null;
  defaultDue?: string | null;
  route?: boolean;
  own: string[];
  asStep: boolean;
  seed: ComposeSeed;
  at: number;
}

function saveDraft(d: ComposerDraft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage blocked */
  }
}

/** The draft left by a reload, if it's recent and still has somewhere to go. */
export function pendingDraft(hub: ReturnType<typeof useHub>): ComposerDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as ComposerDraft | null;
    if (!d || Date.now() - d.at > DRAFT_TTL || !hub.list(d.listId) || (!d.text?.trim() && !d.own?.length)) return null;
    return d;
  } catch {
    return null;
  }
}

/** What tapping outside New does: set by the composer (save what's written), else just close. */
type Outside = { current: (() => void) | null };

export function QuickAddSheet({
  onClose,
  defaultDue,
  listId,
  parentId,
  route,
  text,
  restore,
}: {
  onClose: () => void;
  /** A draft a reload interrupted: back exactly as it was. */
  restore?: ComposerDraft;
  /** Start with these words on the card (a suggestion tapped on the page). */
  text?: string;
  defaultDue?: string | null;
  listId?: string;
  /** On an item's page: add a step of it (a chip turns it into its own task). */
  parentId?: string | null;
  /** From the combined Shopping tab: route each item to the list it belongs on. */
  route?: boolean;
}) {
  const hub = useHub();
  const lists = hub.lists();
  const last = getPrefs().lastList;
  const outside = useRef<() => void>(null) as Outside;
  // A tap outside keeps what's written (it's added); with nothing written it just closes.
  const onOutside = () => (outside.current ? outside.current() : onClose());
  if (restore && hub.list(restore.listId))
    return (
      <Sheet onClose={onClose} label="New" onOutside={onOutside}>
        <Composer
          listId={restore.listId}
          parentId={restore.parentId}
          defaultDue={restore.defaultDue}
          route={restore.route}
          initialText={restore.text}
          restore={restore}
          onDone={onClose}
          outside={outside}
        />
      </Sheet>
    );
  // Not from a folder (Today, search…): where I said new things go. Mine: my private To-Do.
  // Ours: the last shared folder I added to (never a private one).
  const shared = (l: { visibility: string }) => l.visibility !== 'private';
  const mine = getPrefs().todayNew !== 'ours' ? hub.list(hub.personalFolderId()) : undefined;
  const initial =
    (listId && hub.list(listId)) ||
    (mine && !mine.archived ? mine : undefined) ||
    (last && lists.find((l) => l.id === last && (mine !== undefined || shared(l)))) ||
    lists.find((l) => l.name === 'To do' && shared(l)) ||
    lists.find(shared) ||
    lists[0];
  return (
    <Sheet onClose={onClose} label="New" onOutside={onOutside}>
      {initial ? (
        <Composer listId={initial.id} parentId={parentId ?? null} defaultDue={defaultDue} route={route && !!listId} initialText={text} onDone={onClose} outside={outside} />
      ) : (
        <p className="hint">Make a folder first. Everything you add lives in one.</p>
      )}
    </Sheet>
  );
}

/** Every option, right there: the same for every project. */
const FIELDS: Field[] = ['when', 'repeat', 'remind', 'who', 'vis', 'urgent'];

function Composer({
  listId,
  parentId,
  defaultDue,
  route,
  initialText = '',
  restore,
  onDone,
  outside,
}: {
  outside?: Outside;
  listId: string;
  parentId: string | null;
  defaultDue?: string | null;
  route?: boolean;
  initialText?: string;
  restore?: ComposerDraft;
  onDone: () => void;
}) {
  const hub = useHub();
  const prefs = usePrefs();
  const { toast } = useOverlays();
  const alsoShop = useAlsoShop();
  const summarize = useSummary();
  const [text, setText] = useState(initialText);
  const [roll] = useState(Math.random);
  const [asStep, setAsStep] = useState(restore ? restore.asStep : !!parentId);
  const [own, setOwn] = useState<string[]>(restore?.own ?? []);
  const [stepText, setStepText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  // "Task: a, b and c" puts its steps in the words (not for shopping, nor for a step itself).
  const words = asStep ? { head: text, steps: [] } : splitSteps(text);
  const c = useCompose({
    listId,
    parentId: asStep ? parentId : null,
    defaultDue,
    text: words.head,
    route,
    seed: restore?.seed,
  });

  // A tap outside: what's written is added (and the sheet goes); nothing written, it just closes.
  if (outside)
    outside.current = () => {
      if (c.parsed.title.trim() && save(undefined, false)) saveDraft(null);
      onDone();
    };

  // Back with something written: save it, or discard it (closing the question keeps writing).
  useBackGuard({
    dirty: !!text.trim() || own.length > 0,
    title: 'Save this task?',
    saveLabel: 'Save it',
    discardLabel: 'Discard',
    onSave: () => {
      if (!c.parsed.title.trim() || !save(undefined, false)) return onDone();
      saveDraft(null);
      onDone();
    },
    onDiscard: () => {
      saveDraft(null);
      onDone();
    },
  });

  // Kept while it's being written (a reload brings it back); gone once added or closed.
  const keep = text.trim() || own.length ? JSON.stringify({ text, own, asStep, seed: c.seed }) : '';
  useEffect(() => {
    if (!keep) return saveDraft(null);
    saveDraft({ text, listId, parentId, defaultDue, route, own, asStep, seed: c.seed, at: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keep]);
  useEffect(() => () => saveDraft(null), []);
  const { draft, dest, parsed } = c;
  const title = parsed.title.trim();
  // Who stays offered even in a Private folder: asking my person takes it to a shared one.
  const fields = FIELDS.filter((f) => f !== 'who' || draft.visibility !== 'private' || !!hub.partner());
  const steps = c.parent ? [] : [...words.steps, ...own];
  const parent = hub.item(parentId);

  // The card's text grows with what you write.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Take the focus (the tap already raised the keyboard; see ui/keyboard.ts).
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, []);

  /** Add it and close. "Already there" and "brought back" still say so. */
  const submit = (raw?: string) => {
    if (raw === undefined && !title) return;
    // The card closes; the toast says where it went when that isn't in sight.
    if (!save(raw, false)) return;
    saveDraft(null);
    onDone();
  };

  /** Save the task and its subtasks; returns the new ids (the task, then each subtask). */
  const save = (raw?: string, listed = true): { id: string; kids: string[] } | null => {
    const id = c.commit(raw === undefined ? undefined : raw, { listed });
    if (!id) return null;
    const made = hub.item(id);
    const kids = made
      ? steps.map((t) => {
          const kid = hub.addItem(made.listId, { title: t, parentId: id });
          alsoShop(kid);
          return kid;
        })
      : [];
    return { id, kids };
  };

  /** Open a subtask fully: the task is saved (with all its subtasks) and that subtask's page opens. */
  const openSub = (i: number) => {
    if (!title) return;
    const r = save();
    if (!r) return;
    onDone();
    const kid = r.kids[i];
    // Through the task, so Back from the subtask lands on it.
    if (kid)
      setTimeout(() => {
        navigate({ name: 'item', id: r.id });
        navigate({ name: 'item', id: kid });
      }, 0);
  };

  /** Change the subtasks in place. Ones that came from the words ("Pack: a, b") move into the list, and the words keep only the task. */
  const editSteps = (next: string[]) => {
    if (words.steps.length) setText(words.head);
    setOwn(next);
  };

  const addStep = () => {
    const t = stepText.trim();
    if (!t) return;
    setOwn((s) => [...s, t]);
    setStepText('');
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const lines = splitPasted(e.clipboardData.getData('text'));
    if (lines.length < 2) return;
    e.preventDefault();
    hub.store.batch(() => {
      for (const l of lines) c.commit(l, { quiet: true });
    });
    toast(`Added ${lines.length} items to ${dest?.name ?? 'your list'}`);
    onDone();
  };

  const qty = parsed.qty ? (/^\d+$/.test(parsed.qty) ? `×${parsed.qty}` : parsed.qty) : '';
  const sub = c.parent ? `A subtask of ${c.parent.title}` : [summarize(draft, { listName: dest?.name }), qty].filter(Boolean).join(' · ');

  // While typing: what you might mean (the catalog); on an empty card: Again? (done here before, due again).
  const suggestions: string[] = c.parent
    ? []
    : title
      ? suggestFromCatalog(title, undefined, 4)
          .map((s) => s.label)
          .filter((s) => s.toLowerCase() !== title.toLowerCase())
      : projectView(hub, dest?.id ?? listId, !!route, 'list', prefs.dismissed)
          .again.slice(0, 5)
          .map((s) => s.name);

  // Where it goes (a project, or a task in one): not when it's already a subtask being added in place.
  const extras = [
    ...(c.fixedParent ? [] : [listChip(c, hub.lists())]),
    // Its tags: what the words suggest, or picked here.
    tagChip(c, hub),
  ];

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="ccard ccard--lg composer__card" style={lineVars(dest?.color)}>
        <span className="ccard__top">
          <textarea
            ref={field}
            className="ccard__input composer__input"
            value={text}
            dir="auto"
            rows={1}
            onChange={(e) => {
              setText(e.target.value.replace(/\n/g, ' '));
              if (!e.target.value) c.reset();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={onPaste}
            placeholder={c.parent ? 'A subtask' : composerPlaceholder('task', hub.partner()?.name, roll) || 'A new thing'}
            aria-label={c.parent ? 'A subtask' : 'What needs doing?'}
            enterKeyHint="enter"
            autoComplete="off"
            data-autofocus=""
          />
          {draft.urgent ? (
            <span className="ccard__badge">
              <UrgentTag />
            </span>
          ) : draft.repeat ? (
            <span className="ccard__badge">
              <Icon name="repeat" className="icon--sm" />
            </span>
          ) : null}
        </span>
        <span className="ccard__sub">{sub}</span>
      </div>

      {parsed.tokens.length ? (
        <div className="tokens composer__tokens">
          {parsed.tokens.map((t) => (
            <ParsedToken key={t.key} label={t.label} onKeep={() => c.keepAsText(t.key)} />
          ))}
        </div>
      ) : null}

      {suggestions.length ? (
        <div className="tokens tokens--scroll composer__suggest">
          {suggestions.map((s) => (
            <button key={s} type="button" className="token" onClick={() => submit(s)}>
              <Icon name="plus" />
              <span dir="auto">{s}</span>
            </button>
          ))}
        </div>
      ) : null}

      <InlineEditor
        whoMode="compose"
        value={draft}
        onChange={c.change}
        fields={fields}
        allowedVis={c.allowed}
        repeatFrom="schedule"
        extras={extras}
        after={
          <>
            {parent ? (
              <EChip
                icon={asStep ? 'steps' : 'lines'}
                label={asStep ? 'A subtask' : 'Its own task'}
                set={asStep}
                open={false}
                onToggle={() => setAsStep(!asStep)}
              />
            ) : null}
          </>
        }
      />

      {!c.parent ? (
        <div className="composer__steps">
          {steps.length ? (
            <ul className="composer__steplist">
              {steps.map((t, i) => (
                <li key={i} className="composer__step">
                  <span className="composer__stepdot" aria-hidden="true" />
                  <input
                    className="composer__stepinput"
                    value={t}
                    dir="auto"
                    onChange={(e) => editSteps(steps.map((x, j) => (j === i ? e.target.value : x)))}
                    onBlur={() => !t.trim() && editSteps(steps.filter((_, j) => j !== i))}
                    aria-label={`Subtask ${i + 1}`}
                  />
                  <button type="button" className="composer__stepx" aria-label={`Open ${t}`} disabled={!title} onClick={() => openSub(i)}>
                    <Icon name="chevron-right" className="icon--sm" />
                  </button>
                  <button
                    type="button"
                    className="composer__stepx"
                    aria-label={`Remove ${t}`}
                    onClick={() => {
                      editSteps(steps.filter((_, j) => j !== i));
                    }}
                  >
                    <Icon name="x" className="icon--xs" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="composer__stepadd">
            <Icon name="plus" className="icon--sm" />
            <input
              value={stepText}
              dir="auto"
              onChange={(e) => setStepText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addStep();
                }
              }}
              onBlur={addStep}
              placeholder="Add a subtask"
              aria-label="Add a subtask"
              enterKeyHint="next"
            />
            {stepText.trim() ? (
              <button type="button" className="btn btn--sm composer__stepgo" onMouseDown={(e) => e.preventDefault()} onClick={addStep}>
                Add
              </button>
            ) : null}
          </label>
        </div>
      ) : null}

      <div className="composer__foot">
        <button type="submit" className="btn btn--block composer__add" disabled={!title}>
          Add
        </button>
      </div>
    </form>
  );
}

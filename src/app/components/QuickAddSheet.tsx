import { navigate } from '../router';
import { useAlsoShop } from '../alsoShop';
import { useEffect, useRef, useState } from 'react';
import type { Item } from '../../core/model';
import { suggestFromCatalog } from '../../smart/categorize';
import { splitPasted } from '../../smart/normalize';
import { composerPlaceholder, splitSteps, type AddMode } from '../compose';
import { useHub } from '../context';
import { getPrefs, usePrefs } from '../prefs';
import { shoppingView } from '../views';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { lineVars } from '../ui/primitives';
import { UrgentTag } from '../ui/tags';
import { EChip, InlineEditor, useSummary, type Field } from './editors';
import { listChip, ParsedToken, useCompose } from './QuickAdd';

/**
 * New: the one way to add, from the black + on every screen. You write straight onto the
 * colour card, with every option right under it: the project, subtasks (typed in a list, or in
 * the words: "Pack: towels, hats"), date, repeat, notification, who, who sees it, urgent. It opens pointed at where you
 * are: `listId` (any kind of project), `parentId` (a step of this item), `defaultDue` (a
 * day), else the last project you added to, else To do. Shopping stays open for the next
 * item until Done.
 */
export function QuickAddSheet({
  onClose,
  defaultDue,
  listId,
  parentId,
  route,
  text,
}: {
  onClose: () => void;
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
  const initial =
    (listId && hub.list(listId)) ||
    (last && lists.find((l) => l.id === last)) ||
    lists.find((l) => l.name === 'To do') ||
    lists.find((l) => l.kind === 'tasks') ||
    lists[0];
  return (
    <Sheet onClose={onClose} label="New">
      {initial ? (
        <Composer listId={initial.id} parentId={parentId ?? null} defaultDue={defaultDue} route={route && !!listId} initialText={text} onDone={onClose} />
      ) : (
        <p className="hint">Make a project first. Everything you add lives in one.</p>
      )}
    </Sheet>
  );
}

const GHOST: Record<AddMode, string> = {
  task: 'A new thing',
  chore: 'A new chore',
  shopping: 'Something to buy',
};

/** Every option, right there. */
const FIELDS: Record<AddMode, Field[]> = {
  task: ['when', 'repeat', 'remind', 'who', 'vis', 'urgent'],
  chore: ['repeat', 'who', 'remind', 'vis'],
  shopping: ['urgent', 'vis'],
};

function Composer({
  listId,
  parentId,
  defaultDue,
  route,
  initialText = '',
  onDone,
}: {
  listId: string;
  parentId: string | null;
  defaultDue?: string | null;
  route?: boolean;
  initialText?: string;
  onDone: () => void;
}) {
  const hub = useHub();
  const prefs = usePrefs();
  const { toast } = useOverlays();
  const alsoShop = useAlsoShop();
  const summarize = useSummary();
  const [text, setText] = useState(initialText);
  const [roll] = useState(Math.random);
  const [asStep, setAsStep] = useState(!!parentId);
  const [added, setAdded] = useState<string[]>([]);
  const [own, setOwn] = useState<string[]>([]);
  const [stepText, setStepText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  // "Task: a, b and c" puts its steps in the words (not for shopping, nor for a step itself).
  const words = asStep || hub.list(listId)?.kind === 'shopping' ? { head: text, steps: [] } : splitSteps(text);
  const c = useCompose({
    listId,
    parentId: asStep ? parentId : null,
    defaultDue,
    text: words.head,
    route,
  });
  const { draft, dest, mode, parsed } = c;
  const title = parsed.title.trim();
  const shopping = mode === 'shopping';
  const fields = FIELDS[mode].filter((f) => f !== 'who' || draft.visibility !== 'private');
  const steps = shopping || c.parent ? [] : [...words.steps, ...own];
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

  const clear = () => {
    setText('');
    setOwn([]);
    c.reset();
    field.current?.focus();
  };

  const submit = (raw?: string) => {
    if (raw === undefined && !title) return;
    if (shopping) {
      // Shopping: add and stay for the next one.
      // Not quiet: "already on the list" and "brought back" still say so; a plain add shows in the line below.
      const id = c.commit(raw);
      if (id) setAdded((a) => [...a, (raw ?? title).trim()]);
      clear();
      return;
    }
    if (save(raw)) onDone();
  };

  /** Save the task and its subtasks; returns the new ids (the task, then each subtask). */
  const save = (raw?: string): { id: string; kids: string[] } | null => {
    const id = c.commit(raw === undefined ? undefined : raw, { announce: true });
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

  let sub: string;
  if (shopping) {
    const aisle = title && dest ? hub.aisleMeta(hub.flavorOf(dest), hub.categoryFor({ title, listId: dest.id } as Item).category) : null;
    const qty = parsed.qty ? (/^\d+$/.test(parsed.qty) ? `×${parsed.qty}` : parsed.qty) : '';
    sub = aisle ? [aisle.name, qty].filter(Boolean).join(' · ') : `In ${dest?.name ?? 'your list'}`;
  } else if (c.parent) {
    sub = `A subtask of ${c.parent.title}`;
  } else {
    sub = summarize(draft, { listName: dest?.name });
  }

  // Shopping: what you might mean (the catalog) while typing; buy-again when the card is empty.
  const suggestions: string[] = shopping
    ? title
      ? suggestFromCatalog(title, dest ? hub.flavorOf(dest) : undefined, 4)
          .map((s) => s.label)
          .filter((s) => s.toLowerCase() !== title.toLowerCase())
      : shoppingView(hub, route ? 'all' : (dest?.id ?? listId), prefs.dismissed)
          .buyAgain.slice(0, 5)
          .map((s) => s.name)
    : [];

  const extras = c.parent ? [] : [listChip(c, hub.lists())];

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
            placeholder={c.parent ? 'A subtask' : composerPlaceholder(mode, hub.partner()?.name, roll) || GHOST[mode]}
            aria-label={shopping ? 'What do you need?' : c.parent ? 'A subtask' : 'What needs doing?'}
            enterKeyHint={shopping ? 'enter' : 'done'}
            autoComplete="off"
            data-autofocus=""
          />
          {draft.urgent ? (
            <span className="ccard__badge">
              <UrgentTag />
            </span>
          ) : draft.repeat && !shopping ? (
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
        repeatFrom={mode === 'chore' ? 'done' : 'schedule'}
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

      {!shopping && !c.parent ? (
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

      {shopping && added.length ? (
        <p className="composer__added" aria-live="polite">
          <Icon name="check" className="icon--sm" /> <span dir="auto">{added.slice(-4).join(', ')}</span>
        </p>
      ) : null}

      <div className="composer__foot">
        {shopping ? (
          <>
            <button type="button" className="btn btn--quiet composer__done" onClick={onDone}>
              Done
            </button>
            <button type="submit" className="btn composer__add" disabled={!title}>
              Add
            </button>
          </>
        ) : (
          <button type="submit" className="btn btn--block composer__add" disabled={!title}>
            Add
          </button>
        )}
      </div>
    </form>
  );
}

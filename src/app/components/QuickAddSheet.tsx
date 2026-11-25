import { useEffect, useRef, useState } from 'react';
import type { Item } from '../../core/model';
import { categoryMeta, suggestFromCatalog } from '../../smart/categorize';
import { splitPasted } from '../../smart/normalize';
import { composerPlaceholder, type AddMode } from '../compose';
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
 * colour card. It opens compact (the card and the two or three chips that matter here) and
 * "More" opens every option without losing what you typed. It opens pointed at where you
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

/** Every option, when expanded. */
const FULL: Record<AddMode, Field[]> = {
  task: ['when', 'repeat', 'remind', 'who', 'vis', 'urgent'],
  chore: ['repeat', 'who', 'remind', 'vis'],
  shopping: ['urgent', 'vis'],
};

/** The few that matter here, compact. */
const COMPACT: Record<AddMode, Field[]> = {
  task: ['when', 'remind'],
  chore: ['repeat', 'who'],
  shopping: ['urgent'],
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
  const summarize = useSummary();
  const [text, setText] = useState(initialText);
  const [roll] = useState(Math.random);
  const [full, setFull] = useState(false);
  const [asStep, setAsStep] = useState(!!parentId);
  const [added, setAdded] = useState<string[]>([]);
  const field = useRef<HTMLTextAreaElement>(null);
  const c = useCompose({
    listId,
    parentId: asStep ? parentId : null,
    defaultDue,
    text,
    route,
  });
  const { draft, dest, mode, parsed } = c;
  const title = parsed.title.trim();
  const shopping = mode === 'shopping';
  const fields = (full ? FULL : COMPACT)[mode].filter((f) => f !== 'who' || draft.visibility !== 'private');
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
    if (c.commit(raw, { announce: true })) onDone();
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
    const aisle = title && dest ? categoryMeta(hub.flavorOf(dest), hub.categoryFor({ title, listId: dest.id } as Item).category) : null;
    const qty = parsed.qty ? (/^\d+$/.test(parsed.qty) ? `×${parsed.qty}` : parsed.qty) : '';
    sub = aisle ? [aisle.en, qty].filter(Boolean).join(' · ') : `In ${dest?.name ?? 'your list'}`;
  } else if (c.parent) {
    sub = `A step of ${c.parent.title}`;
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

  const extras = !c.parent && full ? [listChip(c, hub.lists())] : [];

  return (
    <form
      className={`composer ${full ? 'is-full' : 'is-compact'}`}
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
            placeholder={c.parent ? 'A step' : composerPlaceholder(mode, hub.partner()?.name, roll) || GHOST[mode]}
            aria-label={shopping ? 'What do you need?' : c.parent ? 'A step' : 'What needs doing?'}
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
                label={asStep ? 'A step' : 'Its own task'}
                set={asStep}
                open={false}
                onToggle={() => setAsStep(!asStep)}
              />
            ) : null}
            {!full ? <EChip icon="sliders" label="More" set={false} open={false} onToggle={() => setFull(true)} /> : null}
          </>
        }
      />

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

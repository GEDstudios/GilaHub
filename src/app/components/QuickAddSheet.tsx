import { useState } from 'react';
import type { Item } from '../../core/model';
import { categoryMeta } from '../../smart/categorize';
import { splitPasted } from '../../smart/normalize';
import { composerPlaceholder, type AddMode } from '../compose';
import { useHub } from '../context';
import { getPrefs } from '../prefs';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { ColorCard } from '../ui/primitives';
import { UrgentTag } from '../ui/tags';
import { InlineEditor, useSummary, type Field } from './editors';
import { listChip, ParsedToken, useCompose } from './QuickAdd';

/**
 * New: one forgiving sentence, a live card of what you're adding, and "Want to modify
 * something?" chips (Tasky ref 13). It opens pointed at where you are: `listId` (any kind
 * of project, shopping included), else the last project you added to, else To do.
 */
export function QuickAddSheet({
  onClose,
  defaultDue,
  listId,
  route,
}: {
  onClose: () => void;
  defaultDue?: string | null;
  listId?: string;
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
    <Sheet onClose={onClose} title="New">
      {initial ? (
        <Composer listId={initial.id} defaultDue={defaultDue} route={route && !!listId} onDone={onClose} />
      ) : (
        <p className="hint">Make a project first. Everything you add lives in one.</p>
      )}
    </Sheet>
  );
}

const GHOST: Record<AddMode, string> = { task: 'A new thing', chore: 'A new chore', shopping: 'Something to buy' };

const FIELDS: Record<AddMode, Field[]> = {
  task: ['when', 'repeat', 'remind', 'who', 'vis', 'urgent'],
  chore: ['repeat', 'who', 'vis'],
  shopping: ['urgent', 'vis'],
};

function Composer({ listId, defaultDue, route, onDone }: { listId: string; defaultDue?: string | null; route?: boolean; onDone: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const summarize = useSummary();
  const [text, setText] = useState('');
  const [roll] = useState(Math.random);
  const c = useCompose({ listId, defaultDue, text, route });
  const { draft, dest, mode, parsed } = c;
  const title = parsed.title.trim();
  const fields = FIELDS[mode].filter((f) => f !== 'who' || draft.visibility !== 'private');

  const submit = () => {
    if (!title) return;
    if (c.commit(undefined, { announce: true })) onDone();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
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
  if (mode === 'shopping') {
    const aisle = title && dest ? categoryMeta(hub.flavorOf(dest), hub.categoryFor({ title, listId: dest.id } as Item).category) : null;
    const qty = parsed.qty ? (/^\d+$/.test(parsed.qty) ? `×${parsed.qty}` : parsed.qty) : '';
    sub = aisle ? [aisle.en, qty].filter(Boolean).join(' · ') : `In ${dest?.name ?? 'your list'}`;
  } else {
    sub = summarize(draft, { listName: dest?.name });
  }

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="composer__ask">
        <span className="composer__label">
          <Icon name="sparkle" className="icon--sm" /> {mode === 'shopping' ? 'What do you need?' : 'What needs doing?'}
        </span>
        <input
          value={text}
          dir="auto"
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value) c.reset();
          }}
          onPaste={onPaste}
          placeholder={composerPlaceholder(mode, hub.partner()?.name, roll)}
          aria-label={mode === 'shopping' ? 'What do you need?' : 'What needs doing?'}
          enterKeyHint="done"
          autoComplete="off"
          autoFocus
          data-autofocus=""
        />
      </label>
      {parsed.tokens.length ? (
        <div className="tokens composer__tokens">
          {parsed.tokens.map((t) => (
            <ParsedToken key={t.key} label={t.label} onKeep={() => c.keepAsText(t.key)} />
          ))}
        </div>
      ) : null}
      <ColorCard
        color={dest?.color}
        className={title ? '' : 'ccard--ghost'}
        title={title || GHOST[mode]}
        badge={draft.urgent ? <UrgentTag /> : draft.repeat && mode !== 'shopping' ? <Icon name="repeat" className="icon--sm" /> : undefined}
        sub={sub}
      />
      <InlineEditor
        prompt="Want to modify something?"
        whoMode="compose"
        value={draft}
        onChange={c.change}
        fields={fields}
        allowedVis={c.allowed}
        repeatFrom={mode === 'chore' ? 'done' : 'schedule'}
        extras={[listChip(c, hub.lists())]}
      />
      <button type="submit" className="btn btn--block composer__add" disabled={!title}>
        Add
      </button>
    </form>
  );
}

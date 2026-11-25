import { useMemo, useRef, useState } from 'react';
import type { ItemVisibility } from '../../core/actions';
import { humanDate, today as todayStr } from '../../core/dates';
import type { List } from '../../core/model';
import { splitPasted } from '../../smart/normalize';
import { parseQuickAdd, type ParseContext } from '../../smart/parse';
import { useHub } from '../context';
import { dayFirst, setPrefs, use24h, usePrefs, weekStart, workdays } from '../prefs';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { ListBullet } from '../ui/primitives';
import { ListPickerSheet } from './pickers';

export function useParseContext(list: List | undefined): ParseContext {
  const hub = useHub();
  const prefs = usePrefs();
  return {
    members: hub.members().map((m) => ({ id: m.id, name: m.name })),
    meId: hub.meId,
    lists: hub.lists().map((l) => ({ id: l.id, name: l.name })),
    dayFirst: dayFirst(),
    weekStart: weekStart(prefs),
    workdays: workdays(),
    h24: use24h(prefs),
    mode: list?.kind === 'shopping' ? 'shopping' : 'task',
    repeatFrom: list?.kind === 'chores' ? 'done' : 'schedule',
  };
}

const VIS_LABEL: Record<ItemVisibility, string> = { ours: 'Ours', mine: 'Mine', private: 'Only me' };
const VIS_ICON = { ours: 'ours', mine: 'mine', private: 'lock' } as const;

export function QuickAdd({
  listId,
  parentId = null,
  defaultDue,
  placeholder,
  onAdded,
  allowListChange,
  autoFocus,
}: {
  listId: string;
  parentId?: string | null;
  defaultDue?: string | null;
  placeholder?: string;
  onAdded?: (id: string) => void;
  allowListChange?: boolean;
  autoFocus?: boolean;
}) {
  const hub = useHub();
  const { openSheet, toast } = useOverlays();
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(listId);
  const [dropDefaultDue, setDropDefaultDue] = useState(false);
  const list = hub.list(target) ?? hub.list(listId);
  const parent = hub.item(parentId);
  const ctx = useParseContext(list);
  const input = useRef<HTMLInputElement>(null);
  const hintText = placeholder ?? (parent ? 'Add a step' : `Add to ${list?.name ?? 'list'}`);

  const allowed: ItemVisibility[] =
    list?.visibility === 'private' ? ['private'] : list?.visibility === 'visible' ? ['mine', 'private'] : ['ours', 'mine', 'private'];
  const inherited: ItemVisibility = parent ? hub.visibilityOf(parent) : allowed[0];
  const [vis, setVis] = useState<ItemVisibility | null>(null);
  const visibility = vis && allowed.includes(vis) ? vis : allowed.includes(inherited) ? inherited : allowed[0];

  const parsed = useMemo(() => parseQuickAdd(text, { ...ctx, ignore }), [text, ctx, ignore]);
  const listToken = parsed.listId ? hub.list(parsed.listId) : undefined;
  const dest = listToken && !parent ? listToken : list;
  const add = (raw?: string) => {
    if (!dest) return;
    const p = raw === undefined ? parsed : parseQuickAdd(raw, { ...ctx, ignore });
    const title = p.title.trim();
    if (!title) return;
    const id = hub.addItem(dest.id, {
      title,
      parentId: dest.id === listId ? parentId : null,
      due: p.due ?? (dropDefaultDue ? null : (defaultDue ?? null)),
      dueTime: p.dueTime ?? null,
      repeat: p.repeat ?? null,
      assignee: p.assignee ?? null,
      urgent: p.urgent ?? false,
      qty: p.qty ?? null,
      visibility,
    });
    setPrefs({ lastList: dest.id });
    onAdded?.(id);
    return id;
  };

  const submit = () => {
    if (!add()) return;
    setText('');
    setIgnore(new Set());
    input.current?.focus();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const raw = e.clipboardData.getData('text');
    const lines = splitPasted(raw);
    if (lines.length < 2) return;
    e.preventDefault();
    hub.store.batch(() => {
      for (const l of lines) add(l);
    });
    toast(`Added ${lines.length} items`);
  };

  const cycleVis = () => {
    const i = allowed.indexOf(visibility);
    setVis(allowed[(i + 1) % allowed.length]);
  };

  const chips = parsed.tokens.map((t) => ({ key: t.key, label: t.label, kind: t.kind }));
  const showDefaultDue = !parsed.due && defaultDue && !dropDefaultDue;

  return (
    <div className="quickadd">
      <form
        className="addbar"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Icon name="plus" className="icon--sm" style={{ color: 'var(--text-3)' }} />
        <input
          ref={input}
          value={text}
          dir="auto"
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          placeholder={hintText}
          aria-label={hintText}
          enterKeyHint="done"
          autoFocus={autoFocus}
          data-autofocus={autoFocus ? '' : undefined}
        />
        <button type="submit" className="addbar__go" disabled={!parsed.title.trim()} aria-label="Add">
          <Icon name="arrow" className="icon--sm" />
        </button>
      </form>
      {text.trim() || allowListChange ? (
        <div className="chips chips--scroll" style={{ margin: '10px 0 0', padding: '0 var(--gutter)' }}>
          {allowListChange && dest ? (
            <button
              type="button"
              className="chip chip--outline"
              onClick={() =>
                openSheet((close) => (
                  <ListPickerSheet
                    onClose={close}
                    current={dest.id}
                    filter={(l) => l.kind !== 'shopping'}
                    onPick={(l) => {
                      setTarget(l.id);
                      setVis(null);
                    }}
                  />
                ))
              }
            >
              <ListBullet list={dest} size="xs" />
              <span dir="auto">{dest.name}</span>
              <Icon name="chevron-down" />
            </button>
          ) : null}
          {showDefaultDue ? (
            <button type="button" className="chip chip--token" onClick={() => setDropDefaultDue(true)} title="Remove date">
              <Icon name="calendar" />
              {humanDate(defaultDue!, todayStr())}
              <Icon name="x" className="x" />
            </button>
          ) : null}
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              className="chip chip--token"
              onClick={() => setIgnore((s) => new Set([...s, c.key]))}
              title="Tap to keep this as text"
            >
              <Icon name={c.kind === 'date' ? 'calendar' : c.kind === 'time' ? 'clock' : c.kind === 'repeat' ? 'repeat' : c.kind === 'assignee' ? 'user' : c.kind === 'list' ? 'lines' : c.kind === 'qty' ? 'tag' : 'bell'} />
              {c.label}
              <Icon name="x" className="x" />
            </button>
          ))}
          {allowed.length > 1 && text.trim() ? (
            <button type="button" className="chip chip--outline" onClick={cycleVis} title="Who can see this">
              <Icon name={VIS_ICON[visibility]} />
              {VIS_LABEL[visibility]}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

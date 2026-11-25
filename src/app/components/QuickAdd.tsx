import { useMemo, useRef, useState } from 'react';
import { humanDate, today as todayStr } from '../../core/dates';
import type { List } from '../../core/model';
import { splitPasted } from '../../smart/normalize';
import { parseQuickAdd, type ParseContext } from '../../smart/parse';
import { useHub, useRt } from '../context';
import { dayFirst, setPrefs, use24h, usePrefs, weekStart, workdays } from '../prefs';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { ColorCard, ListBullet } from '../ui/primitives';
import { allowedVis, itemVisChoice, visFields, visLabel, VIS_ICON, type VisChoice } from '../privacy';
import { useSummary } from './editors';
import { notifyAbout } from '../notify';
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

export function QuickAdd({
  listId,
  parentId = null,
  defaultDue,
  placeholder,
  onAdded,
  allowListChange,
  autoFocus,
  composer,
}: {
  listId: string;
  parentId?: string | null;
  defaultDue?: string | null;
  placeholder?: string;
  onAdded?: (id: string) => void;
  allowListChange?: boolean;
  autoFocus?: boolean;
  /** The big "New" composer: a live preview card and an Add button. */
  composer?: boolean;
}) {
  const hub = useHub();
  const rt = useRt();
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

  const partner = hub.partner();
  const allowed = allowedVis(hub, list, parent);
  const inherited: VisChoice = parent ? itemVisChoice(hub, parent) : allowed[0];
  const [vis, setVis] = useState<VisChoice | null>(null);
  const [needsOk, setNeedsOk] = useState(false);
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
      ...visFields(hub, visibility),
      needsOk: needsOk && hub.isRequest(p.assignee),
    });
    const made = hub.item(id);
    if (made && made.requestedBy === hub.meId && p.assignee) {
      notifyAbout(rt, hub, made, p.assignee, `${hub.me()?.name ?? 'Your partner'} asked you`, made.title);
    }
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
  const summarize = useSummary();

  if (composer) {
    const due = parsed.due ?? (dropDefaultDue ? null : (defaultDue ?? null));
    const title = parsed.title.trim();
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
            <Icon name="sparkle" className="icon--sm" /> What needs doing?
          </span>
          <input
            ref={input}
            value={text}
            dir="auto"
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            placeholder="Call mom tomorrow 6pm"
            aria-label="What needs doing?"
            enterKeyHint="done"
            autoFocus={autoFocus}
            data-autofocus={autoFocus ? '' : undefined}
          />
        </label>
        <ColorCard
          color={dest?.color}
          className={title ? '' : 'ccard--ghost'}
          title={title || 'A new thing'}
          badge={parsed.repeat ? <Icon name="repeat" className="icon--sm" /> : parsed.urgent ? '!' : undefined}
          sub={summarize({ due, dueTime: parsed.dueTime ?? null, repeat: parsed.repeat ?? null, assignee: parsed.assignee ?? null }, { listName: dest?.name })}
        />
        <div className="tokens">
          {allowListChange && dest ? (
            <button
              type="button"
              className="token token--list"
              onClick={() =>
                openSheet((close) => (
                  <ListPickerSheet
                    onClose={close}
                    title="Add to"
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
            <button type="button" className="token" onClick={() => setDropDefaultDue(true)} title="Remove date">
              {humanDate(defaultDue!, todayStr())}
              <Icon name="x" className="token__x" />
            </button>
          ) : null}
          {chips.map((c) => (
            <button key={c.key} type="button" className="token is-parsed" onClick={() => setIgnore((s) => new Set([...s, c.key]))} title="Tap to keep this as text">
              {c.label}
              <Icon name="x" className="token__x" />
            </button>
          ))}
          {allowed.length > 1 ? (
            <button type="button" className="token" onClick={cycleVis} title="Who can see this">
              <Icon name={VIS_ICON[visibility]} />
              {visLabel(visibility, partner?.name)}
            </button>
          ) : null}
          {partner && parsed.assignee === partner.id && !parsed.repeat ? (
            <button type="button" className={`token ${needsOk ? 'is-parsed' : ''}`} onClick={() => setNeedsOk(!needsOk)} aria-pressed={needsOk}>
              <Icon name="check" />
              Needs my OK
            </button>
          ) : null}
        </div>
        <button type="submit" className="btn btn--block composer__add" disabled={!title}>
          Add
        </button>
      </form>
    );
  }

  return (
    <div className={`quickadd ${text.trim() ? 'is-typing' : ''}`}>
      <form
        className="addrow"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="addrow__plus" aria-hidden="true">
          <Icon name="plus" className="icon--sm" />
        </span>
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
        {parsed.title.trim() ? (
          <button type="submit" className="addrow__go" aria-label="Add">
            <Icon name="arrow" className="icon--sm" />
          </button>
        ) : null}
      </form>
      {text.trim() ? (
        <div className="tokens">
          {allowListChange && dest ? (
            <button
              type="button"
              className="token token--list"
              onClick={() =>
                openSheet((close) => (
                  <ListPickerSheet
                    onClose={close}
                    title="Add to"
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
            <button type="button" className="token" onClick={() => setDropDefaultDue(true)} title="Remove date">
              {humanDate(defaultDue!, todayStr())}
              <Icon name="x" className="token__x" />
            </button>
          ) : null}
          {chips.map((c) => (
            <button key={c.key} type="button" className="token is-parsed" onClick={() => setIgnore((s) => new Set([...s, c.key]))} title="Tap to keep this as text">
              {c.label}
              <Icon name="x" className="token__x" />
            </button>
          ))}
          {allowed.length > 1 && text.trim() ? (
            <button type="button" className="token" onClick={cycleVis} title="Who can see this">
              <Icon name={VIS_ICON[visibility]} />
              {visLabel(visibility, partner?.name)}
            </button>
          ) : null}
          {partner && parsed.assignee === partner.id && !parsed.repeat ? (
            <button type="button" className={`token ${needsOk ? 'is-parsed' : ''}`} onClick={() => setNeedsOk(!needsOk)} aria-pressed={needsOk}>
              <Icon name="check" />
              Needs my OK
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

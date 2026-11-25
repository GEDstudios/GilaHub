import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { humanDate, today as todayStr } from '../../core/dates';
import type { List } from '../../core/model';
import { splitPasted } from '../../smart/normalize';
import { parseQuickAdd, type ParseContext, type ParseResult } from '../../smart/parse';
import { composeDraft, modeOf, overriddenTokens, parsedDraft, addRowPlaceholder, type AddMode } from '../compose';
import { useHub, useRt } from '../context';
import { notifyAbout, setUpReminders } from '../notify';
import { dayFirst, setPrefs, use24h, usePrefs, weekStart, workdays } from '../prefs';
import { allowedVis, itemVisChoice, visFields, type VisChoice } from '../privacy';
import { ifNotInView, markFresh } from '../ui/fresh';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { ListBullet } from '../ui/primitives';
import { InlineEditor, Options, type Draft, type Field } from './editors';
import { useShopAdd } from './shopAdd';

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

/**
 * The state behind every add, in place or in the New sheet: the words, what they parse
 * to, the chips that override them, and where it goes. Mode follows the project's kind.
 */
export function useCompose({
  listId,
  parentId = null,
  defaultDue,
  text,
  route,
}: {
  listId: string;
  parentId?: string | null;
  defaultDue?: string | null;
  text: string;
  /** From the combined Shopping tab: send each item to the list it belongs on ("bulbs" → Home), until a list is picked. */
  route?: boolean;
}) {
  const hub = useHub();
  const rt = useRt();
  const { toast } = useOverlays();
  const shopAdd = useShopAdd();
  const [ignore, setIgnore] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<Partial<Draft>>({});
  const [target, setTarget] = useState<string | null>(null);
  const base = (target ? hub.list(target) : undefined) ?? hub.list(listId);
  const parent = hub.item(parentId);
  const ctx = useParseContext(base);
  const parse = (raw: string) => parseQuickAdd(raw, { ...ctx, ignore });
  const parsed = useMemo(() => parseQuickAdd(text, { ...ctx, ignore }), [text, ctx, ignore]);
  const routed = (p: ParseResult) =>
    route && !target && base?.kind === 'shopping' && p.title.trim() ? hub.routeShopping(p.title, hub.shoppingLists()) : undefined;
  const destOf = (p: ParseResult) => (p.listId && !parent ? hub.list(p.listId) : undefined) ?? routed(p) ?? base;
  const dest = destOf(parsed);
  const mode: AddMode = parent ? 'task' : modeOf(dest?.kind);
  const allowed = allowedVis(hub, dest, parent);
  const inherited: VisChoice = parent ? itemVisChoice(hub, parent) : allowed[0];
  const defVis = allowed.includes(inherited) ? inherited : allowed[0];
  const draftOf = (p: ParseResult) => composeDraft(parsedDraft(p, { mode, defaultDue, visibility: defVis }), over, allowed);
  const draft = draftOf(parsed);

  /** A chip changed: it wins over the words, which go back to being plain text. */
  const change = (patch: Partial<Draft>) => {
    const keys = overriddenTokens(parsed, draft, patch);
    if (keys.length) setIgnore((s) => new Set([...s, ...keys]));
    setOver((o) => ({ ...o, ...patch }));
    if (patch.remind !== null && patch.remind !== undefined) setUpReminders(rt, toast);
  };

  const pickList = (id: string) => {
    const keys = parsed.tokens.filter((t) => t.kind === 'list').map((t) => t.key);
    if (keys.length) setIgnore((s) => new Set([...s, ...keys]));
    setTarget(id);
  };

  /** Tap a parsed token: keep those words as text. */
  const keepAsText = (key: string) => setIgnore((s) => new Set([...s, key]));

  /** After an add: a clean slate, but the project and who-sees-it stay as chosen. */
  const reset = () => {
    setIgnore(new Set());
    setOver((o) => (o.visibility ? { visibility: o.visibility } : {}));
  };

  /** Add it. `raw` adds other words with the same chips (a pasted line). Returns the new id. */
  const commit = (raw?: string, opts: { quiet?: boolean; announce?: boolean } = {}): string | undefined => {
    const p = raw === undefined ? parsed : parse(raw);
    const to = destOf(p);
    const d = raw === undefined ? draft : draftOf(p);
    const title = p.title.trim();
    if (!to || !title) return undefined;
    if (modeOf(to.kind) === 'shopping' && !parent) {
      return shopAdd(to.id, { title, qty: p.qty ?? null, urgent: d.urgent, vis: d.visibility }, opts)?.id;
    }
    const asking = hub.isRequest(d.assignee);
    const id = hub.addItem(to.id, {
      title,
      parentId: to.id === listId ? parentId : null,
      due: d.due,
      dueTime: d.dueTime,
      repeat: d.repeat,
      remind: d.remind,
      assignee: d.assignee,
      urgent: d.urgent,
      ...visFields(hub, d.visibility),
      needsOk: !!d.needsOk && asking && !d.repeat,
    });
    const made = hub.item(id);
    if (made && asking && made.requestedBy === hub.meId) {
      notifyAbout(rt, hub, made, d.assignee as string, `${hub.me()?.name ?? 'Your partner'} asked you`, made.title);
    }
    // New (from Today, Search…) opens on the last task project used.
    if (!parent && to.kind === 'tasks') setPrefs({ lastList: to.id });
    markFresh(id, { scroll: opts.announce });
    if (opts.announce) toast(`Added to ${to.name}`, { ms: 1800 });
    else if (!opts.quiet) ifNotInView(id, () => toast(`Added to ${to.name}`, { ms: 1800 }));
    return id;
  };

  return { parsed, draft, draftOf, dest, base, parent, mode, allowed, over, change, pickList, keepAsText, reset, commit, parse };
}

export type Compose = ReturnType<typeof useCompose>;

/** The List chip: the project's bullet and name; its panel lists the projects to pick from. */
export function listChip(c: Compose, lists: List[]) {
  const dest = c.dest;
  return {
    key: 'list',
    label: dest?.name ?? 'List',
    lead: <ListBullet list={dest} size="xs" />,
    panel: (close: () => void) => (
      <Options
        value={dest?.id ?? null}
        options={lists.map((l) => ({
          value: l.id,
          label: (
            <>
              <ListBullet list={l} size="xs" />
              <span dir="auto">{l.name}</span>
            </>
          ),
        }))}
        onPick={(id) => {
          c.pickList(id);
          close();
        }}
      />
    ),
  };
}

/** What a parsed word became, as a token: tap to keep it as text. */
export function ParsedToken({ label, onKeep }: { label: string; onKeep: () => void }) {
  return (
    <button type="button" className="token is-parsed" onClick={onKeep} title="Tap to keep this as text">
      <span dir="auto">{label}</span>
      <Icon name="x" className="token__x" />
    </button>
  );
}

export interface AddRowHandle {
  /** Add these words with the row's current chips (a suggestion tapped under the row). */
  submit: (raw: string) => void;
}

/**
 * The in-place add, the same everywhere: a dashed plus, the input, and a black arrow once
 * there's something to add. On focus a row of chips opens under it: who sees it (always),
 * and for chores how often and who. What the words say shows up as tokens as you type.
 */
export function AddRow({
  listId,
  parentId = null,
  defaultDue,
  placeholder,
  onAdded,
  allowListChange,
  text: textProp,
  onText,
  onSubmit,
  handle,
  autoFocus,
  route,
}: {
  listId: string;
  parentId?: string | null;
  defaultDue?: string | null;
  placeholder?: string;
  onAdded?: (id: string) => void;
  /** Today's row: a List chip to send it to another project. */
  allowListChange?: boolean;
  /** Controlled text (Shopping filters the list as you type). */
  text?: string;
  onText?: (text: string) => void;
  /** Shopping decides where an item goes: it gets what the words say and the chips. */
  onSubmit?: (parsed: ParseResult, chips: Draft, opts: { quiet?: boolean }) => void;
  handle?: Ref<AddRowHandle>;
  autoFocus?: boolean;
  /** Shopping across lists: each item goes to the list it belongs on ("bulbs" → Home). */
  route?: boolean;
}) {
  const hub = useHub();
  const { toast } = useOverlays();
  const [own, setOwn] = useState('');
  const text = textProp ?? own;
  const c = useCompose({ listId, parentId, defaultDue, text, route });
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  // The chips fold a moment after focus leaves, so a tap elsewhere lands before the page shifts.
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(blurTimer.current), []);
  const hint = placeholder ?? addRowPlaceholder(c.mode, c.dest?.name, !!c.parent);

  const setText = (t: string) => {
    if (onText) onText(t);
    else setOwn(t);
    if (!t) c.reset();
  };

  const add = (raw?: string, opts: { quiet?: boolean } = {}) => {
    if (onSubmit) {
      const p = raw === undefined ? c.parsed : c.parse(raw);
      if (p.title.trim()) onSubmit(p, raw === undefined ? c.draft : c.draftOf(p), opts);
      return;
    }
    const id = c.commit(raw, opts);
    if (id) onAdded?.(id);
  };

  const submit = (raw?: string) => {
    if (raw === undefined && !c.parsed.title.trim()) return;
    add(raw);
    setText('');
    c.reset();
    input.current?.focus();
  };

  useImperativeHandle(handle, () => ({ submit: (raw: string) => submit(raw) }));

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const lines = splitPasted(e.clipboardData.getData('text'));
    if (lines.length < 2) return;
    e.preventDefault();
    hub.store.batch(() => {
      for (const l of lines) add(l, { quiet: true });
    });
    toast(`Added ${lines.length} items${c.mode === 'shopping' ? ', sorted into aisles' : ''}`);
  };

  // The chips: who sees it, always; for chores how often and who; who, once someone is named.
  const fields: Field[] =
    c.mode === 'chore' ? ['repeat', 'who', 'vis'] : c.mode === 'task' && c.draft.assignee ? ['who', 'vis'] : ['vis'];
  const shown = fields.filter((f) => (f !== 'who' || c.draft.visibility !== 'private') && (f !== 'vis' || c.allowed.length > 1));
  // A word a chip already shows isn't repeated as a token.
  const chipKinds = new Set([...(shown.includes('repeat') ? ['repeat'] : []), ...(shown.includes('who') ? ['assignee'] : [])]);
  const tokens = c.parsed.tokens.filter((t) => !chipKinds.has(t.kind));
  const showDefaultDue = !!defaultDue && !c.parsed.due && !('due' in c.over);
  const listChange = allowListChange && !c.parent;
  const open = (focused || !!text.trim()) && (shown.length > 0 || tokens.length > 0 || showDefaultDue || !!listChange);

  return (
    <div
      className={`quickadd ${open ? 'is-open' : ''}`}
      onFocus={() => {
        clearTimeout(blurTimer.current);
        setFocused(true);
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        clearTimeout(blurTimer.current);
        blurTimer.current = setTimeout(() => setFocused(false), 240);
      }}
    >
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
          placeholder={hint}
          aria-label={hint}
          enterKeyHint="done"
          autoComplete="off"
          autoFocus={autoFocus}
        />
        {c.parsed.title.trim() ? (
          <button type="submit" className="addrow__go" aria-label="Add">
            <Icon name="arrow" className="icon--sm" />
          </button>
        ) : null}
      </form>
      {open ? (
        // Tapping a chip keeps the keyboard up: focus stays in the input.
        <div onMouseDown={keepFocus} onPointerDown={keepFocus}>
          <InlineEditor
            className="addrow__chips"
            compact
            whoMode="compose"
            value={c.draft}
            onChange={c.change}
            fields={shown}
            allowedVis={c.allowed}
            repeatFrom={c.mode === 'chore' ? 'done' : 'schedule'}
            extras={listChange ? [listChip(c, hub.lists().filter((l) => l.kind !== 'shopping'))] : []}
            after={
              <>
                {showDefaultDue ? (
                  <button type="button" className="token" onClick={() => c.change({ due: null, dueTime: null })} title="No date">
                    {humanDate(defaultDue, todayStr())}
                    <Icon name="x" className="token__x" />
                  </button>
                ) : null}
                {tokens.map((t) => (
                  <ParsedToken key={t.key} label={t.label} onKeep={() => c.keepAsText(t.key)} />
                ))}
              </>
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function keepFocus(e: React.MouseEvent | React.PointerEvent) {
  if (!(e.target as HTMLElement).closest('input, textarea')) e.preventDefault();
}

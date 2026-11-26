import { playSound } from '../ui/sounds';
import { useMemo, useState, type ReactNode } from 'react';
import type { List } from '../../core/model';
import { parseQuickAdd, type ParseContext, type ParseResult } from '../../smart/parse';
import { composeDraft, modeOf, overriddenTokens, parsedDraft, type AddMode } from '../compose';
import { useHub, useRt } from '../context';
import { notifyAbout, setUpReminders } from '../notify';
import { dayFirst, setPrefs, use24h, usePrefs, weekStart, workdays } from '../prefs';
import { allowedVis, itemVisChoice, visFields, type VisChoice } from '../privacy';
import { ifNotInView, markFresh } from '../ui/fresh';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { ListBullet } from '../ui/primitives';
import { type Draft } from './editors';
import { TagMark, TagPicker, tagsLabel } from './Tags';
import type { Hub } from '../../core/actions';
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
    mode: hub.isShop(list) ? 'shopping' : 'task',
    repeatFrom: 'schedule',
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
  // Where it goes, once picked: a project, or a task in one (then it's a subtask of that task).
  const [place, setPlace] = useState<{ listId: string; parentId: string | null } | null>(null);
  // Its tags, once picked; until then, what the words suggest by themselves (Hub.suggestTags).
  const [picked, setTags] = useState<string[] | null>(null);
  const target = place?.listId ?? null;
  const base = (target ? hub.list(target) : undefined) ?? hub.list(listId);
  const parentPick = place ? place.parentId : parentId;
  const parent = hub.item(parentPick);
  const ctx = useParseContext(base);
  const parse = (raw: string) => parseQuickAdd(raw, { ...ctx, ignore });
  const parsed = useMemo(() => parseQuickAdd(text, { ...ctx, ignore }), [text, ctx, ignore]);
  const routed = (p: ParseResult) =>
    route && !target && hub.isShop(base) && p.title.trim() ? hub.routeShopping(p.title, hub.shoppingLists().filter((l) => l.flavor)) : undefined;
  const destOf = (p: ParseResult) => (p.listId && !parent ? hub.list(p.listId) : undefined) ?? routed(p) ?? base;
  const dest = destOf(parsed);
  const mode: AddMode = parent ? 'task' : modeOf(hub.isShop(dest));
  const suggested = useMemo(() => (parsed.title.trim() ? hub.suggestTags(parsed.title, dest?.id) : { auto: [], more: [] }), [hub, parsed.title, dest?.id]);
  const tags = picked ?? suggested.auto;
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

  const pickList = (id: string, under: string | null = null) => {
    const keys = parsed.tokens.filter((t) => t.kind === 'list').map((t) => t.key);
    if (keys.length) setIgnore((s) => new Set([...s, ...keys]));
    setPlace({ listId: id, parentId: under });
  };

  /** Tap a parsed token: keep those words as text. */
  const keepAsText = (key: string) => setIgnore((s) => new Set([...s, key]));

  /** After an add: a clean slate, but the project and who-sees-it stay as chosen. */
  const reset = () => {
    setIgnore(new Set());
    setTags(null);
    setOver((o) => (o.visibility ? { visibility: o.visibility } : {}));
  };

  /** Add it. `raw` adds other words with the same chips (a pasted line). Returns the new id. */
  const commit = (raw?: string, opts: { quiet?: boolean; announce?: boolean } = {}): string | undefined => {
    const p = raw === undefined ? parsed : parse(raw);
    const to = destOf(p);
    const d = raw === undefined ? draft : draftOf(p);
    const title = p.title.trim();
    if (!to || !title) return undefined;
    // Picked tags go on this one; other words (a pasted line, a suggestion) find their own.
    const ownTags = raw === undefined && picked ? picked : undefined;
    if (hub.isShop(to) && !parent) {
      return shopAdd(to.id, { title, qty: p.qty ?? null, urgent: d.urgent, vis: d.visibility, tags: ownTags }, opts)?.id;
    }
    const asking = hub.isRequest(d.assignee);
    const id = hub.addItem(to.id, {
      title,
      parentId: to.id === (base?.id ?? listId) ? parentPick : null,
      due: d.due,
      dueTime: d.dueTime,
      repeat: d.repeat,
      remind: d.remind,
      nag: d.nag ?? null,
      assignee: d.assignee,
      urgent: d.urgent,
      ...visFields(hub, d.visibility),
      needsOk: !!d.needsOk && asking && !d.repeat,
      tags: ownTags,
    });
    // A dated task notifies by default: ask for permission the first time (in this tap).
    if (d.remind != null && typeof Notification !== 'undefined' && Notification.permission === 'default') setUpReminders(rt, toast);
    const made = hub.item(id);
    if (made && asking && made.requestedBy === hub.meId) {
      notifyAbout(rt, hub, made, d.assignee as string, `🙋 ${hub.me()?.name ?? 'Your partner'} asked you`, made.title);
    }
    // New (from Today, Search…) opens on the last task project used.
    if (!parent && !hub.isShop(to)) setPrefs({ lastList: to.id });
    markFresh(id, { scroll: opts.announce });
    if (!opts.quiet) playSound('add');
    if (opts.announce) toast(`Added to ${to.name}`, { ms: 1800 });
    else if (!opts.quiet) ifNotInView(id, () => toast(`Added to ${to.name}`, { ms: 1800 }));
    return id;
  };

  return { parsed, draft, draftOf, dest, base, parent, fixedParent: !!parentId, mode, allowed, over, change, pickList, keepAsText, reset, commit, parse, tags, setTags, suggested };
}

export type Compose = ReturnType<typeof useCompose>;

/**
 * Its tags: what the words suggest (on by themselves: an aisle for a thing to buy, or what we
 * taught it), or what was picked. Its panel picks any, finds or makes one.
 */
export function tagChip(c: Compose, hub: Hub) {
  const { label, lead } = tagsLabel(hub, c.tags);
  return {
    key: 'tags',
    label,
    icon: lead ? undefined : ('tag' as const),
    lead: lead ? <TagMark icon={lead} /> : undefined,
    set: c.tags.length > 0,
    panel: () => <TagPicker value={c.tags} onChange={c.setTags} suggested={[...c.suggested.auto, ...c.suggested.more]} />,
  };
}

/**
 * Where it goes: the project's bullet and name (or "↳ the task" it goes under). Its panel is the
 * tree of projects, nested ones folded away; a task project unfolds to its open tasks, and
 * picking a task makes the new one its subtask.
 */
export function listChip(c: Compose, lists: List[]) {
  const dest = c.dest;
  return {
    key: 'list',
    label: c.parent ? `↳ ${c.parent.title}` : (dest?.name ?? 'List'),
    lead: <ListBullet list={dest} size="xs" />,
    panel: (close: () => void) => (
      <DestTree
        lists={lists}
        listId={dest?.id ?? null}
        parentId={c.parent?.id ?? null}
        onPick={(listId, parentId) => {
          c.pickList(listId, parentId);
          close();
        }}
      />
    ),
  };
}

function DestTree({ lists, listId, parentId, onPick }: { lists: List[]; listId: string | null; parentId: string | null; onPick: (listId: string, parentId: string | null) => void }) {
  const hub = useHub();
  const ids = new Set(lists.map((l) => l.id));
  // Unfolded at first: the way down to where it's going now.
  const [open, setOpen] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    if (listId) for (const l of [...hub.listPath(listId), hub.list(listId)]) if (l) keys.add(`l:${l.id}`);
    const p = hub.item(parentId);
    if (p) for (const a of [...hub.ancestors(p), p]) keys.add(`i:${a.id}`);
    return keys;
  });
  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const tasksOf = (l: List, under: string | null) => (under ? hub.childrenOf(under) : hub.children(l.id, null)).filter((i) => !i.done && !i.archived);
  const row = (key: string, depth: number, label: ReactNode, on: boolean, canOpen: boolean, pick: () => void) => (
    <div key={key} className={`desttree__row ${on ? 'is-on' : ''}`} style={{ paddingInlineStart: 6 + depth * 18 }}>
      {canOpen ? (
        <button type="button" className={`desttree__fold ${open.has(key) ? 'is-open' : ''}`} aria-label={open.has(key) ? 'Fold' : 'Unfold'} aria-expanded={open.has(key)} onClick={() => toggle(key)}>
          <Icon name="chevron-right" />
        </button>
      ) : (
        <span className="desttree__fold" aria-hidden="true" />
      )}
      <button type="button" className="desttree__pick" aria-pressed={on} onClick={pick}>
        {label}
        {on ? <Icon name="check" className="icon--sm desttree__on" /> : null}
      </button>
    </div>
  );
  const taskRows = (l: List, under: string | null, depth: number): ReactNode[] =>
    tasksOf(l, under).flatMap((i) => {
      const key = `i:${i.id}`;
      const kids = tasksOf(l, i.id);
      return [
        row(key, depth, <span className="desttree__task" dir="auto">{i.title}</span>, i.id === parentId, kids.length > 0, () => onPick(l.id, i.id)),
        ...(open.has(key) ? taskRows(l, i.id, depth + 1) : []),
      ];
    });
  const listRows = (l: List, depth: number): ReactNode[] => {
    const key = `l:${l.id}`;
    const subs = hub.subLists(l.id).filter((x) => ids.has(x.id));
    const canOpen = subs.length > 0 || tasksOf(l, null).length > 0;
    return [
      row(
        key,
        depth,
        <>
          <ListBullet list={l} size="xs" />
          <span dir="auto">{l.name}</span>
        </>,
        l.id === listId && !parentId,
        canOpen,
        () => onPick(l.id, null),
      ),
      ...(open.has(key) ? [...subs.flatMap((x) => listRows(x, depth + 1)), ...taskRows(l, null, depth + 1)] : []),
    ];
  };
  const top = lists.filter((l) => !l.parentId || !ids.has(l.parentId));
  return <div className="desttree" role="tree">{top.flatMap((l) => listRows(l, 0))}</div>;
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

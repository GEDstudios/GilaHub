import { playSound } from '../ui/sounds';
import { useMemo, useState, type ReactNode } from 'react';
import type { List } from '../../core/model';
import { parseQuickAdd, type ParseContext, type ParseResult } from '../../smart/parse';
import { composeDraft, overriddenTokens, parsedDraft, type AddMode } from '../compose';
import { useHub, useRt } from '../context';
import { notifyAbout, setUpReminders } from '../notify';
import { dayFirst, getPrefs, setPrefs, use24h, usePrefs, weekStart, workdays } from '../prefs';
import { allowedVis, itemVisChoice, visFields, type VisChoice } from '../privacy';
import { ifNotInView, markFresh } from '../ui/fresh';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { ListBullet } from '../ui/primitives';
import { type Draft } from './editors';
import { TagMark, TagPicker, tagsLabel } from './Tags';
import type { Hub } from '../../core/actions';
import { usePingUrgent } from './add';

/** What a composer had picked: kept with a draft so a reload brings it all back. */
export interface ComposeSeed {
  over: Partial<Draft>;
  place: { listId: string; parentId: string | null } | null;
  tags: string[] | null;
  ignore: string[];
  /** The folder's template on (unset: on). */
  useTpl?: boolean;
}

export function useParseContext(_list?: List): ParseContext {
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
  seed,
}: {
  listId: string;
  parentId?: string | null;
  defaultDue?: string | null;
  text: string;
  /** Picked before (a draft brought back after a reload): chips, place, tags, words kept as text. */
  seed?: ComposeSeed;
  /** On a project showing what's inside it too: each thing goes where it belongs ("bulbs" → Home shopping), until a project is picked. */
  route?: boolean;
}) {
  const hub = useHub();
  const rt = useRt();
  const { toast } = useOverlays();
  const pingUrgent = usePingUrgent();
  const [ignore, setIgnore] = useState<Set<string>>(() => new Set(seed?.ignore ?? []));
  const [over, setOver] = useState<Partial<Draft>>(seed?.over ?? {});
  // Where it goes, once picked: a project, or a task in one (then it's a subtask of that task).
  const [place, setPlace] = useState<{ listId: string; parentId: string | null } | null>(seed?.place ?? null);
  // Its tags, once picked; until then, what the words suggest by themselves (Hub.suggestTags).
  const [picked, setTags] = useState<string[] | null>(seed?.tags ?? null);
  const target = place?.listId ?? null;
  const home = (target ? hub.list(target) : undefined) ?? hub.list(listId);
  // Asking my person can't live in a Private folder: unless I picked one, it goes to a shared one
  // (the last I added to, else To do).
  const ctx = useParseContext(home);
  const parse = (raw: string) => parseQuickAdd(raw, { ...ctx, ignore });
  const parsed = useMemo(() => parseQuickAdd(text, { ...ctx, ignore }), [text, ctx, ignore]);
  // Asking my person (the Ask chip, or "@Hila" in the words) can't live in a Private folder:
  // unless I picked one, it goes to a shared one (the last I added to, else To do).
  const asking = hub.isRequest(over.assignee !== undefined ? over.assignee : parsed.assignee);
  const sharedHome = () => {
    const shared = hub.lists().filter((l) => l.visibility !== 'private');
    const last = getPrefs().lastList;
    return shared.find((l) => l.id === last) ?? shared.find((l) => l.name === 'To do') ?? shared[0];
  };
  const base = asking && home?.visibility === 'private' && !target ? (sharedHome() ?? home) : home;
  const parentPick = place ? place.parentId : parentId;
  const parent = hub.item(parentPick);
  const routed = (p: ParseResult) => (route && !target && base && !parent && p.title.trim() ? hub.list(hub.placeFor(p.title, base.id)) : undefined);
  const destOf = (p: ParseResult) => (p.listId && !parent ? hub.list(p.listId) : undefined) ?? routed(p) ?? base;
  const dest = destOf(parsed);
  const mode: AddMode = 'task';
  const suggested = useMemo(() => (parsed.title.trim() ? hub.suggestTags(parsed.title, dest?.id) : { auto: [], more: [] }), [hub, parsed.title, dest?.id]);
  // The folder's task template: how a new task here starts (the words and the chips still win).
  // Its chip in New turns it off for this one.
  const [useTpl, setUseTpl] = useState(seed?.useTpl ?? true);
  const hasTpl = !!dest?.template && Object.values(dest.template).some((v) => v !== null && v !== undefined && v !== false && !(Array.isArray(v) && !v.length));
  const tpl = useTpl && hasTpl ? (dest?.template ?? null) : null;
  const tags = picked ?? (tpl?.tags?.length ? [...new Set([...tpl.tags.filter((t) => !!hub.tag(t)), ...suggested.auto])] : suggested.auto);
  const allowed = allowedVis(hub, dest, parent);
  const inherited: VisChoice = parent ? itemVisChoice(hub, parent) : tpl?.visibility && allowed.includes(tpl.visibility) ? tpl.visibility : allowed[0];
  const defVis = allowed.includes(inherited) ? inherited : allowed[0];
  const templated = (p: ParseResult, d: Draft): Draft =>
    tpl
      ? {
          ...d,
          assignee: p.assignee ?? (tpl.assignee !== undefined ? tpl.assignee : d.assignee),
          needsOk: tpl.needsOk ?? d.needsOk,
          urgent: d.urgent || !!tpl.urgent,
          remind: d.remind ?? tpl.remind ?? null,
          repeat: d.repeat ?? tpl.repeat ?? null,
        }
      : d;
  const draftOf = (p: ParseResult) => composeDraft(templated(p, parsedDraft(p, { mode, defaultDue, visibility: defVis })), over, allowed);
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
  const commit = (raw?: string, opts: { quiet?: boolean; announce?: boolean; listed?: boolean } = {}): string | undefined => {
    const p = raw === undefined ? parsed : parse(raw);
    const to = destOf(p);
    const d = raw === undefined ? draft : draftOf(p);
    const title = p.title.trim();
    if (!to || !title) return undefined;
    // Picked tags go on this one; other words (a pasted line, a suggestion) find their own.
    const tplTags = (useTpl ? (to.template?.tags ?? []) : []).filter((t) => !!hub.tag(t));
    const ownTags =
      raw === undefined
        ? (picked ?? (tplTags.length ? tags : undefined))
        : tplTags.length
          ? [...new Set([...tplTags, ...hub.suggestTags(p.title, to.id).auto])]
          : undefined;
    const asking = hub.isRequest(d.assignee);
    // Never twice: one already open says so (+1); one done before comes back.
    const res = hub.add(to.id, {
      title,
      qty: p.qty ?? null,
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
    const id = res.id;
    if (d.urgent && res.kind !== 'exists' && hub.item(id)) pingUrgent(hub.item(id)!, true);
    if (res.kind === 'exists') {
      markFresh(id, { scroll: opts.announce });
      if (!opts.quiet) toast(`${hub.item(id)?.title} is already in ${to.name}`, { action: { label: '+1', run: () => hub.bump(id) } });
      return id;
    }
    // A dated task notifies by default: ask for permission the first time (in this tap).
    if (d.remind != null && typeof Notification !== 'undefined' && Notification.permission === 'default') setUpReminders(rt, toast);
    const made = hub.item(id);
    if (made && asking && made.requestedBy === hub.meId) {
      notifyAbout(rt, hub, made, d.assignee as string, `🙋 ${hub.me()?.name ?? 'Your partner'} asked you`, made.title);
    }
    // New (from Today, Search…) opens on the last project used.
    if (!parent) setPrefs({ lastList: to.id });
    markFresh(id, { scroll: opts.announce });
    if (!opts.quiet) playSound('add');
    const said = res.kind === 'revived' ? `Brought back ${hub.item(id)?.title ?? ''}` : `Added to ${to.name}`;
    // In the composer, what was added is listed under the card: only news is said.
    if (opts.announce || res.kind === 'revived') toast(said, { ms: 1800 });
    else if (!opts.quiet && !opts.listed) ifNotInView(id, () => toast(said, { ms: 1800 }));
    return id;
  };

  /** What was picked, to keep through a reload. */
  const seedOut: ComposeSeed = { over, place, tags: picked, ignore: [...ignore], useTpl };
  return { parsed, draft, draftOf, dest, base, parent, fixedParent: !!parentId, mode, allowed, over, change, pickList, keepAsText, reset, commit, parse, tags, setTags, suggested, seed: seedOut, hasTpl, useTpl, setUseTpl };
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

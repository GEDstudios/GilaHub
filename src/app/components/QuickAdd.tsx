import { hasTemplate, startFromTemplate, templateDay } from '../template';
import { playSound } from '../ui/sounds';
import { useMemo, useState } from 'react';
import type { List } from '../../core/model';
import { parseQuickAdd, type ParseContext, type ParseResult } from '../../smart/parse';
import { composeDraft, overriddenTokens, parsedDraft } from '../compose';
import { useHub, useRt } from '../context';
import { notifyAbout, setUpReminders } from '../notify';
import { dayFirst, getPrefs, setPrefs, use24h, weekStart, workdays } from '../prefs';
import { usePrefs } from '../usePrefs';
import { allowedVis, itemVisChoice, visFields, type VisChoice } from '../privacy';
import { ifNotInView, markFresh } from '../ui/fresh';
import { Icon } from '../ui/Icon';
import { PlaceTree } from './PlaceTree';
import { useOverlays } from '../ui/overlays';
import { ListBullet } from '../ui/primitives';

import { TagMark, TagPicker, tagsLabel } from './Tags';
import type { Hub } from '../../core/hub';
import { usePingUrgent } from './add';
import { TOAST } from '../ui/tokens';
import type { Draft } from '../draft';
import { G, G_TEXT } from '../ui/glyphs';
import { myName } from '../labels';

/** What a composer had picked: kept with a draft so a reload brings it all back. */
export interface ComposeSeed {
  over: Partial<Draft>;
  place: { listId: string; parentId: string | null } | null;
  tags: string[] | null;
  ignore: string[];
  /** The folder's template on (unset: on). */
  useTpl?: boolean;
}

function useParseContext(): ParseContext {
  const hub = useHub();
  const prefs = usePrefs();
  return {
    members: hub.members().map((m) => ({ id: m.id, name: m.name })),
    meId: hub.meId,
    lists: hub.lists().map((l) => ({ id: l.id, name: l.name })),
    tags: hub.tags().map((t) => ({ id: t.id, name: t.name })),
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
  const ctx = useParseContext();
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
  const suggested = useMemo(() => (parsed.title.trim() ? hub.suggestTags(parsed.title, dest?.id) : { auto: [], more: [] }), [hub, parsed.title, dest?.id]);
  // The folder's task template: how a new task here starts (the words and the chips still win).
  // Its chip in New turns it off for this one.
  const [useTpl, setUseTpl] = useState(seed?.useTpl ?? true);
  const hasTpl = !!dest?.template && Object.values(dest.template).some((v) => v !== null && v !== undefined && v !== false && !(Array.isArray(v) && !v.length));
  const tpl = useTpl && hasTpl ? (dest?.template ?? null) : null;
  // "#name" in the words: tags too (a new name is made when it's added).
  const hashTags = parsed.tagIds ?? [];
  const tags = picked ?? [...new Set([...hashTags, ...(tpl?.tags?.length ? tpl.tags.filter((t) => !!hub.tag(t)) : []), ...suggested.auto])];
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
          ...templateDay(tpl, d),
          nag: d.nag ?? tpl.nag ?? null,
        }
      : d;
  const draftOf = (p: ParseResult) => composeDraft(templated(p, parsedDraft(p, { defaultDue, visibility: defVis })), over, allowed);
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
  const commit = (raw?: string, opts: { quiet?: boolean; listed?: boolean } = {}): string | undefined => {
    const p = raw === undefined ? parsed : parse(raw);
    const to = destOf(p);
    const d = raw === undefined ? draft : draftOf(p);
    const title = p.title.trim();
    if (!to || !title) return undefined;
    // Picked tags go on this one; other words (a pasted line, a suggestion) find their own.
    const tplTags = (useTpl ? (to.template?.tags ?? []) : []).filter((t) => !!hub.tag(t));
    // "#name" that isn't a tag yet becomes one.
    const hashed = [...(p.tagIds ?? []), ...(p.newTags ?? []).map((n) => hub.createTag(n)).filter((x): x is string => !!x)];
    const ownTags =
      raw === undefined
        ? (picked ?? (tplTags.length || hashed.length ? [...new Set([...hashed, ...tags])] : undefined))
        : tplTags.length || hashed.length
          ? [...new Set([...hashed, ...tplTags, ...hub.suggestTags(p.title, to.id).auto])]
          : undefined;
    const asking = hub.isRequest(d.assignee);
    // Never twice: one already open says so; one done before comes back.
    const res = hub.add(to.id, {
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
    const id = res.id;
    // The template's note and subtasks (a new task only).
    const tplOf = useTpl && hasTemplate(to) ? to.template : null;
    if (tplOf && res.kind === 'added') startFromTemplate(hub, id, tplOf);
    if (d.urgent && res.kind !== 'exists' && hub.item(id)) pingUrgent(hub.item(id)!, true);
    if (res.kind === 'exists') {
      markFresh(id);
      if (!opts.quiet) toast(`${hub.item(id)?.title} is already in ${to.name}`);
      return id;
    }
    // A dated task notifies by default: ask for permission the first time (in this tap).
    if (d.remind != null && typeof Notification !== 'undefined' && Notification.permission === 'default') setUpReminders(rt, toast);
    const made = hub.item(id);
    if (made && asking && made.requestedBy === hub.meId) {
      notifyAbout(rt, hub, made, d.assignee as string, `${G_TEXT.ask} ${myName(hub)} asked you`, made.title);
    }
    // New (from Today, Search…) opens on the last project used.
    if (!parent) setPrefs({ lastList: to.id });
    markFresh(id);
    if (!opts.quiet) playSound('add');
    const said = res.kind === 'revived' ? `Brought back ${hub.item(id)?.title ?? ''}` : `Added to ${to.name}`;
    // In the composer, what was added is listed under the card: only news is said.
    if (res.kind === 'revived') toast(said, { ms: TOAST.short });
    else if (!opts.quiet && !opts.listed) ifNotInView(id, () => toast(said, { ms: TOAST.short }));
    return id;
  };

  /** What was picked, to keep through a reload. */
  const seedOut: ComposeSeed = { over, place, tags: picked, ignore: [...ignore], useTpl };
  return { parsed, draft, draftOf, dest, base, parent, fixedParent: !!parentId, allowed, over, change, pickList, keepAsText, reset, commit, parse, tags, setTags, suggested, seed: seedOut, hasTpl, useTpl, setUseTpl };
}

type Compose = ReturnType<typeof useCompose>;

/**
 * Its tags: what the words suggest (on by themselves: an aisle for a thing to buy, or what we
 * taught it), or what was picked. Its panel picks any, finds or makes one.
 */
export function tagChip(c: Compose, hub: Hub) {
  const { label, lead } = tagsLabel(hub, c.tags);
  return {
    key: 'tags',
    label,
    icon: lead ? undefined : G.tag,
    lead: lead ? <TagMark icon={lead} /> : undefined,
    set: c.tags.length > 0,
    panel: () => <TagPicker value={c.tags} onChange={c.setTags} suggested={[...c.suggested.auto, ...c.suggested.more]} />,
  };
}

/**
 * Where it goes: the project's bullet and name (or the task it goes under, with the subtask mark). Its panel is the
 * tree of projects, nested ones folded away; a task project unfolds to its open tasks, and
 * picking a task makes the new one its subtask.
 */
export function listChip(c: Compose, lists: List[]) {
  const dest = c.dest;
  const offered = new Set(lists.map((l) => l.id));
  return {
    key: 'list',
    label: c.parent ? c.parent.title : (dest?.name ?? 'List'),
    lead: c.parent ? <Icon name={G.subtask} className="icon--sm" /> : <ListBullet list={dest} size="xs" />,
    panel: (close: () => void) => (
      <PlaceTree
        tasks
        scroll
        offer={(l) => offered.has(l.id)}
        value={dest ? { listId: dest.id, parentId: c.parent?.id ?? null } : null}
        onPick={(p) => {
          if (p) c.pickList(p.listId, p.parentId);
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
      <Icon name={G.close} className="token__x" />
    </button>
  );
}

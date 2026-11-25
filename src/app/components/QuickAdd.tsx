import { playSound } from '../ui/sounds';
import { useMemo, useState } from 'react';
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
import { Options, type Draft } from './editors';
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
    // A dated task notifies by default: ask for permission the first time (in this tap).
    if (d.remind != null && typeof Notification !== 'undefined' && Notification.permission === 'default') setUpReminders(rt, toast);
    const made = hub.item(id);
    if (made && asking && made.requestedBy === hub.meId) {
      notifyAbout(rt, hub, made, d.assignee as string, `${hub.me()?.name ?? 'Your partner'} asked you`, made.title);
    }
    // New (from Today, Search…) opens on the last task project used.
    if (!parent && to.kind === 'tasks') setPrefs({ lastList: to.id });
    markFresh(id, { scroll: opts.announce });
    if (!opts.quiet) playSound('add');
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

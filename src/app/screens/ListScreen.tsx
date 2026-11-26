import { PathCrumbs, projectPath } from '../components/PathCrumbs';
import { openSearch } from '../search';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { Item, List, TaskTemplate } from '../../core/model';
import { Lens, useFilter } from '../components/Filter';
import { useAddAction } from '../addAction';
import { OptRow } from '../components/pickers';
import { ListVisOptions } from '../components/ProjectFields';
import { Swatches } from '../components/pickers';
import { allowedVis, listDefaultVis, visLabel, VIS_ICON } from '../privacy';
import { InlineEditor, Options, Panel, RepeatPanel, ruleShort, type Draft } from '../components/editors';
import { TagMark, TagPicker, tagsLabel } from '../components/Tags';
import { CardIcon, IconPicker } from '../components/IconPicker';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { OngoingTray, ProjectItems } from '../components/ProjectItems';
import { Photos, useAddPhoto } from '../components/Photos';
import { ItemRow } from '../components/ItemRow';
import { useHub, usePartnerHere, useRt } from '../context';
import { back, navigate } from '../router';
import { AutoTitle } from '../ui/AutoTitle';
import { Sheet, useOverlays } from '../ui/overlays';
import { Avatar, Band, Disclosure, Empty, IconButton, lineVars, ListBullet, NewButton, Switch } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { setPrefs, use24h, usePrefs } from '../prefs';
import { ViewToggle } from '../components/ViewToggle';
import { Sortable, type Outside, type Point } from '../ui/Sortable';
import { barTabOf, folderLean, NewProjectSheet, ProjectCard, SortableProject, useBarDrop } from './Lists';
import { TabChip } from '../components/BarEdit';
import { pinsOf, setPins, togglePin } from '../tabs';
import { listVisLabel } from '../privacy';
import { projectView } from '../views';
import { hideHome, MAX_HOME_PROJECTS, pinnedProjects, projectKey, showHome, visibleHome } from '../home';
import { notifyMembers } from '../runtime';
import { markFresh } from '../ui/fresh';
import { playSound } from '../ui/sounds';
import { haptic } from '../ui/haptics';
import { cadenceLabel } from '../../smart/suggest';
import { dayIn, hasTemplate } from '../template';
import { humanTime } from '../../core/dates';

/** The folder's own settings, in place under its card: a photo, on Today, its task template, the tasks it shows from elsewhere, where it sits. Each says what it's set to. */
const NO_DRAFT: Draft = { due: null, dueTime: null, repeat: null, remind: null, assignee: null, urgent: false, visibility: 'ours' };

function FolderTools({ list }: { list: List }) {
  const hub = useHub();
  const { toast, openSheet } = useOverlays();
  const listId = list.id;
  const addPhoto = useAddPhoto(`list:${listId}`);
  const photoN = hub.photosOf(`list:${listId}`).length;
  const onHome = pinnedProjects(hub).includes(listId) && visibleHome(hub).some((x) => x.key === projectKey(listId));
  const shows = hub.shownIn(listId);
  const tpl = hasTemplate(list);
  return (
    <InlineEditor
      className="foldertools"
      value={NO_DRAFT}
      onChange={() => undefined}
      fields={[]}
      extras={[
        { key: 'photo', label: photoN ? `Photos ${photoN}` : 'Photo', icon: 'image', set: photoN > 0, toggle: () => void addPhoto() },
        {
          key: 'today',
          label: 'On Today',
          icon: 'home',
          set: onHome,
          toggle: () => {
            haptic('select');
            if (onHome) {
              hideHome(hub, projectKey(listId));
              toast('Off your Today', { action: { label: 'Undo', run: () => showHome(hub, projectKey(listId)) } });
            } else if (showHome(hub, projectKey(listId))) toast('Its open tasks show on your Today', { action: { label: 'Undo', run: () => hideHome(hub, projectKey(listId)) } });
            else toast(`Today shows up to ${MAX_HOME_PROJECTS} folders. Take one off it first (Edit Today).`);
          },
        },
        { key: 'tpl', label: tpl ? 'Template' : 'Task template', icon: 'layout', set: tpl, toggle: () => openSheet((close) => <TemplateSheet listId={listId} onClose={close} />) },
        {
          key: 'shows',
          label: shows.length ? `Shows ${shows.map((l) => l.name).join(', ')}` : 'Show tasks from',
          icon: 'link',
          set: shows.length > 0,
          toggle: () => openSheet((close) => <ShowsSheet listId={listId} onClose={close} />),
        },
      ]}
    />
  );
}

/** The project's "…": the rare things only (archive, delete). Everything else is edited in place on its page. */
export function ListMenu({ listId, onClose }: { listId: string; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const list = hub.list(listId);
  if (!list) return null;
  const mineToChange = !list.owner || list.owner === hub.meId;
  return (
    <Sheet onClose={onClose} title={list.name}>
      <div className="group">
        <OptRow
          icon="archive"
          title="Archive"
          onClick={() => {
            hub.updateList(listId, { archived: true });
            onClose();
            navigate({ name: 'lists' }, { replace: true });
            toast(`Archived ${list.name}`, { action: { label: 'Undo', run: () => hub.updateList(listId, { archived: false }) } });
          }}
        />
        {mineToChange ? (
          <OptRow
            icon="trash"
            title="Delete folder"
            danger
            onClick={() => {
              const undo = hub.deleteList(listId);
              onClose();
              navigate({ name: 'lists' }, { replace: true });
              toast(`Deleted ${list.name}`, { action: { label: 'Undo', run: undo } });
            }}
          />
        ) : null}
      </div>
    </Sheet>
  );
}

/** A template's day: how many days after it's added, and a time. */
function TemplateDayPanel({ listId }: { listId: string }) {
  const hub = useHub();
  const t = hub.list(listId)?.template ?? {};
  const days = [0, 1, 2, 3, 7, 14];
  return (
    <Panel>
      <p className="panel__head">Due</p>
      <Options
        value={t.dueIn == null ? 'none' : String(t.dueIn)}
        options={[{ value: 'none', label: 'No date' }, ...days.map((n) => ({ value: String(n), label: dayIn(n) }))]}
        onPick={(v) => hub.setListTemplate(listId, { dueIn: v === 'none' ? null : Number(v) })}
      />
      <label className="tpltime">
        <Icon name="clock" className="icon--sm" />
        <span>Time</span>
        <input type="time" value={t.dueTime ?? ''} onChange={(e) => hub.setListTemplate(listId, { dueTime: e.target.value || null })} aria-label="Time" />
        {t.dueTime ? (
          <button type="button" className="whenrow__clear" aria-label="Any time" onClick={() => hub.setListTemplate(listId, { dueTime: null })}>
            <Icon name="x" className="icon--xs" />
          </button>
        ) : null}
      </label>
    </Panel>
  );
}

/** A few lines of the template's own (its subtasks, its note), kept when the field is left. */
function TemplateText({ value, placeholder, label, rows, onSave }: { value: string; placeholder: string; label: string; rows: number; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  // Kept on leaving the field, and when its panel closes under it (a tap elsewhere can close it first).
  const latest = useRef({ text, value, onSave });
  latest.current = { text, value, onSave };
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.text !== l.value) l.onSave(l.text);
    },
    [],
  );
  return (
    <textarea
      className="notes tpltext"
      dir="auto"
      rows={rows}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      autoFocus
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text === value) return;
        onSave(text);
        latest.current.value = text;
      }}
    />
  );
}

/**
 * A folder's task template: how every new task added here starts (who it's for, its tags, its
 * notification, a repeat, urgent, who sees it). What's typed or picked when adding still wins.
 */
function TemplateSheet({ listId, onClose }: { listId: string; onClose: () => void }) {
  const hub = useHub();
  const h24 = use24h(usePrefs());
  const list = hub.list(listId);
  if (!list) return null;
  const t = list.template ?? {};
  const allowed = allowedVis(hub, list);
  const value: Draft = {
    due: null,
    dueTime: null,
    repeat: t.repeat ?? null,
    remind: t.remind ?? null,
    nag: null,
    assignee: t.assignee ?? null,
    urgent: !!t.urgent,
    visibility: t.visibility && allowed.includes(t.visibility) ? t.visibility : allowed[0],
    needsOk: !!t.needsOk,
  };
  const tags = (t.tags ?? []).filter((x) => !!hub.tag(x));
  const tl = tagsLabel(hub, tags);
  return (
    <Sheet onClose={onClose} title={`New tasks in ${list.name}`}>
      <p className="sheet__lede">Every task added here starts like this: its day, tags, subtasks, a note, who it’s for, a reminder. What you type or pick when adding still wins.</p>
      <InlineEditor
        value={value}
        onChange={(patch) => {
          const next: Partial<TaskTemplate> = {};
          if ('assignee' in patch) next.assignee = patch.assignee ?? null;
          if ('needsOk' in patch) next.needsOk = !!patch.needsOk;
          if ('urgent' in patch) next.urgent = !!patch.urgent;
          if ('remind' in patch) next.remind = patch.remind ?? null;
          if ('repeat' in patch) next.repeat = patch.repeat ?? null;
          if ('visibility' in patch) next.visibility = patch.visibility ?? null;
          hub.setListTemplate(listId, next);
        }}
        fields={(['repeat', 'remind', 'who', 'vis', 'urgent'] as const).filter((f) => f !== 'who' || value.visibility !== 'private')}
        allowedVis={allowed}
        whoMode="compose"
        extras={[
          {
            key: 'day',
            label: t.dueIn != null ? `${dayIn(t.dueIn)}${t.dueTime ? `, ${humanTime(t.dueTime, h24)}` : ''}` : t.dueTime ? humanTime(t.dueTime, h24) : 'Date',
            icon: 'calendar' as const,
            set: t.dueIn != null || !!t.dueTime,
            panel: () => <TemplateDayPanel listId={listId} />,
          },
          {
            key: 'tags',
            label: tl.label,
            icon: tl.lead ? undefined : ('tag' as const),
            lead: tl.lead ? <TagMark icon={tl.lead} /> : undefined,
            set: tags.length > 0,
            panel: () => <TagPicker value={tags} onChange={(next) => hub.setListTemplate(listId, { tags: next })} />,
          },
          {
            key: 'steps',
            label: t.steps?.length ? `Subtasks ${t.steps.length}` : 'Subtasks',
            icon: 'subtask' as const,
            set: !!t.steps?.length,
            panel: () => (
              <Panel>
                <TemplateText
                  value={(t.steps ?? []).join('\n')}
                  placeholder={'One per line\nBuy paint\nTape the edges'}
                  label="Subtasks it starts with, one per line"
                  rows={4}
                  onSave={(v) => {
                    const steps = v.split('\n').map((x) => x.trim()).filter(Boolean);
                    hub.setListTemplate(listId, { steps: steps.length ? steps : null });
                  }}
                />
              </Panel>
            ),
          },
          {
            key: 'notes',
            label: t.notes ? 'Note' : 'Note',
            icon: 'note' as const,
            set: !!t.notes,
            panel: () => (
              <Panel>
                <TemplateText value={t.notes ?? ''} placeholder="A note each task starts with" label="Its note" rows={3} onSave={(v) => hub.setListTemplate(listId, { notes: v.trim() || null })} />
              </Panel>
            ),
          },
          ...(t.remind != null
            ? [
                {
                  key: 'again',
                  label: t.nag ? `Again ${ruleShort(t.nag).toLowerCase()}` : 'Again until done',
                  icon: 'refresh' as const,
                  set: !!t.nag,
                  panel: () => <RepeatPanel nag rule={t.nag ?? null} defaultFrom="schedule" title="Notify again until done" onChange={(nag) => hub.setListTemplate(listId, { nag })} />,
                },
              ]
            : []),
        ]}
      />
      {list.template ? (
        <button
          type="button"
          className="textbtn"
          style={{ marginTop: 18 }}
          onClick={() => {
            hub.setListTemplate(listId, null);
          }}
        >
          Start plain again
        </button>
      ) : null}
    </Sheet>
  );
}

/**
 * Which other folders' tasks show in this one too. One way: picking Work here puts Work's tasks
 * on this page; this folder's tasks don't go to Work.
 */
function ShowsSheet({ listId, onClose }: { listId: string; onClose: () => void }) {
  const hub = useHub();
  const list = hub.list(listId);
  const on = new Set(list?.shows ?? []);
  // Folders inside folders fold into their parent; open from the start, the way down to the ones it shows.
  const [open, setOpen] = useState<Set<string>>(() => new Set((list?.shows ?? []).flatMap((x) => hub.listPath(x).map((l) => l.id))));
  if (!list) return null;
  const inside = new Set(hub.nestedLists(listId).map((l) => l.id));
  const offered = (l: List) => l.id !== listId && !inside.has(l.id);
  const flip = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const rows = (ls: List[], depth: number): ReactNode[] =>
    ls.flatMap((l) => {
      const subs = hub.subLists(l.id).filter((x) => x.id !== listId && !inside.has(x.id));
      return [
        <li key={l.id}>
          {/* The switch leads its row, so it steps in with each level: what's inside what reads at a glance. */}
          <div className={`place__row showrow ${depth ? 'is-nested' : ''}`} style={{ marginInlineStart: depth * 26 }}>
            {offered(l) ? (
              <Switch on={on.has(l.id)} label={`Show ${l.name}’s tasks in ${list.name}`} onChange={(v) => hub.setShows(listId, l.id, v)} />
            ) : (
              <span className="showrow__here">This folder</span>
            )}
            <span className="place__pick showrow__name">
              <ListBullet list={l} size="xs" />
              <span dir="auto">{l.name}</span>
            </span>
            {subs.length ? (
              <button type="button" className={`place__open ${open.has(l.id) ? 'is-open' : ''}`} aria-label={open.has(l.id) ? 'Fold' : 'Unfold'} aria-expanded={open.has(l.id)} onClick={() => flip(l.id)}>
                <Icon name="chevron-down" className="icon--sm" />
              </button>
            ) : null}
          </div>
        </li>,
        ...(open.has(l.id) ? rows(subs, depth + 1) : []),
      ];
    });
  return (
    <Sheet onClose={onClose} title={`Show in ${list.name}`}>
      <p className="sheet__lede">Their tasks show here too, each folder in its own group. {list.name}’s own tasks stay where they are.</p>
      <ul className="place" aria-label="Folders">
        {rows(hub.topLists().filter((l) => !inside.has(l.id)), 0)}
      </ul>
    </Sheet>
  );
}

/** Where a project sits: the top of Projects, or inside another (never inside its own insides). */
function MoveProjectSheet({ listId, onClose }: { listId: string; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const list = hub.list(listId);
  if (!list) return null;
  const here = hub.parentOf(listId)?.id ?? null;
  const inside = new Set(hub.nestedLists(listId).map((l) => l.id));
  // Folders inside folders fold into their parent: open from the start, only the way down to
  // where it sits now.
  const [open, setOpen] = useState<Set<string>>(() => new Set(here ? [...hub.listPath(here).map((l) => l.id), here] : []));
  const flip = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const tree: Array<{ l: List; depth: number; subs: number }> = [];
  const walk = (ls: List[], depth: number) => {
    for (const l of ls) {
      if (l.id === listId || inside.has(l.id)) continue;
      const subs = hub.subLists(l.id).filter((x) => x.id !== listId && !inside.has(x.id));
      tree.push({ l, depth, subs: subs.length });
      if (open.has(l.id)) walk(subs, depth + 1);
    }
  };
  walk(hub.topLists(), 0);
  const go = (to: string | null) => {
    if (to === here) return onClose();
    const was = here;
    hub.setListParent(listId, to);
    onClose();
    toast(to ? `${list.name} is in ${hub.list(to)?.name ?? 'there'}` : `${list.name} is back in Folders`, {
      action: { label: 'Undo', run: () => hub.setListParent(listId, was) },
    });
  };
  return (
    <Sheet onClose={onClose} title={`Move ${list.name}`}>
      <ul className="place" aria-label="Where it sits">
        <li>
          <div className="place__row">
            <button type="button" className="place__pick" aria-current={here === null || undefined} disabled={here === null} onClick={() => go(null)}>
              <Icon name="folders" className="icon--sm" />
              <span>Folders</span>
              <span className="place__hint">the top</span>
            </button>
          </div>
        </li>
        {tree.map(({ l, depth, subs }) => (
          <li key={l.id}>
            <div className="place__row" style={{ paddingInlineStart: 6 + (depth + 1) * 18 }}>
              <button type="button" className="place__pick" aria-current={here === l.id || undefined} disabled={here === l.id} onClick={() => go(l.id)}>
                <ListBullet list={l} size="xs" />
                <span dir="auto">{l.name}</span>
                {here === l.id ? <span className="place__hint">here now</span> : null}
              </button>
              {subs ? (
                <button type="button" className={`place__open ${open.has(l.id) ? 'is-open' : ''}`} aria-label={open.has(l.id) ? 'Fold' : 'Unfold'} aria-expanded={open.has(l.id)} onClick={() => flip(l.id)}>
                  <Icon name="chevron-down" className="icon--sm" />
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** The project's settings button. */
export function ProjectMenuButton({ listId }: { listId: string }) {
  const { openSheet } = useOverlays();
  return <IconButton icon="more" label="Folder settings" onClick={() => openSheet((close) => <ListMenu listId={listId} onClose={close} />)} />;
}

/**
 * A project's card, the folder, holding its own settings, nothing under it: its name (edit in
 * place), what's open, and down its right edge the pin to the bar, who sees it, and its icon.
 * A tap on the card itself changes its colour. Each opens its picker right under the card.
 */
export function ProjectHero({ list, sub }: { list: List; sub: ReactNode }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const [open, setOpen] = useState<'icon' | 'color' | 'vis' | null>(null);
  const toggle = (k: 'icon' | 'color' | 'vis') => setOpen(open === k ? null : k);
  const pinned = pinsOf(hub).includes(`l:${list.id}`);
  const partner = hub.partner();
  const canVis = canSetListVis(hub, list);
  const vis = listDefaultVis(hub, list);
  const onCard = (e: MouseEvent) => {
    if ((e.target as Element).closest('button, input, textarea, a, [contenteditable], .hero__title')) return;
    haptic('select');
    toggle('color');
  };
  const pin = () => {
    const before = pinsOf(hub);
    const now = togglePin(hub, `l:${list.id}`);
    haptic(now ? 'tick' : 'select');
    toast(now ? 'Added to the bar' : 'Taken out of the bar', { action: { label: 'Undo', run: () => setPins(hub, before) } });
  };
  const setVis = (v: { visibility: List['visibility']; owner: string | null }) => {
    if (v.visibility === 'private' && list.visibility !== 'private' && partner) toast(`Hidden from ${partner.name}`);
    else if (partner && v.owner === partner.id && list.owner !== partner.id) toast(`${list.name} is ${partner.name}’s now`);
    hub.setListVisibility(list.id, v.visibility, v.owner);
    setOpen(null);
  };
  return (
    <>
      <div className={`hero hero--project hero--folder ${open === 'color' ? 'is-picking' : ''}`} style={lineVars(list.color)} onClick={onCard}>
        <div className="hero__top">
          <h1 className="hero__title">
            <AutoTitle value={list.name} onSave={(name) => hub.updateList(list.id, { name })} label="Folder name" />
          </h1>
        </div>
        <AutoTitle
          className="hero__desc"
          value={list.description ?? ''}
          placeholder="Add a description"
          optional
          onSave={(d) => hub.updateList(list.id, { description: d || null })}
          label="Folder description"
        />
        <div className="hero__foot">
          <p className="hero__sub">{sub}</p>
        </div>
        <div className="hero__rail">
          <button type="button" className={`herobtn ${pinned ? 'is-on' : ''}`} aria-pressed={pinned} aria-label={pinned ? 'In the bar' : 'Pin to the bar'} title={pinned ? 'In the bar' : 'Pin to the bar'} onClick={pin}>
            <Icon name="pin" className="icon--sm" />
          </button>
          {canVis ? (
            <button
              type="button"
              className={`herobtn ${open === 'vis' ? 'is-open' : ''}`}
              aria-expanded={open === 'vis'}
              aria-label={`Who sees it: ${visLabel(vis, partner?.name)}`}
              title={visLabel(vis, partner?.name)}
              onClick={() => toggle('vis')}
            >
              <Icon name={VIS_ICON[vis]} className="icon--sm" />
            </button>
          ) : (
            <span className="herobtn is-static" title={listVisLabel(hub, list)} aria-label={listVisLabel(hub, list)}>
              <Icon name={VIS_ICON[vis]} className="icon--sm" />
            </span>
          )}
          <CardIcon icon={list.icon} open={open === 'icon'} onToggle={() => toggle('icon')} />
        </div>
      </div>
      {open === 'color' ? (
        <div className="panel hero__pick">
          <Swatches value={list.color} onChange={(color) => hub.updateList(list.id, { color })} big />
        </div>
      ) : null}
      {open === 'vis' ? (
        <div className="panel hero__pick">
          <ListVisOptions value={list.visibility} owner={list.owner} onPick={setVis} />
        </div>
      ) : null}
      {open === 'icon' ? (
        <div className="panel hero__pick">
          <IconPicker
            value={list.icon}
            color={list.color}
            onChange={(icon) => {
              hub.updateList(list.id, { icon });
              setOpen(null);
            }}
          />
        </div>
      ) : null}
    </>
  );
}

/** Ours, mine, or my person's-but-in-sight: either of us can say whose it is. Only Only me is the owner's alone. */
const canSetListVis = (hub: ReturnType<typeof useHub>, list: List) => !list.owner || list.owner === hub.meId || list.visibility === 'visible';

export function ListScreen({ id }: { id: string }) {
  return <ProjectPage id={id} />;
}

/** The folder's header buttons: search it, its "…" and its New. */
export function ProjectActions({ listId, label, onNew }: { listId: string; label: string; onNew: () => void }) {
  return (
    <>
      <IconButton icon="search" label="Search this folder" onClick={() => openSearch(listId)} />
      <ProjectMenuButton listId={listId} />
      <NewButton label={label} onClick={onNew} />
    </>
  );
}

/**
 * On it: something of mine here is ongoing and I'm looking at it (in the store, cleaning the
 * flat). My partner's phone knows (and once in a while hears: "Guy is on Shopping. Need
 * anything?"), and what they add or mark urgent here shows up as it happens.
 */
function useOnIt(on: boolean, listId: string, name: string) {
  const hub = useHub();
  const rt = useRt();
  const partner = hub.partner();
  useEffect(() => {
    if (!on) return;
    rt.sync?.setPresence(`on:${listId}`);
    const key = `gila-hub:onIt:${listId}`;
    let last = 0;
    try {
      last = Number(localStorage.getItem(key) ?? 0);
    } catch {
      /* storage blocked */
    }
    if (partner && partner.shopAlerts !== false && Date.now() - last > 30 * 60_000) {
      try {
        localStorage.setItem(key, String(Date.now()));
      } catch {
        /* storage blocked */
      }
      void notifyMembers(rt, [partner.id], {
        title: `${hub.me()?.name ?? 'Your partner'} is on ${name}`,
        body: 'Need anything? Add it now and it shows up for them.',
        url: `/l/${listId}`,
        tag: 'onit',
      });
    }
    return () => rt.sync?.setPresence(null);
  }, [on, rt, partner, hub, listId, name]);
}

/** What my partner just added (or brought back, or marked urgent) here: it glows, and while I'm on it, it's said. */
function usePartnerNews(open: Item[], saying: boolean): Set<string> {
  const hub = useHub();
  const { toast } = useOverlays();
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const seen = useRef<{ added: Map<string, number>; urgent: Set<string> } | null>(null);
  const sig = open.map((i) => `${i.id}:${i.addedAt ?? i.createdAt}:${i.urgent ? 1 : 0}`).join();
  useEffect(() => {
    const prev = seen.current;
    const added = new Map(open.map((i) => [i.id, i.addedAt ?? i.createdAt] as const));
    const urgent = new Set(open.filter((i) => i.urgent).map((i) => i.id));
    seen.current = { added, urgent };
    if (!prev) return;
    const theirs = (i: Item) => (i.addedBy ?? i.createdBy) !== hub.meId;
    const fresh = open.filter((i) => prev.added.get(i.id) !== added.get(i.id) && theirs(i));
    const urged = open.filter((i) => i.urgent && !prev.urgent.has(i.id) && prev.added.has(i.id) && i.urgentBy && i.urgentBy !== hub.meId);
    if (!fresh.length && !urged.length) return;
    setFlash(new Set([...fresh, ...urged].map((i) => i.id)));
    const first = fresh[0] ?? urged[0];
    const who = hub.member(fresh.length ? (first.addedBy ?? first.createdBy) : first.urgentBy);
    const more = fresh.length + urged.length - 1;
    if (saying && who) toast(`${who.name} ${fresh.length ? 'added' : 'marked urgent'} ${first.title}${more > 0 ? ` +${more}` : ''}`);
    const t = setTimeout(() => setFlash(new Set()), 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return flash;
}

/**
 * Any project, the one way: its folder up top, then a lens over what's in it (who, urgent, its
 * tags) beside how it's looked at (list, cards, by tag); Again? (things done here before, due
 * again); the tray of things just done; the Urgent card; the things themselves; the projects
 * inside; and what was cleared. Start (in the header) is for being on it: the store, a cleaning
 * spree. Shopping is just a project looked at by tag.
 */
function ProjectPage({ id }: { id: string }) {
  const hub = useHub();
  const prefs = usePrefs();
  const { openSheet, toast } = useOverlays();
  const list = hub.list(id);
  const nested = hub.nestedLists(id);
  // A folder shows everything inside it; the lens narrows it to one project.
  const inside = nested.length > 0;
  const view = hub.viewOf(list);
  const v = projectView(hub, id, inside, view, prefs.dismissed);
  const filter = useFilter(`l:${id}`);
  // Ongoing: what's swiped in (being done now), and what was ticked from it, until cleared.
  const ongoingOpen = v.open.filter((i) => i.ongoingAt);
  const ongoingDone = v.tray.filter((i) => i.ongoingAt);
  const focus = ongoingOpen.some((i) => i.ongoingBy === hub.meId);
  useOnIt(focus, id, list?.name ?? '');
  const flash = usePartnerNews(v.open, focus);
  const partnerHere = usePartnerHere();
  const label = `Add to ${list?.name ?? 'folder'}`;
  const openNew = () => openSheet((close) => <QuickAddSheet onClose={close} listId={id} route={inside} />);
  useAddAction(openNew, label);

  if (!list) {
    return (
      <>
        <Band title="Not here" onBack={() => back({ name: 'lists' })} />
        <Empty title="This folder is gone" text="It may have been deleted or made private." />
      </>
    );
  }

  // What's ongoing is in its card, not in the lists below.
  const keep = (i: Item) => !i.ongoingAt && filter.test(i, true);
  const groups = v.groups.map((g) => ({ ...g, items: g.items.filter(keep) })).filter((g) => g.items.length || g.listId === id || !filter.active);
  const urgent = v.urgent.filter(keep);
  const shownN = groups.reduce((n, g) => n + g.items.length, 0);
  const lists = new Set(v.open.map((i) => i.listId));
  const parent = hub.parentOf(id);
  const n = v.open.length;
  // Everything else done is just Done.
  const done = [...v.tray.filter((i) => !i.ongoingAt), ...v.cleared].sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const total = ongoingOpen.length + ongoingDone.length;
  const pct = total && ongoingDone.length ? Math.round((ongoingDone.length / total) * 100) : null;
  const shopper = partnerHere && partnerHere.listId === id ? hub.member(partnerHere.member) : undefined;

  const again = (name: string) => {
    const res = hub.add(inside ? hub.placeFor(name, id) : id, { title: name });
    markFresh(res.id);
    playSound('add');
  };
  /** Clear: what's been done from Ongoing is filed away (Again? remembers it); the rest stays on. */
  const clear = () => {
    const k = ongoingDone.length;
    const undo = hub.clearDone(
      v.lists.map((l) => l.id),
      ongoingDone.map((i) => i.id),
    );
    haptic('success');
    toast(k ? `Cleared ${k}` : 'Done for now', { action: { label: 'Undo', run: undo } });
  };

  return (
    <div className={`projpage ${focus ? 'is-onit' : ''}`}>
      <Band
        onBack={() => back(parent ? { name: 'list', id: parent.id } : { name: 'lists' })}
        actions={<ProjectActions listId={id} label={label} onNew={openNew} />}
        mini={list.name}
        crumbs={<PathCrumbs steps={projectPath(hub, id)} onMove={() => openSheet((close) => <MoveProjectSheet listId={id} onClose={close} />)} moveLabel="Move this folder" />}
      >
        <ProjectHero list={list} sub={`${focus ? 'On it now · ' : ''}${n ? `${n} open` : done.length || total ? 'All done' : 'Empty'}${pct !== null ? ` · ${pct}%` : ''}`} />
      </Band>
      <div className="column">
        <FolderTools list={list} />
        <Lens filter={filter} items={v.open} lists={v.lists.length > 1 ? v.lists : undefined}>
          <ViewToggle listId={id} />
        </Lens>

        {shopper && !focus ? (
          <div className="notice">
            <Avatar member={shopper} size="sm" />
            <span className="notice__text">
              <strong>{shopper.name} is on it now.</strong> What you add shows up for them.
            </span>
          </div>
        ) : null}

        {!focus && !filter.active && v.again.length ? (
          <div className="buyagain">
            <p className="inline__prompt">Again?</p>
            <div className="tokens tokens--scroll">
              {v.again.map((s) => (
                <span key={s.key} className="token token--split" title={cadenceLabel(s.avgDays)}>
                  <button type="button" onClick={() => again(s.name)}>
                    <Icon name="plus" />
                    <span dir="auto">{s.name}</span>
                  </button>
                  <button type="button" className="token__x" aria-label={`Not now: ${s.name}`} onClick={() => setPrefs({ dismissed: { ...prefs.dismissed, [s.key]: s.lastAt } })}>
                    <Icon name="x" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <Photos on={`list:${id}`} />

        {total ? <OngoingTray open={ongoingOpen} done={ongoingDone} onOut={(i) => hub.toggle(i.id)} onClear={clear} /> : null}

        <ProjectItems
          pageId={id}
          groups={groups}
          urgent={urgent}
          cards={view === 'cards'}
          draggable
          showList={lists.size > 1 && (view === 'tags' || !inside)}
          flash={flash}
        />
        {filter.active && n && !shownN ? <p className="hint">Nothing here with this filter.</p> : null}

        <SubProjects list={list} />

        {done.length ? (
          <Disclosure title="Done" count={done.length}>
            <ul className="rows">
              {done.slice(0, 40).map((i) => (
                <ItemRow key={i.id} item={i} showList={lists.size > 1} />
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </div>
    </div>
  );
}

/** A step of the path at the hand: a folder (its id), or the top (null). */
function crumbAt(p: Point): { el: HTMLElement; to: string | null } | null {
  for (const e of document.elementsFromPoint(p.x, p.y)) {
    const t = e.closest<HTMLElement>('.crumbs [data-drop-list], .crumbs [data-drop-root]');
    if (t) return { el: t, to: t.dataset.dropList ?? null };
  }
  return null;
}

/**
 * Drag a folder up onto the path (Folders › Home › …): dropped on a step it moves into that
 * folder; on Folders, out to the top. As a task does. `from` is the folder they're in now.
 */
function useCrumbDrop(from: string): { target: Outside; over: { current: string | null | undefined } } {
  const hub = useHub();
  const { toast } = useOverlays();
  const lit = useRef<HTMLElement | null>(null);
  // Where it would land while over a step (undefined: not over one), for the lifted chip.
  const over = useRef<string | null | undefined>(undefined);
  return useMemo(() => {
    const light = (el: HTMLElement | null) => {
      if (lit.current === el) return;
      lit.current?.classList.remove('is-droptarget');
      el?.classList.add('is-droptarget');
      if (el) haptic('select');
      lit.current = el;
    };
    const target: Outside = {
      hit: (p) => {
        const t = crumbAt(p);
        const on = !!t && t.to !== from;
        over.current = on ? t!.to : undefined;
        return on;
      },
      aim: (p) => {
        const t = p ? crumbAt(p) : null;
        light(t && t.to !== from ? t.el : null);
        over.current = t && t.to !== from ? t.to : undefined;
      },
      drop: (id, p) => {
        const t = crumbAt(p);
        light(null);
        over.current = undefined;
        const l = hub.list(id);
        if (!t || !l || t.to === from) return;
        const was = hub.parentOf(id)?.id ?? null;
        hub.setListParent(id, t.to);
        haptic('success');
        toast(t.to ? `${l.name} is in ${hub.list(t.to)?.name ?? 'there'}` : `${l.name} is back in Folders`, { action: { label: 'Undo', run: () => hub.setListParent(id, was) } });
      },
      end: () => {
        light(null);
        over.current = undefined;
      },
    };
    return { target, over };
  }, [hub, toast, from]);
}

/** Two places outside a list a dragged thing can go (the bar, the path): whichever is under the hand. */
function either(a: Outside, b: Outside): Outside {
  let cur: Outside | null = null;
  return {
    // Both asked every time (each keeps its own idea of where the hand is).
    hit: (p) => {
      const inB = b.hit(p);
      const inA = a.hit(p);
      return inA || inB;
    },
    aim: (p, id) => {
      const next = p ? (b.hit(p) ? b : a.hit(p) ? a : null) : null;
      if (cur && cur !== next) cur.aim(null, id);
      cur = next;
      next?.aim(p, id);
    },
    drop: (id, p) => (b.hit(p) ? b : a).drop(id, p),
    lift: (id) => {
      a.lift?.(id);
      b.lift?.(id);
    },
    end: () => {
      cur = null;
      a.end?.();
      b.end?.();
    },
  };
}

/** The folders inside a project, after its own tasks: open one, drag to reorder, or make another. */
function SubProjects({ list }: { list: List }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const subs = hub.subLists(list.id);
  const pins = pinsOf(hub);
  const make = () => openSheet((close) => <NewProjectSheet onClose={close} parentId={list.id} />);
  // Drag one down onto the bar: it's pinned there, like a folder from the Folders page. Or up
  // onto the path: it moves there.
  const toBar = useBarDrop();
  const crumbs = useCrumbDrop(list.id);
  const outside = useMemo(() => either(toBar.folders, crumbs.target), [toBar, crumbs]);
  // None yet: the + makes one ("Folder inside …").
  if (!subs.length) return null;
  return (
    <section className="subprojects" aria-label={`Inside ${list.name}`}>
      <Sortable
        ids={subs.map((l) => l.id)}
        onMove={(next, id) => hub.moveList(id, next[next.indexOf(id) + 1] ?? null)}
        layout="grid"
        lean={folderLean}
        label={(id) => hub.list(id)?.name ?? ''}
        outside={outside}
        renderOverlay={(id, { outside: away }) => {
          const l = hub.list(id);
          // Over the path: small, going in. Over the bar: the tab it'll be.
          if (l && away && crumbs.over.current !== undefined)
            return (
              <span className="dropchip">
                <Icon name="move" className="icon--sm" />
                <span dir="auto">{l.name}</span>
              </span>
            );
          const t = away ? barTabOf(hub, `l:${id}`) : undefined;
          return t ? <TabChip t={t} /> : l ? <ProjectCard list={l} /> : null;
        }}
      >
        <div className="projgrid">
          {subs.map((l, i) => (
            <SortableProject key={l.id} list={l} arranging={false} pins={pins} index={i} />
          ))}
          <button type="button" className="projcard projcard--new" onClick={make}>
            <span className="projcard__plus">
              <Icon name="plus" />
            </span>
            <span>Folder inside</span>
          </button>
        </div>
      </Sortable>
    </section>
  );
}

import { PlaceTree } from '../components/PlaceTree';
import { PathCrumbs, folderPath } from '../components/PathCrumbs';
import { openSearch } from '../search';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { Item, List, TaskTemplate } from '../../core/model';
import { Lens, useFilter } from '../components/Filter';
import { useAddAction } from '../addAction';
import { ListVisOptions } from '../components/FolderFields';
import { ActionSheet, Swatches } from '../components/pickers';
import { allowedVis, listDefaultVis, visLabel, VIS_ICON } from '../privacy';
import { InlineEditor } from '../components/InlineEditor';
import { Options } from '../components/chips';
import { RepeatPanel } from '../components/RepeatPanel';
import { TimeField } from '../components/TimeEntry';
import { TagMark, TagPicker, tagsLabel } from '../components/Tags';
import { CardIcon, IconPicker } from '../components/IconPicker';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { FolderItems } from '../components/FolderItems';
import { Photos, useAddPhoto } from '../components/Photos';
import { ItemRow } from '../components/ItemRow';
import { useHub } from '../context';
import { back, navigate } from '../router';
import { AutoTitle } from '../ui/AutoTitle';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, Disclosure, Empty, IconButton, lineVars, StarButton, Switch, DropChip, TextButton, GlyphButton } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { getPrefs, setPrefs, use24h } from '../prefs';
import { usePrefs } from '../usePrefs';
import { ViewToggle } from '../components/ViewToggle';
import { Sortable, type Outside, type Point } from '../ui/Sortable';
import { barTabOf, FolderCard, folderLean, SortableFolder, useBarDrop } from '../components/FolderCard';
import { TabChip } from '../components/BarEdit';
import { pinsOf, setPins, togglePin } from '../tabs';
import { listVisLabel } from '../privacy';
import { folderView } from '../views';
import { hideHome, MAX_HOME_FOLDERS, pinnedFolders, showHome, visibleHome } from '../home';
import { markFresh } from '../ui/fresh';
import { playSound } from '../ui/sounds';
import { haptic } from '../ui/haptics';
import { dropMarks } from '../ui/dropMark';
import { cadenceLabel } from '../../smart/suggest';
import { dayIn, hasTemplate, templateSummary } from '../template';
import { humanTime } from '../../core/dates';
import { DUR } from '../ui/tokens';
import { listKey } from '../../core/keys';
import type { Draft } from '../draft';
import { ruleShort, howMany } from '../labels';
import { G } from '../ui/glyphs';
import type { Hub } from '../../core/hub';

/**
 * The folder's "…": what's set once and rarely touched (a photo, its task template, the folders it
 * shows tasks from, where it lives), then archive and delete. Each row says what it's set to.
 */
function FolderMenu({ listId, onClose }: { listId: string; onClose: () => void }) {
  const hub = useHub();
  const { toast, openSheet } = useOverlays();
  const list = hub.list(listId);
  const addPhoto = useAddPhoto(`list:${listId}`);
  if (!list) return null;
  const photoN = hub.photosOf(`list:${listId}`).length;
  const shows = hub.shownIn(listId);
  return (
    <ActionSheet
      title={list.name}
      onClose={onClose}
      actions={[
        { icon: G.photo, title: photoN ? 'Add another photo' : 'Add a photo', sub: photoN ? howMany(photoN, 'photo') : undefined, run: () => void addPhoto() },
        {
          icon: G.template,
          title: 'Task template',
          sub: hasTemplate(list) ? templateSummary(hub, list.template) : 'How new tasks here start',
          run: () => openSheet((close) => <TemplateSheet listId={listId} onClose={close} />),
        },
        {
          icon: G.shows,
          title: 'Show tasks from…',
          sub: shows.length ? shows.map((l) => l.name).join(', ') : 'Other folders’ tasks, here too',
          run: () => openSheet((close) => <ShowsSheet listId={listId} onClose={close} />),
        },
        { icon: G.move, title: 'Move to…', run: () => openSheet((close) => <MoveFolderSheet listId={listId} onClose={close} />) },
        {
          icon: G.archive,
          title: 'Archive',
          run: () => {
            hub.updateList(listId, { archived: true });
            navigate({ name: 'lists' }, { replace: true });
            toast(`Archived ${list.name}`, { undo: () => hub.updateList(listId, { archived: false }) });
          },
        },
        {
          icon: G.delete,
          title: 'Delete folder',
          danger: true,
          hidden: !!list.owner && list.owner !== hub.meId,
          run: () => {
            const undo = hub.deleteList(listId);
            navigate({ name: 'lists' }, { replace: true });
            toast(`Deleted ${list.name}`, { undo });
          },
        },
      ]}
    />
  );
}

/** A template's day: how many days after it's added, and a time. */
function TemplateDayPanel({ listId }: { listId: string }) {
  const hub = useHub();
  const t = hub.list(listId)?.template ?? {};
  const days = [0, 1, 2, 3, 7, 14];
  return (
    <>
      <p className="panel__head">Due</p>
      <Options
        value={t.dueIn == null ? 'none' : String(t.dueIn)}
        options={[{ value: 'none', label: 'No date' }, ...days.map((n) => ({ value: String(n), label: dayIn(n) }))]}
        onPick={(v) => hub.setListTemplate(listId, { dueIn: v === 'none' ? null : Number(v) })}
      />
      <label className="tpltime">
        <Icon name={G.time} className="icon--sm" />
        <span>Time</span>
        <TimeField value={t.dueTime ?? null} onChange={(v) => hub.setListTemplate(listId, { dueTime: v })} />
        {t.dueTime ? (
          <GlyphButton icon={G.close} filled label="Any time" onClick={() => hub.setListTemplate(listId, { dueTime: null })} />
        ) : null}
      </label>
    </>
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
            icon: G.date,
            set: t.dueIn != null || !!t.dueTime,
            panel: () => <TemplateDayPanel listId={listId} />,
          },
          {
            key: 'tags',
            label: tl.label,
            icon: tl.lead ? undefined : G.tag,
            lead: tl.lead ? <TagMark icon={tl.lead} /> : undefined,
            set: tags.length > 0,
            panel: () => <TagPicker value={tags} onChange={(next) => hub.setListTemplate(listId, { tags: next })} />,
          },
          {
            key: 'steps',
            label: t.steps?.length ? `Subtasks ${t.steps.length}` : 'Subtasks',
            icon: G.subtask,
            set: !!t.steps?.length,
            panel: () => (
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
            ),
          },
          {
            key: 'notes',
            label: 'Note',
            icon: G.note,
            set: !!t.notes,
            panel: () => <TemplateText value={t.notes ?? ''} placeholder="A note each task starts with" label="Its note" rows={3} onSave={(v) => hub.setListTemplate(listId, { notes: v.trim() || null })} />,
          },
          ...(t.remind != null
            ? [
                {
                  key: 'again',
                  label: t.nag ? `Again ${ruleShort(t.nag).toLowerCase()}` : 'Again until done',
                  icon: G.nag,
                  set: !!t.nag,
                  panel: () => <RepeatPanel nag rule={t.nag ?? null} defaultFrom="schedule" onChange={(nag) => hub.setListTemplate(listId, { nag })} />,
                },
              ]
            : []),
        ]}
      />
      {list.template ? (
        <TextButton
          style={{ marginTop: 18 }}
          onClick={() => {
            hub.setListTemplate(listId, null);
          }}
        >
          Start plain again
        </TextButton>
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
  if (!list) return null;
  const on = new Set(list.shows ?? []);
  return (
    <Sheet onClose={onClose} title={`Show in ${list.name}`}>
      <p className="sheet__lede">Their tasks show here too, each folder in its own group. {list.name}’s own tasks stay where they are.</p>
      <PlaceTree
        excludeList={listId}
        // The switch leads its row, so it steps in with each level: what's inside what reads at a glance.
        lead={(l) => <Switch on={on.has(l.id)} label={`Show ${l.name}’s tasks in ${list.name}`} onChange={(v) => hub.setShows(listId, l.id, v)} />}
        onPick={(p) => p && hub.setShows(listId, p.listId, !on.has(p.listId))}
      />
    </Sheet>
  );
}

/** Where a folder sits: the top of Folders, or inside another (never inside its own insides). */
function MoveFolderSheet({ listId, onClose }: { listId: string; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const list = hub.list(listId);
  if (!list) return null;
  const here = hub.parentOf(listId)?.id ?? null;
  const go = (to: string | null) => {
    if (to === here) return onClose();
    const was = here;
    hub.setListParent(listId, to);
    onClose();
    toast(to ? `${list.name} is in ${hub.list(to)?.name ?? 'there'}` : `${list.name} is back in Folders`, {
      undo: () => hub.setListParent(listId, was),
    });
  };
  return (
    <Sheet onClose={onClose} title={`Move ${list.name}`}>
      <PlaceTree
        label="Where it sits"
        excludeList={listId}
        current={here ? { listId: here, parentId: null } : null}
        root={{ label: 'Folders', icon: G.folders, hint: 'the top', here: here === null }}
        onPick={(p) => go(p?.listId ?? null)}
      />
    </Sheet>
  );
}

/** The folder's settings button. */
function FolderMenuButton({ listId }: { listId: string }) {
  const { openSheet } = useOverlays();
  return <IconButton icon={G.more} label="Folder settings" onClick={() => openSheet((close) => <FolderMenu listId={listId} onClose={close} />)} />;
}

/**
 * A folder's card, the folder, holding its own settings, nothing under it: its name (edit in
 * place), what's open, and down its right edge the pin to the bar, who sees it, and its icon.
 * A tap on the card itself changes its colour. Each opens its picker right under the card.
 */
function FolderHero({ list, sub }: { list: List; sub: ReactNode }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const [open, setOpen] = useState<'icon' | 'color' | 'vis' | null>(null);
  const toggle = (k: 'icon' | 'color' | 'vis') => setOpen(open === k ? null : k);
  const pinned = pinsOf(hub).includes(listKey(list.id));
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
    const now = togglePin(hub, listKey(list.id));
    haptic(now ? 'tick' : 'select');
    toast(now ? 'Added to the bar' : 'Taken out of the bar', { undo: () => setPins(hub, before) });
  };
  const setVis = (v: { visibility: List['visibility']; owner: string | null }) => {
    if (v.visibility === 'private' && list.visibility !== 'private' && partner) toast(`Hidden from ${partner.name}`);
    else if (partner && v.owner === partner.id && list.owner !== partner.id) toast(`${list.name} is ${partner.name}’s now`);
    hub.setListVisibility(list.id, v.visibility, v.owner);
    setOpen(null);
  };
  return (
    <>
      <div className={`hero hero--folder ${open === 'color' ? 'is-picking' : ''}`} style={lineVars(list.color)} onClick={onCard}>
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
            <Icon name={G.pinToBar} className="icon--sm" />
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
          <Swatches value={list.color} onChange={(color) => hub.updateList(list.id, { color })} />
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
const canSetListVis = (hub: Hub, list: List) => !list.owner || list.owner === hub.meId || list.visibility === 'visible';

/** A folder on my Today, as a task's star: filled while its open tasks show there. */
function TodayStar({ listId }: { listId: string }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const onHome = pinnedFolders(hub).includes(listId) && visibleHome(hub).some((x) => x.key === listKey(listId));
  return (
    <StarButton
      on={onHome}
      onLabel="On your Today"
      offLabel="Put it on your Today"
      onChange={(on) => {
        if (!on) {
          hideHome(hub, listKey(listId));
          toast('Off your Today', { undo: () => showHome(hub, listKey(listId)) });
        } else if (showHome(hub, listKey(listId))) toast('On your Today', { undo: () => hideHome(hub, listKey(listId)) });
        else toast(`Today shows up to ${MAX_HOME_FOLDERS} folders. Take one off it first (Edit Today).`);
      }}
    />
  );
}

/** The folder's header buttons: its star, search it, its "…". */
function FolderActions({ listId }: { listId: string }) {
  return (
    <>
      <TodayStar listId={listId} />
      <IconButton icon={G.search} label="Search this folder" onClick={() => openSearch(listId)} />
      <FolderMenuButton listId={listId} />
    </>
  );
}

/** What my partner just added (or brought back, or marked urgent) here: it glows for a moment. */
function usePartnerNews(open: Item[]): Set<string> {
  const hub = useHub();
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
    const t = setTimeout(() => setFlash(new Set()), DUR.flash);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return flash;
}

/**
 * Any folder, the one way: its folder up top, then a lens over what's in it (who, urgent, its
 * tags) beside how it's looked at (list, cards, by tag); Again? (things done here before, due
 * again); the tray of things just done; the Urgent card; the things themselves; the folders
 * inside; and what was cleared. Shopping is just a folder looked at by tag.
 */
export function FolderScreen({ id }: { id: string }) {
  const hub = useHub();
  const prefs = usePrefs();
  const { openSheet } = useOverlays();
  const list = hub.list(id);
  const nested = hub.nestedLists(id);
  // A folder shows everything inside it; the lens narrows it to one folder.
  const inside = nested.length > 0;
  const view = hub.viewOf(list);
  const v = folderView(hub, id, inside, view, prefs.dismissed);
  const filter = useFilter(listKey(id));
  const flash = usePartnerNews(v.open);
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

  const keep = (i: Item) => filter.test(i, true);
  const groups = v.groups.map((g) => ({ ...g, items: g.items.filter(keep) })).filter((g) => g.items.length || g.listId === id || !filter.active);
  const urgent = v.urgent.filter(keep);
  const shownN = groups.reduce((n, g) => n + g.items.length, 0);
  const lists = new Set(v.open.map((i) => i.listId));
  const parent = hub.parentOf(id);
  const n = v.open.length;
  // Everything else done is just Done.
  const done = [...v.tray, ...v.cleared].sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));

  const again = (name: string) => {
    const res = hub.add(inside ? hub.placeFor(name, id) : id, { title: name });
    markFresh(res.id);
    playSound('add');
  };

  return (
    <div className="folderpage">
      <Band
        onBack={() => back(parent ? { name: 'list', id: parent.id } : { name: 'lists' })}
        actions={<FolderActions listId={id} />}
        mini={list.name}
        crumbs={<PathCrumbs steps={folderPath(hub, id)} />}
      >
        <FolderHero list={list} sub={n ? `${n} open` : v.stocked.length ? `${v.stocked.length} in stock` : done.length ? 'All done' : 'Empty'} />
      </Band>
      <div className="column">
        {/* Its folders first, then its tasks */}
        <SubFolders list={list} />
        {n ? (
          <Lens filter={filter} items={v.open} lists={v.lists.length > 1 ? v.lists : undefined}>
            <ViewToggle listId={id} />
          </Lens>
        ) : !done.length && !v.stocked.length && !hub.subLists(id).length ? (
          <p className="hint">Nothing here yet. The + adds the first thing.</p>
        ) : null}

        {!filter.active && v.again.length ? (
          <div className="buyagain">
            <p className="inline__prompt">Again?</p>
            <div className="tokens tokens--scroll">
              {v.again.map((s) => (
                <span key={s.key} className="token token--split" title={cadenceLabel(s.avgDays)}>
                  <button type="button" onClick={() => again(s.name)}>
                    <Icon name={G.add} />
                    <span dir="auto">{s.name}</span>
                  </button>
                  <button type="button" className="token__x" aria-label={`Not now: ${s.name}`} onClick={() => setPrefs({ dismissed: { ...prefs.dismissed, [s.key]: s.lastAt } })}>
                    <Icon name={G.close} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <Photos on={`list:${id}`} />

        <FolderItems
          pageId={id}
          groups={groups}
          urgent={urgent}
          cards={view === 'cards'}
          draggable
          showList={lists.size > 1 && (view === 'tags' || !inside)}
          flash={flash}
        />
        {filter.active && n && !shownN ? <p className="hint">Nothing here with this filter.</p> : null}

        {v.stocked.length ? (
          // Kept stocked, with enough in: not tasks. At their buy-at count they join the tasks above.
          // Folded until it's opened (this device remembers, per folder).
          <Disclosure
            title="In stock"
            count={v.stocked.length}
            open={prefs.unfolded.includes(`stock:${id}`)}
            onToggle={(open) => {
              const k = `stock:${id}`;
              const now = getPrefs().unfolded.filter((x) => x !== k);
              setPrefs({ unfolded: open ? [...now, k].slice(-200) : now });
            }}
          >
            <ul className="rows">
              {v.stocked.map((i) => (
                <ItemRow key={i.id} item={i} showList={lists.size > 1} />
              ))}
            </ul>
          </Disclosure>
        ) : null}

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
  // Where it would land while over a step (undefined: not over one), for the lifted chip.
  const over = useRef<string | null | undefined>(undefined);
  return useMemo(() => {
    const mark = dropMarks();
    const light = (el: HTMLElement | null) => mark({ into: el });
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
        toast(t.to ? `${l.name} is in ${hub.list(t.to)?.name ?? 'there'}` : `${l.name} is back in Folders`, { undo: () => hub.setListParent(id, was) });
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

/** The folders inside a folder: open one, drag to reorder. (The + makes another: "Folder inside …".) */
function SubFolders({ list }: { list: List }) {
  const hub = useHub();
  const subs = hub.subLists(list.id);
  const pins = pinsOf(hub);
  // Drag one down onto the bar: it's pinned there, like a folder from the Folders page. Or up
  // onto the path: it moves there.
  const toBar = useBarDrop();
  const crumbs = useCrumbDrop(list.id);
  const outside = useMemo(() => either(toBar.folders, crumbs.target), [toBar, crumbs]);
  if (!subs.length) return null;
  return (
    <section className="subfolders" aria-label={`Inside ${list.name}`}>
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
            return <DropChip label={l.name} />;
          const t = away ? barTabOf(hub, listKey(id)) : undefined;
          return t ? <TabChip t={t} /> : l ? <FolderCard list={l} /> : null;
        }}
      >
        <div className="foldergrid">
          {subs.map((l, i) => (
            <SortableFolder key={l.id} list={l} arranging={false} pins={pins} index={i} />
          ))}
        </div>
      </Sortable>
    </section>
  );
}

import { openSearch } from '../search';
import { useState, type ReactNode } from 'react';
import type { List } from '../../core/model';
import { useAddAction } from '../addAction';
import { Children } from '../components/Children';
import { OptRow } from '../components/pickers';
import { ProjectFields, type ProjectLook } from '../components/ProjectFields';
import { CardIcon, IconPicker } from '../components/IconPicker';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { useHub } from '../context';
import { back, navigate } from '../router';
import { AutoTitle } from '../ui/AutoTitle';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, Empty, IconButton, lineVars, ListBullet, NewButton, Seg } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { Sortable } from '../ui/Sortable';
import { folderLean, NewProjectSheet, ProjectCard, SortableProject } from './Lists';
import { coveredByTab, pinsOf, setPins, togglePin } from '../tabs';
import { listVisLabel } from '../privacy';
import { openCount } from '../views';
import { Shopping } from './Shopping';

/** The project's "…": the rare things only. Everything else is edited in place on its page. */
export function ListMenu({ listId, onClose }: { listId: string; onClose: () => void }) {
  const hub = useHub();
  const { toast, openSheet } = useOverlays();
  const list = hub.list(listId);
  if (!list) return null;
  const mineToChange = !list.owner || list.owner === hub.meId;
  return (
    <Sheet onClose={onClose} title={list.name}>
      <div className="group">
        {list.kind === 'tasks' ? (
          <OptRow
            icon="refresh"
            title="Uncheck all"
            onClick={() => {
              const undo = hub.uncheckAll(listId);
              onClose();
              toast('Everything unticked, ready to reuse', { action: { label: 'Undo', run: undo } });
            }}
          />
        ) : null}
        <OptRow
          icon="move"
          title={hub.parentOf(listId) ? 'Move to…' : 'Put inside…'}
          onClick={() => {
            onClose();
            openSheet((close) => <MoveProjectSheet listId={listId} onClose={close} />);
          }}
        />
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
            title="Delete project"
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

/** Where a project sits: the top of Projects, or inside another (never inside its own insides). */
function MoveProjectSheet({ listId, onClose }: { listId: string; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const list = hub.list(listId);
  if (!list) return null;
  const here = hub.parentOf(listId)?.id ?? null;
  const inside = new Set(hub.nestedLists(listId).map((l) => l.id));
  const tree: Array<{ l: List; depth: number }> = [];
  const walk = (ls: List[], depth: number) => {
    for (const l of ls) {
      if (l.id === listId || inside.has(l.id)) continue;
      tree.push({ l, depth });
      walk(hub.subLists(l.id), depth + 1);
    }
  };
  walk(hub.topLists(), 0);
  const go = (to: string | null) => {
    if (to === here) return onClose();
    const was = here;
    hub.setListParent(listId, to);
    onClose();
    toast(to ? `${list.name} is in ${hub.list(to)?.name ?? 'there'}` : `${list.name} is back in Projects`, {
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
              <span>Projects</span>
              <span className="place__hint">the top</span>
            </button>
          </div>
        </li>
        {tree.map(({ l, depth }) => (
          <li key={l.id}>
            <div className="place__row" style={{ paddingInlineStart: 6 + (depth + 1) * 18 }}>
              <button type="button" className="place__pick" aria-current={here === l.id || undefined} disabled={here === l.id} onClick={() => go(l.id)}>
                <ListBullet list={l} size="xs" />
                <span dir="auto">{l.name}</span>
                {here === l.id ? <span className="place__hint">here now</span> : null}
              </button>
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
  return <IconButton icon="more" label="Project settings" onClick={() => openSheet((close) => <ListMenu listId={listId} onClose={close} />)} />;
}

/** A project's one color moment: its name on a card of its color. Tap the name to rename it. */
/**
 * A project's one colour moment: a folder, its tab on top, as on Projects and in New project.
 * Its name is edited in place; its icon sits low on the card, and a tap opens the picker under it.
 */
export function ProjectHero({ list, sub, stat, children }: { list: List; sub: ReactNode; stat?: ReactNode; children?: ReactNode }) {
  const hub = useHub();
  const [picking, setPicking] = useState(false);
  return (
    <>
      <div className="hero hero--project hero--folder" style={lineVars(list.color)}>
        <div className="hero__top">
          <h1 className="hero__title">
            <AutoTitle value={list.name} onSave={(name) => hub.updateList(list.id, { name })} label="Project name" />
          </h1>
          {stat !== undefined ? <span className="hero__stat num">{stat}</span> : null}
        </div>
        <div className="hero__foot">
          <p className="hero__sub">{sub}</p>
          <CardIcon icon={list.icon} open={picking} onToggle={() => setPicking(!picking)} />
        </div>
        {children}
      </div>
      {picking ? (
        <div className="panel hero__pick">
          <IconPicker
            value={list.icon}
            color={list.color}
            onChange={(icon) => {
              hub.updateList(list.id, { icon });
              setPicking(false);
            }}
          />
        </div>
      ) : null}
    </>
  );
}

/** Ours, mine, or my person's-but-in-sight: either of us can say whose it is. Only Only me is the owner's alone. */
const canSetListVis = (hub: ReturnType<typeof useHub>, list: List) => !list.owner || list.owner === hub.meId || list.visibility === 'visible';

/** " · Hila's" on the hero, only when the privacy chip isn't there to say whose it is. */
export const heroVis = (hub: ReturnType<typeof useHub>, list: List): string => (canSetListVis(hub, list) ? '' : ` · ${listVisLabel(hub, list)}`);

/** Under a project's hero, like an item's: Color, Icon, who sees it and In bar, changed in place. */
export function ProjectChips({ list }: { list: List }) {
  const hub = useHub();
  const { toast } = useOverlays();
  // The one Shopping project is its tab: in the bar when that tab is.
  const tab = list.kind === 'shopping' ? 'shop' : null;
  const covered = !!tab && coveredByTab(hub, list.id, pinsOf(hub));
  const pinned = covered || pinsOf(hub).includes(`l:${list.id}`);
  const partner = hub.partner();
  const onChange = (p: Partial<ProjectLook>) => {
    if (p.color) hub.updateList(list.id, { color: p.color });
    if (p.icon !== undefined) hub.updateList(list.id, { icon: p.icon });
    if (p.visibility) {
      if (p.visibility === 'private' && list.visibility !== 'private' && partner) toast(`Hidden from ${partner.name}`);
      else if (partner && p.owner === partner.id && list.owner !== partner.id) toast(`${list.name} is ${partner.name}’s now`);
      hub.setListVisibility(list.id, p.visibility, p.owner);
    }
    if (p.pinned !== undefined) {
      const before = pinsOf(hub);
      const now = togglePin(hub, covered && tab ? tab : `l:${list.id}`);
      toast(now ? 'Added to the bar' : 'Taken out of the bar', { action: { label: 'Undo', run: () => setPins(hub, before) } });
    }
  };
  return <ProjectFields value={{ color: list.color, icon: list.icon, visibility: list.visibility, owner: list.owner, pinned }} onChange={onChange} canVis={canSetListVis(hub, list)} noIcon />;
}

export function ListScreen({ id }: { id: string }) {
  const hub = useHub();
  const list = hub.list(id);
  if (list?.kind === 'shopping') return <Shopping listId={id} />;
  return <TaskProject id={id} />;
}

/** The project's "…" and its New, for the header. */
export function ProjectActions({ listId, label, onNew, menu = true }: { listId: string; label: string; onNew: () => void; menu?: boolean }) {
  return (
    <>
      <IconButton icon="search" label="Search this project" onClick={() => openSearch(listId)} />
      {menu ? <ProjectMenuButton listId={listId} /> : null}
      <NewButton label={label} onClick={onNew} />
    </>
  );
}

function TaskProject({ id }: { id: string }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const list = hub.list(id);
  const label = `Add to ${list?.name ?? 'project'}`;
  const openNew = () => openSheet((close) => <QuickAddSheet onClose={close} listId={id} />);
  useAddAction(openNew, label);
  const [showAll, setShowAll] = useShowAll(id);

  if (!list) {
    return (
      <>
        <Band title="Not here" onBack={() => back({ name: 'lists' })} />
        <Empty title="This project is gone" text="It may have been deleted or made private." />
      </>
    );
  }

  const n = openCount(hub, id);
  const all = hub.children(id, null);
  const done = all.filter((i) => i.done).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : null;
  const parent = hub.parentOf(id);
  const nested = hub.nestedLists(id);
  const everything = nested.length > 0 && showAll;
  const nAll = n + nested.reduce((sum, l) => sum + openCount(hub, l.id), 0);

  return (
    <>
      <Band
        onBack={() => back(parent ? { name: 'list', id: parent.id } : { name: 'lists' })}
        actions={<ProjectActions listId={id} label={label} onNew={openNew} />}
        mini={list.name}
      >
        <ProjectHero
          list={list}
          stat={pct !== null && done ? `${pct}%` : undefined}
          sub={
            <>
              {parent ? <InParent parent={parent} /> : null}
              {`${n ? `${n} open` : all.length ? 'All done' : 'Empty'}${heroVis(hub, list)}`}
            </>
          }
        />
      </Band>
      <div className="column">
        <ProjectChips list={list} />
        {nested.length ? (
          <div className="filter filter--top">
            <Seg
              label="Which tasks"
              value={everything ? 'all' : 'here'}
              onChange={(v) => setShowAll(id, v === 'all')}
              options={[
                { value: 'here', label: <FilterCount text="Here" n={n} /> },
                { value: 'all', label: <FilterCount text="Everything inside" n={nAll} /> },
              ]}
            />
          </div>
        ) : null}
        <Children listId={id} parentId={null} />
        {everything ? <AllInside lists={nested} /> : <SubProjects list={list} />}
      </div>
    </>
  );
}

function FilterCount({ text, n }: { text: string; n: number }) {
  return (
    <>
      <span dir="auto">{text}</span>
      {n ? <span className="filter__n num">{n}</span> : null}
    </>
  );
}

/** The folder it sits in, on a nested project's hero: a way up. */
function InParent({ parent }: { parent: List }) {
  return (
    <button type="button" className="hero__up" onClick={() => navigate({ name: 'list', id: parent.id })}>
      <Icon name="folder" className="icon--xs" />
      <span dir="auto">{parent.name}</span>
    </button>
  );
}

/** Every project inside, its tasks under its own name, as if you opened each in turn. */
function AllInside({ lists }: { lists: List[] }) {
  const hub = useHub();
  return (
    <>
      {lists.map((l) => (
        <section key={l.id} className="inside" style={lineVars(l.color)}>
          <button type="button" className="inside__head" onClick={() => navigate({ name: 'list', id: l.id })}>
            <ListBullet list={l} size="sm" />
            <span className="inside__name" dir="auto">
              {hub
                .listPath(l.id)
                .slice(1)
                .map((p) => `${p.name} › `)
                .join('')}
              {l.name}
            </span>
            <Icon name="chevron-right" className="icon--xs" />
          </button>
          {hub.children(l.id, null).length ? <Children listId={l.id} parentId={null} /> : <p className="inside__none">Nothing here yet</p>}
        </section>
      ))}
    </>
  );
}

/** The folders inside a project, after its own tasks: open one, drag to reorder, or make another. */
function SubProjects({ list }: { list: List }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const subs = hub.subLists(list.id);
  const pins = pinsOf(hub);
  const make = () => openSheet((close) => <NewProjectSheet onClose={close} parentId={list.id} />);
  if (!subs.length) {
    return (
      <p className="editlink">
        <button type="button" className="textbtn" onClick={make}>
          Add a project inside
          <Icon name="folder" className="icon--xs" />
        </button>
      </p>
    );
  }
  return (
    <section className="subprojects" aria-label={`Inside ${list.name}`}>
      <Sortable
        ids={subs.map((l) => l.id)}
        onMove={(next, id) => hub.moveList(id, next[next.indexOf(id) + 1] ?? null)}
        layout="grid"
        lean={folderLean}
        label={(id) => hub.list(id)?.name ?? ''}
        renderOverlay={(id) => {
          const l = hub.list(id);
          return l ? <ProjectCard list={l} /> : null;
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
            <span>Project inside</span>
          </button>
        </div>
      </Sortable>
    </section>
  );
}

/** Here only, or everything inside too: remembered per project, on this device. */
const ALL_KEY = 'gila-hub:show-inside';
function readShowAll(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ALL_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function useShowAll(id: string): [boolean, (id: string, on: boolean) => void] {
  const [ids, setIds] = useState(readShowAll);
  const set = (key: string, on: boolean) => {
    const next = on ? [...new Set([...ids, key])] : ids.filter((x) => x !== key);
    setIds(next);
    try {
      localStorage.setItem(ALL_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
  };
  return [ids.includes(id), set];
}

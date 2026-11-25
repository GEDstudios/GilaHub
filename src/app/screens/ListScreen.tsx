import { openSearch } from '../search';
import type { ReactNode } from 'react';
import type { List } from '../../core/model';
import { useAddAction } from '../addAction';
import { Children } from '../components/Children';
import { OptRow } from '../components/pickers';
import { ProjectFields, type ProjectLook } from '../components/ProjectFields';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { useHub } from '../context';
import { back, navigate } from '../router';
import { AutoTitle } from '../ui/AutoTitle';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, Empty, IconButton, lineVars, NewButton } from '../ui/primitives';
import { coveredByTab, pinsOf, setPins, togglePin } from '../tabs';
import { listVisLabel } from '../privacy';
import { openCount } from '../views';
import { Chores } from './Chores';
import { Shopping } from './Shopping';

/** The project's "…": the rare things only. Everything else is edited in place on its page. */
export function ListMenu({ listId, onClose }: { listId: string; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
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

/** The project's settings button. */
export function ProjectMenuButton({ listId }: { listId: string }) {
  const { openSheet } = useOverlays();
  return <IconButton icon="more" label="Project settings" onClick={() => openSheet((close) => <ListMenu listId={listId} onClose={close} />)} />;
}

/** A project's one color moment: its name on a card of its color. Tap the name to rename it. */
export function ProjectHero({ list, sub, stat, children }: { list: List; sub: ReactNode; stat?: ReactNode; children?: ReactNode }) {
  const hub = useHub();
  return (
    <div className="hero hero--project" style={lineVars(list.color)}>
      <div className="hero__top">
        <h1 className="hero__title">
          <AutoTitle value={list.name} onSave={(name) => hub.updateList(list.id, { name })} label="Project name" />
        </h1>
        {stat !== undefined ? <span className="hero__stat num">{stat}</span> : null}
      </div>
      <p className="hero__sub">{sub}</p>
      {children}
    </div>
  );
}

const canSetListVis = (hub: ReturnType<typeof useHub>, list: List) => !list.owner || list.owner === hub.meId;

/** " · Hila's" on the hero, only when the privacy chip isn't there to say whose it is. */
export const heroVis = (hub: ReturnType<typeof useHub>, list: List): string => (canSetListVis(hub, list) ? '' : ` · ${listVisLabel(hub, list)}`);

/** Under a project's hero, like an item's: Color, Icon, who sees it and In bar, changed in place. */
export function ProjectChips({ list }: { list: List }) {
  const hub = useHub();
  const { toast } = useOverlays();
  // The one Chores (or Shopping) project is its tab: in the bar when that tab is.
  const tab = list.kind === 'shopping' ? 'shop' : list.kind === 'chores' ? 'chores' : null;
  const covered = !!tab && coveredByTab(hub, list.id, pinsOf(hub));
  const pinned = covered || pinsOf(hub).includes(`l:${list.id}`);
  const partner = hub.partner();
  const onChange = (p: Partial<ProjectLook>) => {
    if (p.color) hub.updateList(list.id, { color: p.color });
    if (p.icon !== undefined) hub.updateList(list.id, { icon: p.icon });
    if (p.visibility) {
      if (p.visibility === 'private' && list.visibility !== 'private' && partner) toast(`Hidden from ${partner.name}`);
      hub.setListVisibility(list.id, p.visibility);
    }
    if (p.pinned !== undefined) {
      const before = pinsOf(hub);
      const now = togglePin(hub, covered && tab ? tab : `l:${list.id}`);
      toast(now ? 'Added to the bar' : 'Taken out of the bar', { action: { label: 'Undo', run: () => setPins(hub, before) } });
    }
  };
  return <ProjectFields value={{ color: list.color, icon: list.icon, visibility: list.visibility, pinned }} onChange={onChange} canVis={canSetListVis(hub, list)} />;
}

export function ListScreen({ id }: { id: string }) {
  const hub = useHub();
  const list = hub.list(id);
  if (list?.kind === 'shopping') return <Shopping listId={id} />;
  if (list?.kind === 'chores') return <Chores listId={id} />;
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

  return (
    <>
      <Band onBack={() => back({ name: 'lists' })} actions={<ProjectActions listId={id} label={label} onNew={openNew} />} mini={list.name}>
        <ProjectHero
          list={list}
          stat={pct !== null && done ? `${pct}%` : undefined}
          sub={`${n ? `${n} open` : all.length ? 'All done' : 'Empty'}${heroVis(hub, list)}`}
        />
      </Band>
      <div className="column">
        <ProjectChips list={list} />
        <Children listId={id} parentId={null} />
      </div>
    </>
  );
}

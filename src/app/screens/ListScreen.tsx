import { useState, type ReactNode } from 'react';
import type { List, Visibility } from '../../core/model';
import { useAddAction } from '../addAction';
import { Children } from '../components/Children';
import { Options } from '../components/editors';
import { OptRow, Swatches } from '../components/pickers';
import { QuickAdd } from '../components/QuickAdd';
import { useHub } from '../context';
import { back, navigate } from '../router';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, Empty, IconButton, lineVars, Switch } from '../ui/primitives';
import { MAX_PINS, pinsOf, togglePin } from '../tabs';
import { openCount } from '../views';
import { Chores } from './Chores';
import { visLabel } from './Lists';
import { Shopping } from './Shopping';

export function ListMenu({ listId, onClose }: { listId: string; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const list = hub.list(listId);
  const [name, setName] = useState(list?.name ?? '');
  if (!list) return null;
  const pinned = pinsOf(hub).includes(`l:${listId}`);
  const mineToChange = !list.owner || list.owner === hub.meId;
  const partner = hub.partner()?.name ?? 'your partner';
  const save = () => {
    if (name.trim() && name.trim() !== list.name) hub.updateList(listId, { name: name.trim() });
  };
  return (
    <Sheet onClose={() => (save(), onClose())} title="Project">
      <div className="ccard ccard--md ccard--edit" style={lineVars(list.color)}>
        <input className="ccard__input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} aria-label="Name" />
        <span className="ccard__sub">{visLabel(hub, list)}</span>
      </div>
      <div className="choose">
        <span className="choose__label">Color</span>
        <Swatches value={list.color} onChange={(c) => hub.updateList(listId, { color: c })} />
      </div>
      {mineToChange ? (
        <div className="choose">
          <span className="choose__label">Who sees it</span>
          <Options
            value={list.visibility}
            onPick={(vis) => {
              if (vis === 'private' && list.visibility !== 'private' && hub.partner()) toast(`Hidden from ${partner}`);
              hub.setListVisibility(listId, vis as Visibility);
            }}
            options={[
              { value: 'shared', label: 'Ours', icon: 'ours' },
              { value: 'visible', label: 'Mine', icon: 'mine' },
              { value: 'private', label: 'Only me', icon: 'lock' },
            ]}
          />
        </div>
      ) : null}
      <div className="group" style={{ marginTop: 24 }}>
        <OptRow
          icon="pin"
          title="Show in bottom bar"
          trail={
            <Switch
              on={pinned}
              label="Show in bottom bar"
              onChange={() => {
                if (!togglePin(hub, `l:${listId}`) && !pinned) toast(`The bar has room for ${MAX_PINS}. Remove one in Settings.`);
              }}
            />
          }
        />
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

/** A project's one color moment: its name on a card of its color. */
export function ProjectHero({ list, sub, stat, children }: { list: List; sub: ReactNode; stat?: ReactNode; children?: ReactNode }) {
  return (
    <div className="hero" style={lineVars(list.color)}>
      <div className="hero__top">
        <h1 className="hero__title" dir="auto">
          {list.name}
        </h1>
        {stat !== undefined ? <span className="hero__stat num">{stat}</span> : null}
      </div>
      <p className="hero__sub">{sub}</p>
      {children}
    </div>
  );
}

export function ListScreen({ id }: { id: string }) {
  const hub = useHub();
  const list = hub.list(id);
  if (list?.kind === 'shopping') return <Shopping listId={id} />;
  if (list?.kind === 'chores') return <Chores listId={id} />;
  return <TaskProject id={id} />;
}

function TaskProject({ id }: { id: string }) {
  const hub = useHub();
  const list = hub.list(id);
  const [freshId, setFreshId] = useState<string | null>(null);
  useAddAction(() => document.querySelector<HTMLInputElement>('.quickadd input')?.focus());

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
      <Band onBack={() => back({ name: 'lists' })} actions={<ProjectMenuButton listId={id} />} mini={list.name}>
        <ProjectHero
          list={list}
          stat={pct !== null && done ? `${pct}%` : undefined}
          sub={
            <>
              {n ? `${n} open` : all.length ? 'All done' : 'Empty'}
              {` · ${visLabel(hub, list)}`}
            </>
          }
        />
      </Band>
      <div className="column">
        <Children listId={id} parentId={null} freshId={freshId} />
        <QuickAdd listId={id} onAdded={setFreshId} />
      </div>
    </>
  );
}

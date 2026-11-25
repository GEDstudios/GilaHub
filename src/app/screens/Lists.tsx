import { useState, type CSSProperties } from 'react';
import { PROJECT_TEMPLATES } from '../../core/actions';
import { suggestIcon } from '../../core/projectIcons';
import type { List, ListKind, Visibility } from '../../core/model';
import { useAddAction } from '../addAction';
import { ProjectFields, type ProjectLook } from '../components/ProjectFields';
import { useHub } from '../context';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, Disclosure, lineVars, ListBullet, NewButton } from '../ui/primitives';
import { SyncBadge } from '../components/SyncBadge';
import { Glyph } from '../ui/ProjectMark';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { LIST_VIS, listVisLabel, visLabel } from '../privacy';
import { togglePin } from '../tabs';
import { openCount } from '../views';

const KIND: Record<ListKind, string> = { tasks: 'Tasks', shopping: 'Shopping', chores: 'Chores' };

/** A name on a card of its color, a few ideas to start from, then the same chips as a project's page. */
export function NewProjectSheet({ onClose, initial }: { onClose: () => void; initial?: Partial<{ visibility: Visibility; kind: ListKind }> }) {
  const hub = useHub();
  const [name, setName] = useState('');
  const [look, setLook] = useState<ProjectLook>(() => ({
    kind: initial?.kind ?? 'tasks',
    flavor: 'grocery',
    color: hub.freshColor(),
    // Unset until picked: the name suggests one as it's typed.
    icon: undefined,
    visibility: initial?.visibility ?? 'shared',
    pinned: false,
  }));
  const kind = look.kind ?? 'tasks';
  const icon = look.icon ?? suggestIcon(name, kind, look.flavor, hub.lists().at(-1)?.icon);
  const taken = new Set(hub.lists().map((l) => l.name.toLowerCase()));
  const starts = PROJECT_TEMPLATES.filter((t) => !taken.has(t.name.toLowerCase())).slice(0, 4);

  const create = () => {
    if (!name.trim()) return;
    const id = hub.createList({ name, kind, color: look.color, icon, flavor: kind === 'shopping' ? look.flavor : undefined, visibility: look.visibility });
    if (look.pinned) togglePin(hub, `l:${id}`);
    onClose();
    navigate({ name: 'list', id });
  };

  return (
    <Sheet onClose={onClose} title="New project">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <div className="ccard ccard--lg ccard--edit" style={lineVars(look.color)}>
          <span className="ccard__top">
            <input className="ccard__input" dir="auto" placeholder="Name it" value={name} onChange={(e) => setName(e.target.value)} data-autofocus aria-label="Project name" />
            {icon ? <Glyph icon={icon} className="ccard__glyph" /> : null}
          </span>
          <span className="ccard__sub">
            {KIND[kind]} · {visLabel(LIST_VIS[look.visibility])}
          </span>
        </div>

        {!name && starts.length ? (
          <div className="tokens">
            {starts.map((t) => (
              <button
                key={t.key}
                type="button"
                className="token"
                onClick={() => {
                  setName(t.name);
                  setLook((l) => ({ ...l, kind: t.kind, flavor: t.flavor ?? l.flavor, visibility: t.visibility ?? l.visibility, icon: t.icon }));
                }}
              >
                <Icon name="plus" />
                {t.name}
              </button>
            ))}
          </div>
        ) : null}

        <ProjectFields value={{ ...look, icon }} onChange={(p) => setLook((l) => ({ ...l, ...p }))} canVis withKind />

        <button type="submit" className="btn btn--block" style={{ marginTop: 26 }} disabled={!name.trim()}>
          Create project
        </button>
      </form>
    </Sheet>
  );
}

/** A small, stable tilt per project, so the cards sit like real folders. */
export function tilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return [-2.2, -1.4, -0.6, 0.8, 1.5, 2.3][Math.abs(h) % 6];
}

/** Drag a folder to reorder projects (a long press on phones). */
function SortableProject({ list }: { list: List }) {
  const s = useSortableItem(list.id);
  return (
    <div ref={s.ref} className={`projslot ${s.className}`} style={{ ...s.style, '--tilt': `${tilt(list.id)}deg` } as CSSProperties} {...s.props}>
      <ProjectCard list={list} />
    </div>
  );
}

/** A folder lifts with its own tilt, plus 3deg, and lands back at its tilt. */
const folderLean = (id: string) => ({ rest: tilt(id) + 3, land: tilt(id) });

function ProjectCard({ list }: { list: List }) {
  const hub = useHub();
  const n = openCount(hub, list.id);
  return (
    <button
      type="button"
      className="ccard ccard--md projcard"
      style={{ ...lineVars(list.color), ['--tilt' as string]: `${tilt(list.id)}deg` }}
      onClick={() => navigate({ name: 'list', id: list.id })}
      data-drag
    >
      <span className="ccard__top">
        <span className="ccard__title projcard__name" dir="auto">
          {list.name}
        </span>
        {list.icon ? <Glyph icon={list.icon} className="ccard__glyph" /> : null}
      </span>
      <span className="ccard__sub">
        {list.visibility === 'private' ? <Icon name="lock" className="ccard__lock" /> : null}
        {n ? `${n} open` : 'All clear'}
        {list.visibility !== 'shared' ? ` · ${listVisLabel(hub, list)}` : ''}
      </span>
    </button>
  );
}

export function Lists() {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const lists = hub.lists();
  const newProject = () => openSheet((close) => <NewProjectSheet onClose={close} />);
  useAddAction(newProject, 'New project');

  const archived = hub.store.all('list').filter((l) => l.archived);
  const onMove = (next: string[], id: string) => hub.moveList(id, next[next.indexOf(id) + 1] ?? null);

  return (
    <>
      <Band top={<SyncBadge />} actions={<NewButton label="New project" onClick={newProject} />} title="Projects" />
      <div className="column">
        <Sortable
          ids={lists.map((l) => l.id)}
          onMove={onMove}
          layout="grid"
          lean={folderLean}
          label={(id) => hub.list(id)?.name ?? ''}
          renderOverlay={(id) => {
            const l = hub.list(id);
            return l ? <ProjectCard list={l} /> : null;
          }}
        >
          <div className="projgrid">
            {lists.map((l) => (
              <SortableProject key={l.id} list={l} />
            ))}
            <button type="button" className="projcard projcard--new" onClick={newProject}>
              <span className="projcard__plus">
                <Icon name="plus" />
              </span>
              <span>New project</span>
            </button>
          </div>
        </Sortable>

        {archived.length ? (
          <Disclosure title="Archived" count={archived.length}>
            <ul className="rows">
              {archived.map((l) => (
                <li key={l.id} className="row">
                  <ListBullet list={l} size="md" />
                  <div className="row__body">
                    <span className="row__title" dir="auto">
                      {l.name}
                    </span>
                  </div>
                  <button type="button" className="mini" onClick={() => hub.updateList(l.id, { archived: false })}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </div>
    </>
  );
}

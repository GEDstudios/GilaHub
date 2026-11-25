import { useState, type CSSProperties } from 'react';
import { pickColor, PROJECT_TEMPLATES } from '../../core/actions';
import type { LineColor, List, ListKind, ShoppingFlavor, Visibility } from '../../core/model';
import { useAddAction } from '../addAction';
import { Options } from '../components/editors';
import { Swatches } from '../components/pickers';
import { useHub } from '../context';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, lineVars, NewButton } from '../ui/primitives';
import { SyncBadge } from '../components/SyncBadge';
import { Glyph } from '../ui/ProjectMark';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { LIST_VIS, listVisLabel, visHint, visLabel, VIS_ICON } from '../privacy';
import { openCount } from '../views';

const KIND: Record<ListKind, string> = { tasks: 'Tasks', shopping: 'Shopping', chores: 'Chores' };

/** Who sees a project: Ours, Mine or Only me, with one line on what that means. */
export function ListVisOptions({ value, onPick }: { value: Visibility; onPick: (v: Visibility) => void }) {
  const hub = useHub();
  const partner = hub.partner();
  return (
    <>
      <Options
        value={value}
        onPick={onPick}
        options={(['shared', 'visible', 'private'] as const).map((v) => ({ value: v, label: visLabel(LIST_VIS[v]), icon: VIS_ICON[LIST_VIS[v]] }))}
      />
      <p className="panel__hint">{visHint(LIST_VIS[value], partner?.name ?? null)}</p>
    </>
  );
}

export function NewProjectSheet({ onClose, initial }: { onClose: () => void; initial?: Partial<{ visibility: Visibility; kind: ListKind }> }) {
  const hub = useHub();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ListKind>(initial?.kind ?? 'tasks');
  const [flavor, setFlavor] = useState<ShoppingFlavor>('grocery');
  const [color, setColor] = useState<LineColor>(() => pickColor(hub.lists().map((l) => l.color)));
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? 'shared');
  const taken = new Set(hub.lists().map((l) => l.name.toLowerCase()));
  const starts = PROJECT_TEMPLATES.filter((t) => !taken.has(t.name.toLowerCase())).slice(0, 4);

  const create = () => {
    if (!name.trim()) return;
    const id = hub.createList({ name, kind, color, flavor: kind === 'shopping' ? flavor : undefined, visibility });
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
        <div className="ccard ccard--lg ccard--edit" style={lineVars(color)}>
          <input className="ccard__input" dir="auto" placeholder="Name it" value={name} onChange={(e) => setName(e.target.value)} data-autofocus aria-label="Project name" />
          <span className="ccard__sub">
            {KIND[kind]} · {visLabel(LIST_VIS[visibility])}
          </span>
        </div>

        {!name && starts.length ? (
          <>
            <div className="tokens">
              {starts.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="token"
                  onClick={() => {
                    setName(t.name);
                    setKind(t.kind);
                    if (t.flavor) setFlavor(t.flavor);
                    if (t.visibility) setVisibility(t.visibility);
                  }}
                >
                  <Icon name="plus" />
                  {t.name}
                </button>
              ))}
            </div>
          </>
        ) : null}

        <div className="choose">
          <span className="choose__label">Kind</span>
          <Options
            value={kind}
            onPick={(k) => setKind(k as ListKind)}
            options={[
              { value: 'tasks', label: 'Tasks' },
              { value: 'shopping', label: 'Shopping' },
              { value: 'chores', label: 'Chores' },
            ]}
          />
        </div>
        {kind === 'shopping' ? (
          <div className="choose">
            <span className="choose__label">Sorted by</span>
            <Options
              value={flavor}
              onPick={(f) => setFlavor(f as ShoppingFlavor)}
              options={[
                { value: 'grocery', label: 'Aisles' },
                { value: 'home', label: 'Departments' },
              ]}
            />
          </div>
        ) : null}
        <div className="choose">
          <span className="choose__label">Who sees it</span>
          <ListVisOptions value={visibility} onPick={setVisibility} />
        </div>
        <div className="choose">
          <span className="choose__label">Color</span>
          <Swatches value={color} onChange={setColor} />
        </div>
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
  const [showArchived, setShowArchived] = useState(false);
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
          <div className="archived">
            <button type="button" className="textbtn" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}>
              {showArchived ? 'Hide archived' : `${archived.length} archived`}
            </button>
            {showArchived ? (
              <ul className="rows">
                {archived.map((l) => (
                  <li key={l.id} className="row">
                    <span className="dot dot--md" style={lineVars(l.color)} />
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
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { haptic } from '../ui/haptics';
import { useState } from 'react';
import { pickColor, PROJECT_TEMPLATES } from '../../core/actions';
import type { LineColor, List, ListKind, ShoppingFlavor, Visibility } from '../../core/model';
import { useAddAction } from '../addAction';
import { Options } from '../components/editors';
import { Swatches } from '../components/pickers';
import { useHub } from '../context';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, IconButton, lineVars } from '../ui/primitives';
import { SyncBadge } from './Today';
import { openCount } from '../views';

const KIND: Record<ListKind, string> = { tasks: 'Tasks', shopping: 'Shopping', chores: 'Chores' };

export function visLabel(hub: ReturnType<typeof useHub>, l: Pick<List, 'visibility' | 'owner'>): string {
  if (l.visibility === 'shared') return 'Ours';
  if (l.visibility === 'private') return 'Only me';
  return !l.owner || l.owner === hub.meId ? 'Mine' : `${hub.member(l.owner)?.name ?? 'Their'}’s`;
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
            {KIND[kind]} · {visibility === 'shared' ? 'Ours' : visibility === 'visible' ? 'Mine' : 'Only me'}
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
          <Options
            value={visibility}
            onPick={(v) => setVisibility(v as Visibility)}
            options={[
              { value: 'shared', label: 'Ours', icon: 'ours' },
              { value: 'visible', label: 'Mine', icon: 'mine' },
              { value: 'private', label: 'Only me', icon: 'lock' },
            ]}
          />
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: list.id });
  return (
    <div
      ref={setNodeRef}
      className={`projslot ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role={undefined}
      tabIndex={undefined}
    >
      <ProjectCard list={list} />
    </div>
  );
}

function ProjectCard({ list }: { list: List }) {
  const hub = useHub();
  const n = openCount(hub, list.id);
  return (
    <button
      type="button"
      className="ccard ccard--md projcard"
      style={{ ...lineVars(list.color), ['--tilt' as string]: `${tilt(list.id)}deg` }}
      onClick={() => navigate({ name: 'list', id: list.id })}
    >
      <span className="ccard__top">
        <span className="ccard__title projcard__name" dir="auto">
          {list.name}
        </span>
        {list.visibility === 'private' ? (
          <span className="ccard__badge">
            <Icon name="lock" className="icon--sm" />
          </span>
        ) : null}
      </span>
      <span className="ccard__sub">
        {n ? `${n} open` : 'All clear'}
        {list.visibility !== 'shared' ? ` · ${visLabel(hub, list)}` : ''}
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
  useAddAction(newProject);

  const archived = hub.store.all('list').filter((l) => l.archived);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = lists.map((l) => l.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    hub.moveList(String(active.id), next[next.indexOf(String(active.id)) + 1] ?? null);
  };

  return (
    <>
      <Band top={<SyncBadge />} actions={<IconButton icon="plus" label="New project" onClick={newProject} />} title="Projects" />
      <div className="column">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => haptic()} onDragEnd={onDragEnd}>
          <SortableContext items={lists.map((l) => l.id)} strategy={rectSortingStrategy}>
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
          </SortableContext>
        </DndContext>

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

import { useState } from 'react';
import { PROJECT_TEMPLATES } from '../../core/actions';
import type { LineColor, List, ListKind, ShoppingFlavor, Visibility } from '../../core/model';
import { useAddAction } from '../addAction';
import { Swatches } from '../components/pickers';
import { useHub } from '../context';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, Bullet, lineVars, Seg } from '../ui/primitives';
import { openCount } from '../views';

const KIND_LABEL: Record<ListKind, string> = { tasks: 'Tasks', shopping: 'Shopping', chores: 'Chores' };

export function openProject(list: List) {
  navigate(list.kind === 'shopping' ? { name: 'list', id: list.id } : { name: 'list', id: list.id });
}

export function NewProjectSheet({ onClose, initial }: { onClose: () => void; initial?: Partial<{ visibility: Visibility; kind: ListKind }> }) {
  const hub = useHub();
  const partner = hub.partner();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [kind, setKind] = useState<ListKind>(initial?.kind ?? 'tasks');
  const [flavor, setFlavor] = useState<ShoppingFlavor>('grocery');
  const [color, setColor] = useState<LineColor>('sky');
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? 'shared');
  const taken = new Set(hub.lists().map((l) => l.name.toLowerCase()));

  const create = () => {
    if (!name.trim()) return;
    const id = hub.createList({ name, kind, color, icon, flavor: kind === 'shopping' ? flavor : undefined, visibility });
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
        <div className="projpreview" style={lineVars(color)}>
          <span className="projpreview__icon">{icon || '✦'}</span>
          <input className="projpreview__name" dir="auto" placeholder="Name it" value={name} onChange={(e) => setName(e.target.value)} data-autofocus aria-label="Project name" />
        </div>
        {!name ? (
          <>
            <span className="field__label" style={{ marginTop: 16 }}>
              Or start from
            </span>
            <div className="chips">
              {PROJECT_TEMPLATES.filter((t) => !taken.has(t.name.toLowerCase())).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setName(t.name);
                    setIcon(t.icon);
                    setKind(t.kind);
                    setColor(t.color);
                    if (t.flavor) setFlavor(t.flavor);
                    if (t.visibility) setVisibility(t.visibility);
                  }}
                >
                  {t.icon} {t.name}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <div className="field">
          <span className="field__label">What kind</span>
          <Seg
            label="Kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'tasks', label: 'Tasks' },
              { value: 'shopping', label: 'Shopping' },
              { value: 'chores', label: 'Chores' },
            ]}
          />
          {kind === 'shopping' ? (
            <div style={{ marginTop: 10 }}>
              <Seg
                label="Sorted by"
                value={flavor}
                onChange={setFlavor}
                options={[
                  { value: 'grocery', label: 'Supermarket aisles' },
                  { value: 'home', label: 'Home departments' },
                ]}
              />
            </div>
          ) : null}
        </div>
        <div className="field">
          <span className="field__label">Who sees it</span>
          <Seg
            label="Who sees it"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'shared', label: <><Icon name="ours" className="icon--sm" /> Ours</> },
              { value: 'visible', label: <><Icon name="mine" className="icon--sm" /> Mine</> },
              { value: 'private', label: <><Icon name="lock" className="icon--sm" /> Only me</> },
            ]}
          />
          <p className="hint" style={{ margin: '8px 2px 0' }}>
            {visibility === 'shared'
              ? 'You both see and change everything in it.'
              : visibility === 'visible'
                ? `${partner?.name ?? 'Your partner'} can see it. Only you change it.`
                : `${partner?.name ?? 'Your partner'} can’t see it exists. Encrypted with your personal key.`}
          </p>
        </div>
        <div className="field">
          <span className="field__label">Color</span>
          <Swatches value={color} onChange={setColor} label={icon || name || '✦'} />
        </div>
        <button type="submit" className="btn btn--block" style={{ marginTop: 22 }} disabled={!name.trim()}>
          Create project
        </button>
      </form>
    </Sheet>
  );
}

function ProjectCard({ list }: { list: List }) {
  const hub = useHub();
  const n = openCount(hub, list.id);
  return (
    <button type="button" className="projcard" style={lineVars(list.color)} onClick={() => openProject(list)}>
      <span className="projcard__top">
        <span className="projcard__icon">{list.icon || <Bullet color={list.color} label={list.name} size="sm" />}</span>
        {list.visibility === 'private' ? <Icon name="lock" className="icon--sm" /> : null}
      </span>
      <span className="projcard__name" dir="auto">
        {list.name}
      </span>
      <span className="projcard__meta">
        {n ? `${n} open` : 'All done'} · {KIND_LABEL[list.kind]}
      </span>
    </button>
  );
}

export function Lists() {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const lists = hub.lists();
  const partner = hub.partner();
  const newProject = (visibility?: Visibility) => openSheet((close) => <NewProjectSheet onClose={close} initial={{ visibility }} />);
  useAddAction(() => newProject());

  const groups: Array<{ key: string; title: string; icon: 'ours' | 'mine' | 'lock'; items: List[]; visibility?: Visibility }> = [
    { key: 'ours', title: 'Ours', icon: 'ours', items: lists.filter((l) => l.visibility === 'shared'), visibility: 'shared' },
    { key: 'mine', title: 'Mine', icon: 'mine', items: lists.filter((l) => l.visibility === 'visible' && l.owner === hub.meId), visibility: 'visible' },
    ...(partner
      ? [{ key: 'theirs', title: `${partner.name}’s`, icon: 'mine' as const, items: lists.filter((l) => l.visibility === 'visible' && l.owner !== hub.meId) }]
      : []),
    { key: 'private', title: 'Only me', icon: 'lock', items: lists.filter((l) => l.visibility === 'private'), visibility: 'private' },
  ];
  const archived = hub.store.all('list').filter((l) => l.archived);

  return (
    <>
      <Band title="Projects" sub={lists.length ? `${lists.length} on the go` : 'Start your first one'} />
      <div className="column">
        {groups.map((g) =>
          g.items.length || g.key === 'ours' ? (
            <section key={g.key} className="section">
              <div className="section__head">
                <h2 className="section__title">
                  <Icon name={g.icon} className="icon--sm" /> {g.title}
                </h2>
              </div>
              <div className="projgrid">
                {g.items.map((l) => (
                  <ProjectCard key={l.id} list={l} />
                ))}
                {g.visibility ? (
                  <button type="button" className="projcard projcard--new" onClick={() => newProject(g.visibility)}>
                    <span className="projcard__plus">
                      <Icon name="plus" />
                    </span>
                    <span className="projcard__name">New project</span>
                  </button>
                ) : null}
              </div>
            </section>
          ) : null,
        )}
        {!groups.find((g) => g.key === 'private')!.items.length ? (
          <p className="hint" style={{ marginTop: 22 }}>
            Want something just for you? Make a project <strong>Only me</strong>. It’s encrypted with your personal key.
          </p>
        ) : null}
        {archived.length ? (
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">
                <Icon name="archive" className="icon--sm" /> Archived
              </h2>
            </div>
            <ul className="rows">
              {archived.map((l) => (
                <li key={l.id} className="row">
                  <Bullet color={l.color} label={l.name} emoji={l.icon || undefined} size="md" />
                  <div className="row__body">
                    <span className="row__title" dir="auto">
                      {l.name}
                    </span>
                  </div>
                  <button type="button" className="btn btn--sm btn--light" onClick={() => hub.updateList(l.id, { archived: false })}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}

import { useState } from 'react';
import type { LineColor, List, ListKind, ShoppingFlavor, Visibility } from '../../core/model';
import { Swatches } from '../components/pickers';
import { useHub } from '../context';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, Bullet, ListBullet, Seg } from '../ui/primitives';
import { openCount } from '../views';

const TEMPLATES: Array<{ name: string; icon: string; kind: ListKind; color: LineColor }> = [
  { name: 'Packing', icon: '🧳', kind: 'tasks', color: 'teal' },
  { name: 'Movies to watch', icon: '🎬', kind: 'tasks', color: 'plum' },
  { name: 'Gift ideas', icon: '🎁', kind: 'tasks', color: 'tomato' },
  { name: 'Trip', icon: '✈️', kind: 'tasks', color: 'royal' },
  { name: 'Restaurants', icon: '🍜', kind: 'tasks', color: 'tangerine' },
  { name: 'Pharmacy', icon: '💊', kind: 'shopping', color: 'forest' },
];

const KIND_LABEL: Record<ListKind, string> = { tasks: 'Tasks', shopping: 'Shopping', chores: 'Chores' };

export function NewListSheet({ onClose, initial }: { onClose: () => void; initial?: Partial<{ visibility: Visibility; kind: ListKind }> }) {
  const hub = useHub();
  const me = hub.me();
  const partner = hub.partner();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [kind, setKind] = useState<ListKind>(initial?.kind ?? 'tasks');
  const [flavor, setFlavor] = useState<ShoppingFlavor>('grocery');
  const [color, setColor] = useState<LineColor>('royal');
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? 'shared');

  const create = () => {
    if (!name.trim()) return;
    const id = hub.createList({ name, kind, color, icon, flavor: kind === 'shopping' ? flavor : undefined, visibility });
    onClose();
    navigate(kind === 'shopping' ? { name: 'shop' } : { name: 'list', id });
  };

  return (
    <Sheet onClose={onClose} title="New list">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Bullet color={color} label={name || '?'} emoji={icon || undefined} size="xl" />
          <input className="input input--big" dir="auto" placeholder="Name it" value={name} onChange={(e) => setName(e.target.value)} data-autofocus aria-label="List name" />
        </div>
        {!name ? (
          <div className="chips" style={{ marginTop: 14 }}>
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                type="button"
                className="chip"
                onClick={() => {
                  setName(t.name);
                  setIcon(t.icon);
                  setKind(t.kind);
                  setColor(t.color);
                }}
              >
                {t.icon} {t.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="field">
          <span className="field__label">Kind</span>
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
                label="Aisles"
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
          <span className="field__label">Who can see it</span>
          <Seg
            label="Who can see it"
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
              ? 'We both see and change everything in it.'
              : visibility === 'visible'
                ? `${partner?.name ?? 'Your partner'} can see it. Only you change it.`
                : `${partner?.name ?? 'Your partner'} can’t see it exists. Encrypted with your personal key.`}
          </p>
        </div>
        <div className="field">
          <span className="field__label">Line color</span>
          <Swatches value={color} onChange={setColor} label={icon || name || me?.name || 'G'} />
        </div>
        <button type="submit" className="btn btn--me btn--block" style={{ marginTop: 22 }} disabled={!name.trim()}>
          Create list
        </button>
      </form>
    </Sheet>
  );
}

function ListRowLink({ list }: { list: List }) {
  const hub = useHub();
  const n = openCount(hub, list.id);
  return (
    <li className="row row--tap" onClick={() => navigate(list.kind === 'shopping' ? `/shop` : { name: 'list', id: list.id })}>
      <ListBullet list={list} size="lg" />
      <div className="row__body">
        <span className="row__title" dir="auto">
          {list.name}
        </span>
        <span className="row__meta">
          <span className="meta">{KIND_LABEL[list.kind]}</span>
          {list.visibility === 'private' ? (
            <span className="meta">
              <Icon name="lock" /> only me
            </span>
          ) : null}
        </span>
      </div>
      <span className="row__trail">
        <span className="num" style={{ fontWeight: 700, color: 'var(--ink-2)' }}>
          {n || ''}
        </span>
        <Icon name="chevron-right" className="icon--sm" />
      </span>
    </li>
  );
}

export function Lists() {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const lists = hub.lists();
  const partner = hub.partner();
  const groups: Array<{ key: string; title: string; icon: 'ours' | 'mine' | 'lock'; items: List[]; visibility: Visibility }> = [
    { key: 'ours', title: 'Ours', icon: 'ours', items: lists.filter((l) => l.visibility === 'shared'), visibility: 'shared' },
    { key: 'mine', title: 'Mine', icon: 'mine', items: lists.filter((l) => l.visibility === 'visible' && l.owner === hub.meId), visibility: 'visible' },
    ...(partner
      ? [{ key: 'theirs', title: `${partner.name}’s`, icon: 'mine' as const, items: lists.filter((l) => l.visibility === 'visible' && l.owner !== hub.meId), visibility: 'visible' as Visibility }]
      : []),
    { key: 'private', title: 'Only me', icon: 'lock', items: lists.filter((l) => l.visibility === 'private'), visibility: 'private' },
  ];
  const archived = hub.store.all('list').filter((l) => l.archived);

  return (
    <>
      <Band title="Lists" sub={`${lists.length} lines`} />
      <div className="column">
        {groups.map((g) =>
          g.items.length || g.key !== 'theirs' ? (
            <section key={g.key} className="section">
              <div className="section__head">
                <h2 className="section__title">
                  <Icon name={g.icon} className="icon--sm" /> {g.title}
                </h2>
                {g.key !== 'theirs' ? (
                  <button type="button" className="section__action" onClick={() => openSheet((close) => <NewListSheet onClose={close} initial={{ visibility: g.visibility }} />)}>
                    + New
                  </button>
                ) : null}
              </div>
              {g.items.length ? (
                <ul className="rows">
                  {g.items.map((l) => (
                    <ListRowLink key={l.id} list={l} />
                  ))}
                </ul>
              ) : (
                <p className="hint">{g.key === 'private' ? 'Lists here are invisible to your partner.' : 'Nothing here yet.'}</p>
              )}
            </section>
          ) : null,
        )}
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
                  <ListBullet list={l} size="md" />
                  <div className="row__body">
                    <span className="row__title" dir="auto">
                      {l.name}
                    </span>
                  </div>
                  <button type="button" className="btn btn--sm btn--quiet" onClick={() => hub.updateList(l.id, { archived: false })}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <button type="button" className="fab" aria-label="New list" onClick={() => openSheet((close) => <NewListSheet onClose={close} />)}>
        <Icon name="plus" className="icon--lg" />
      </button>
    </>
  );
}

import { useEffect, useState } from 'react';
import type { Visibility } from '../../core/model';
import { Children } from '../components/Children';
import { Swatches } from '../components/pickers';
import { QuickAdd } from '../components/QuickAdd';
import { NewChoreSheet } from './Chores';
import { useHub } from '../context';
import { setPrefs } from '../prefs';
import { back, navigate } from '../router';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, Empty, ListBullet, Seg } from '../ui/primitives';
import { openCount } from '../views';

function ListMenu({ listId, onClose }: { listId: string; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const list = hub.list(listId);
  const [name, setName] = useState(list?.name ?? '');
  const [icon, setIcon] = useState(list?.icon ?? '');
  if (!list) return null;
  const mineToChange = !list.owner || list.owner === hub.meId;
  const partner = hub.partner()?.name ?? 'your partner';
  const save = () => {
    if (name.trim() && (name !== list.name || icon !== (list.icon ?? ''))) hub.updateList(listId, { name: name.trim(), icon: icon.trim() });
  };
  return (
    <Sheet onClose={() => (save(), onClose())} title="List settings">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <input className="input" style={{ width: 64, textAlign: 'center', fontSize: 22 }} value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} placeholder="🙂" aria-label="Emoji (optional)" />
        <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} aria-label="Name" />
      </div>
      <div className="field">
        <span className="field__label">Line color</span>
        <Swatches value={list.color} onChange={(c) => hub.updateList(listId, { color: c })} label={icon || name} />
      </div>
      {mineToChange ? (
        <div className="field">
          <span className="field__label">Who can see it</span>
          <Seg
            label="Who can see it"
            value={list.visibility}
            onChange={(vis: Visibility) => {
              if (vis === 'private' && list.visibility !== 'private' && hub.partner()) toast(`Hidden from ${partner}`);
              hub.setListVisibility(listId, vis);
            }}
            options={[
              { value: 'shared', label: <><Icon name="ours" className="icon--sm" /> Ours</> },
              { value: 'visible', label: <><Icon name="mine" className="icon--sm" /> Mine</> },
              { value: 'private', label: <><Icon name="lock" className="icon--sm" /> Only me</> },
            ]}
          />
        </div>
      ) : null}
      <div className="card" style={{ marginTop: 20 }}>
        {list.kind === 'tasks' ? (
          <button
            type="button"
            className="optrow"
            onClick={() => {
              const undo = hub.uncheckAll(listId);
              onClose();
              toast('Everything unticked — ready to reuse', { action: { label: 'Undo', run: undo } });
            }}
          >
            <span className="optrow__icon">
              <Icon name="refresh" className="icon--sm" />
            </span>
            <span className="optrow__text">
              Uncheck all <span className="optrow__sub">Reuse it: packing, trips, routines</span>
            </span>
          </button>
        ) : null}
        <button
          type="button"
          className="optrow"
          onClick={() => {
            hub.updateList(listId, { archived: true });
            onClose();
            navigate({ name: 'lists' }, { replace: true });
            toast(`Archived ${list.name}`, { action: { label: 'Undo', run: () => hub.updateList(listId, { archived: false }) } });
          }}
        >
          <span className="optrow__icon">
            <Icon name="archive" className="icon--sm" />
          </span>
          <span className="optrow__text">Archive</span>
        </button>
        {mineToChange ? (
          <button
            type="button"
            className="optrow"
            onClick={() => {
              const undo = hub.deleteList(listId);
              onClose();
              navigate({ name: 'lists' }, { replace: true });
              toast(`Deleted ${list.name}`, { action: { label: 'Undo', run: undo } });
            }}
          >
            <span className="optrow__icon">
              <Icon name="trash" className="icon--sm" />
            </span>
            <span className="optrow__text">Delete list</span>
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}

export function ListScreen({ id }: { id: string }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const list = hub.list(id);
  const [freshId, setFreshId] = useState<string | null>(null);

  useEffect(() => {
    if (list?.kind === 'shopping') {
      setPrefs({ shopFilter: list.id });
      navigate({ name: 'shop' }, { replace: true });
    }
  }, [list]);

  if (!list) {
    return (
      <>
        <Band title="Not here" onBack={() => back({ name: 'lists' })} />
        <Empty title="This list is gone" text="It may have been deleted or made private." />
      </>
    );
  }

  const owner = hub.member(list.owner);
  const readonly = !!list.owner && list.owner !== hub.meId;
  const n = openCount(hub, id);
  const vis = list.visibility === 'shared' ? 'Ours' : list.visibility === 'private' ? 'Only me' : owner?.id === hub.meId ? 'Mine' : `${owner?.name}’s`;
  const isChores = list.kind === 'chores';

  return (
    <>
      <Band
        title={list.name}
        lead={<ListBullet list={list} size="lg" />}
        sub={`${vis} · ${n ? `${n} open` : 'all done'}`}
        onBack={() => back({ name: 'lists' })}
        actions={
          <button type="button" className="iconbtn" aria-label="List settings" onClick={() => openSheet((close) => <ListMenu listId={id} onClose={close} />)}>
            <Icon name="more" />
          </button>
        }
      />
      <div className="column">
        {readonly ? (
          <p className="hint" style={{ marginTop: 16 }}>
            This is {owner?.name}’s list. You can see it; only {owner?.name} changes it.
          </p>
        ) : isChores ? (
          <div style={{ margin: '16px var(--gutter) 0' }}>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => openSheet((close) => <NewChoreSheet onClose={close} listId={id} />)}>
              <Icon name="plus" className="icon--sm" /> New chore
            </button>
          </div>
        ) : (
          <QuickAdd listId={id} onAdded={setFreshId} />
        )}
        <div style={{ marginTop: 14 }}>
          <Children listId={id} parentId={null} freshId={freshId} readonly={readonly} />
        </div>
        {!hub.children(id, null).length ? <Empty title="Empty line" text={readonly ? 'Nothing here yet.' : 'Add the first thing above. Items can hold steps — as deep as you need.'} /> : null}
      </div>
    </>
  );
}

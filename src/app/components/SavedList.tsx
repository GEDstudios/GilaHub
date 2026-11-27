import { useState } from 'react';
import { newId } from '../../core/ids';
import type { Item } from '../../core/model';
import { useHub } from '../context';
import { hideHome, queryKey, showHome } from '../home';
import { getPrefs, setPrefs } from '../prefs';
import { usePrefs } from '../usePrefs';
import { DUE_LABEL, runQuery, type DueWindow, type TaskQuery } from '../query';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { ListBullet, Section, TextButton, Button } from '../ui/primitives';
import type { Settle } from '../ui/useSettle';
import { Options } from './chips';
import { PlaceTree } from './PlaceTree';
import { ItemRow } from './ItemRow';
import { TagPicker } from './Tags';
import { G } from '../ui/glyphs';
import { SwitchRow } from './pickers';
import { howMany } from '../labels';
import type { Hub } from '../../core/hub';

const SHOWN = 8;

/** A filtered list of mine on Today: what it lets through, the first few, the rest a tap away. */
export function SavedListWidget({ id, settle }: { id: string; settle: Settle<Item> }) {
  const hub = useHub();
  const prefs = usePrefs();
  const { openSheet } = useOverlays();
  const [all, setAll] = useState(false);
  const saved = prefs.savedLists[id];
  if (!saved) return null;
  const found = runQuery(hub, saved.query);
  const rows = settle.view(`q:${id}`, all ? found : found.slice(0, SHOWN));
  return (
    <Section
      title={
        <>
          <Icon name={G.filter} className="icon--sm" />
          <span dir="auto">{saved.name}</span>
        </>
      }
      count={found.length}
      action={
        <TextButton onClick={() => openSheet((close) => <SavedListSheet id={id} onClose={close} />)}>
          Edit
        </TextButton>
      }
    >
      {rows.length ? (
        <ul className="rows">
          {rows.map(({ row: i, settling }) => (
            <ItemRow key={i.id} item={i} settling={settling} showList listLink={false} />
          ))}
        </ul>
      ) : (
        <p className="hint">Nothing right now.</p>
      )}
      {found.length > SHOWN ? (
        <TextButton onClick={() => setAll(!all)} className="savedlist__more">
          {all ? 'Fewer' : `${found.length - SHOWN} more`}
        </TextButton>
      ) : null}
    </Section>
  );
}

const DUES: Array<DueWindow | 'any'> = ['any', 'overdue', 'today', 'tomorrow', 'thisweek', 'next7', 'nextweek', 'nodate'];

/** Its name from what it asks, when I don't give one ("#Work · Next week"). */
function autoName(hub: Hub, q: TaskQuery): string {
  const bits = [
    ...(q.tags ?? []).map((t) => `#${hub.tag(t)?.name ?? ''}`),
    q.listId ? hub.list(q.listId)?.name : null,
    q.due ? DUE_LABEL[q.due] : null,
    q.urgent ? 'Urgent' : null,
    q.side === 'mine' ? 'Mine' : q.side === 'ours' ? 'Ours' : null,
  ].filter(Boolean);
  return bits.join(' · ') || 'Everything open';
}

/**
 * Make (or change) a filtered list for Today: tags, a folder (and the ones inside it), when
 * it's due, urgent only, whose. It shows how many it finds now; Save puts it on Today.
 */
export function SavedListSheet({ id, onClose }: { id?: string; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const was = id ? getPrefs().savedLists[id] : undefined;
  const [q, setQ] = useState<TaskQuery>(was?.query ?? {});
  const [name, setName] = useState(was?.name ?? '');
  const [part, setPart] = useState<'folder' | 'tags' | null>(null);
  const n = runQuery(hub, q).length;
  const folder = hub.list(q.listId);
  const save = () => {
    const key = id ?? newId(10);
    const lists = getPrefs().savedLists;
    setPrefs({ savedLists: { ...lists, [key]: { name: name.trim() || autoName(hub, q), query: q } } });
    if (!id) showHome(hub, queryKey(key));
    haptic('success');
    onClose();
    toast(id ? 'Saved' : 'On your Today');
  };
  const remove = () => {
    if (!id) return;
    const lists = { ...getPrefs().savedLists };
    const gone = lists[id];
    delete lists[id];
    hideHome(hub, queryKey(id));
    setPrefs({ savedLists: lists });
    onClose();
    toast(`${gone?.name ?? 'It'} is off Today`, {
      undo: () => {
        setPrefs({ savedLists: { ...getPrefs().savedLists, [id]: gone } });
        showHome(hub, queryKey(id));
      },
    });
  };
  return (
    <Sheet onClose={onClose} title={id ? 'Filtered list' : 'A filtered list on Today'}>
      <input className="field savedlist__name" dir="auto" value={name} placeholder="List name" onChange={(e) => setName(e.target.value)} aria-label="List name" />

      <div className="group savedlist__rows">
        <button type="button" className={`whenrow__btn savedlist__row ${part === 'folder' ? 'is-open' : ''}`} onClick={() => setPart(part === 'folder' ? null : 'folder')}>
          <Icon name={G.folder} className="icon--sm" />
          <span className="whenrow__title">Folder</span>
          <span className="whenrow__value" dir="auto">
            {folder ? (
              <>
                <ListBullet list={folder} size="xs" /> {folder.name} and inside
              </>
            ) : (
              'Any folder'
            )}
          </span>
        </button>
        {part === 'folder' ? (
          <PlaceTree
            value={q.listId ? { listId: q.listId, parentId: null } : null}
            root={{ label: 'Any folder', icon: G.folders, on: !q.listId }}
            onPick={(p) => {
              setQ({ ...q, listId: p?.listId ?? null });
              setPart(null);
            }}
          />
        ) : null}

        <button type="button" className={`whenrow__btn savedlist__row ${part === 'tags' ? 'is-open' : ''}`} onClick={() => setPart(part === 'tags' ? null : 'tags')}>
          <Icon name={G.tag} className="icon--sm" />
          <span className="whenrow__title">Tags</span>
          <span className="whenrow__value" dir="auto">
            {q.tags?.length ? q.tags.map((t) => hub.tag(t)?.name).filter(Boolean).join(', ') : 'Any'}
          </span>
        </button>
        {part === 'tags' ? <TagPicker value={q.tags ?? []} onChange={(tags) => setQ({ ...q, tags })} /> : null}
      </div>

      <p className="panel__head">Due</p>
      <Options
        value={q.due ?? 'any'}
        options={DUES.map((d) => ({ value: d, label: d === 'any' ? 'Any time' : DUE_LABEL[d] }))}
        onPick={(v) => setQ({ ...q, due: v === 'any' ? null : v })}
      />

      {hub.partner() ? (
        <>
          <p className="panel__head">Whose</p>
          <Options
            value={q.side ?? 'all'}
            options={[
              { value: 'all', label: 'Everyone’s' },
              { value: 'mine', label: 'Mine' },
              { value: 'ours', label: 'Ours' },
            ]}
            onPick={(v) => setQ({ ...q, side: v === 'all' ? null : (v as 'mine' | 'ours') })}
          />
        </>
      ) : null}

      <SwitchRow panel icon={G.urgent} title="Urgent only" on={!!q.urgent} onChange={(v) => setQ({ ...q, urgent: v || undefined })} />

      <p className="savedlist__count">
        {howMany(n, 'task')} right now
      </p>
      <Button icon={id ? G.done : G.add} block onClick={save}>
        {id ? 'Save' : 'Put it on Today'}
      </Button>
      {id ? (
        <TextButton onClick={remove} className="savedlist__remove">
          Take it off Today
        </TextButton>
      ) : null}
    </Sheet>
  );
}

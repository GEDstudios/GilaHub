import { useState } from 'react';
import { useHub } from '../context';
import { getPrefs } from '../prefs';
import { Sheet } from '../ui/overlays';
import { ListBullet } from '../ui/primitives';
import { QuickAdd } from './QuickAdd';

/** The global "+": one forgiving input, smart parsing, choose the list if you want. */
export function QuickAddSheet({ onClose, defaultDue, listId }: { onClose: () => void; defaultDue?: string | null; listId?: string }) {
  const hub = useHub();
  const lists = hub.lists().filter((l) => l.kind !== 'shopping');
  const last = getPrefs().lastList;
  const initial =
    (listId && hub.list(listId)) ||
    (last && lists.find((l) => l.id === last)) ||
    lists.find((l) => l.name === 'To do') ||
    lists[0];
  const [added, setAdded] = useState<string[]>([]);
  if (!initial) return null;
  return (
    <Sheet onClose={onClose} title="Add">
      <div style={{ margin: '0 calc(var(--gutter) * -1)' }}>
        <QuickAdd
          listId={initial.id}
          defaultDue={defaultDue}
          allowListChange
          autoFocus
          placeholder="What’s on your mind?"
          onAdded={(id) => setAdded((a) => [id, ...a].slice(0, 4))}
        />
      </div>
      {added.length ? (
        <ul className="rows" style={{ margin: '14px calc(var(--gutter) * -1) 0' }}>
          {added.map((id) => {
            const it = hub.item(id);
            if (!it) return null;
            return (
              <li key={id} className="row row--fresh">
                <ListBullet list={hub.list(it.listId)} size="sm" />
                <div className="row__body">
                  <span className="row__title" dir="auto">
                    {it.title}
                  </span>
                  <span className="row__meta">Added to {hub.list(it.listId)?.name}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hint" style={{ margin: '14px 2px 0' }}>
          Try “call mom tomorrow 6pm”, “bins every sun”, “@{hub.partner()?.name.toLowerCase() ?? 'name'}” or “!” for urgent.
        </p>
      )}
      <button type="button" className="btn btn--quiet btn--block" style={{ marginTop: 18 }} onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}

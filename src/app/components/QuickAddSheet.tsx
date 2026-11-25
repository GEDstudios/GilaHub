import { useHub } from '../context';
import { getPrefs } from '../prefs';
import { Sheet, useOverlays } from '../ui/overlays';
import { QuickAdd } from './QuickAdd';

/** "New": one forgiving sentence, a live preview card, and Add. */
export function QuickAddSheet({ onClose, defaultDue, listId }: { onClose: () => void; defaultDue?: string | null; listId?: string }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const lists = hub.lists().filter((l) => l.kind !== 'shopping');
  const last = getPrefs().lastList;
  const initial =
    (listId && hub.list(listId)) || (last && lists.find((l) => l.id === last)) || lists.find((l) => l.name === 'To do') || lists[0];
  if (!initial) {
    return (
      <Sheet onClose={onClose} title="New">
        <p className="hint">Make a project first. Everything you add lives in one.</p>
      </Sheet>
    );
  }
  return (
    <Sheet onClose={onClose} title="New">
      <QuickAdd
        composer
        listId={initial.id}
        defaultDue={defaultDue}
        allowListChange
        autoFocus
        onAdded={(id) => {
          const it = hub.item(id);
          toast(`Added to ${hub.list(it?.listId)?.name ?? 'your list'}`, { ms: 1800 });
        }}
      />
    </Sheet>
  );
}

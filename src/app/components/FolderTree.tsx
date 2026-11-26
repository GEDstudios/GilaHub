import { useState, type ReactNode } from 'react';
import type { List } from '../../core/model';
import { useHub } from '../context';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { ListBullet } from '../ui/primitives';

/**
 * Folders as the usual tree: folders inside folders folded into their parent, a ⌄ to open one.
 * Tap a folder to pick it. `marked` folders say so (and can't be picked again); `disabled` ones
 * can't be picked; `hint` adds a word after a name.
 */
export function FolderTree({
  onPick,
  marked,
  disabled,
  hint,
  initialOpen = [],
  top,
}: {
  onPick: (listId: string) => void;
  marked?: (l: List) => boolean;
  disabled?: (l: List) => boolean;
  hint?: (l: List) => ReactNode;
  initialOpen?: string[];
  /** A first row above the folders (e.g. "Any folder"). */
  top?: ReactNode;
}) {
  const hub = useHub();
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen));
  const flip = (id: string) => {
    haptic('select');
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const rows: ReactNode[] = [];
  const walk = (ls: List[], depth: number) => {
    for (const l of ls) {
      const subs = hub.subLists(l.id);
      const on = marked?.(l) ?? false;
      rows.push(
        <li key={l.id}>
          <div className="place__row" style={{ paddingInlineStart: 6 + depth * 18 }}>
            <button type="button" className="place__pick" aria-current={on || undefined} disabled={on || disabled?.(l)} onClick={() => (haptic('tick'), onPick(l.id))}>
              <ListBullet list={l} size="xs" />
              <span dir="auto">{l.name}</span>
              {hint?.(l) ? <span className="place__hint">{hint(l)}</span> : null}
            </button>
            {subs.length ? (
              <button type="button" className={`place__open ${open.has(l.id) ? 'is-open' : ''}`} aria-label={open.has(l.id) ? `Fold ${l.name}` : `Unfold ${l.name}`} aria-expanded={open.has(l.id)} onClick={() => flip(l.id)}>
                <Icon name="chevron-down" className="icon--sm" />
              </button>
            ) : null}
          </div>
        </li>,
      );
      if (open.has(l.id)) walk(subs, depth + 1);
    }
  };
  walk(hub.topLists(), 0);
  return (
    <ul className="place" aria-label="Folders">
      {top}
      {rows}
    </ul>
  );
}

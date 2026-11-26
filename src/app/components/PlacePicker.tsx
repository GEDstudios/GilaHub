import { useRef, useState, type ReactNode } from 'react';
import type { Item, List } from '../../core/model';
import { useHub } from '../context';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { ListBullet } from '../ui/primitives';

/**
 * Where else should this live? Tap a project to put it there. Long-press a project (or tap its
 * arrow) to open it up and tap one of its tasks, or a task's subtask, to put it inside that.
 */
export function PlacePicker({
  itemId,
  onPick,
  initialOpen = [],
  filter,
  here = false,
}: {
  itemId: string;
  onPick: (listId: string, parentId: string | null) => void;
  /** Opened from the start (the way down to where it is now). */
  initialOpen?: string[];
  /** Which projects to offer. */
  filter?: (l: List) => boolean;
  /** Mark where it is now ("here") rather than just disabling it. */
  here?: boolean;
}) {
  const hub = useHub();
  const item = hub.item(itemId);
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen));
  const toggle = (k: string) => {
    haptic('select');
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };
  if (!item) return null;
  const banned = new Set([itemId, ...hub.descendants(itemId).map((d) => d.id)]);
  const offered = (l: List) => !filter || filter(l);
  // Folders inside folders fold into their parent: the top ones show; a chevron opens one up
  // (its folders, then its tasks).
  const subsOf = (id: string) => hub.subLists(id).filter((x) => offered(x) || hub.nestedLists(x.id).some(offered));
  const folder = (l: List, depth: number): ReactNode => {
    const subs = subsOf(l.id);
    const tasks = offered(l) && hub.children(l.id, null).some((i) => !i.done && !i.archived && !banned.has(i.id));
    return (
      <PlaceRow
        key={l.id}
        depth={depth}
        label={<ListLabel list={l} />}
        expandable={subs.length > 0 || tasks}
        expanded={open.has(l.id)}
        onExpand={() => toggle(l.id)}
        onPick={() => onPick(l.id, null)}
        disabled={!offered(l) || (l.id === item.listId && !item.parentId)}
        hint={here && l.id === item.listId && !item.parentId ? 'here now' : undefined}
      >
        {open.has(l.id) ? (
          <>
            {subs.map((x) => folder(x, depth + 1))}
            {tasks ? <Tasks list={l} parentId={null} depth={depth + 1} banned={banned} open={open} toggle={toggle} onPick={onPick} current={here ? item.parentId : undefined} /> : null}
          </>
        ) : null}
      </PlaceRow>
    );
  };
  const tops = hub.topLists().filter((l) => offered(l) || hub.nestedLists(l.id).some(offered));

  return (
    <ul className="place" role="tree">
      {tops.map((l) => folder(l, 0))}
    </ul>
  );
}

function ListLabel({ list }: { list: List }) {
  return (
    <>
      <ListBullet list={list} size="xs" />
      <span dir="auto">{list.name}</span>
    </>
  );
}

function Tasks({
  list,
  parentId,
  depth,
  banned,
  open,
  toggle,
  onPick,
  current,
}: {
  list: List;
  parentId: string | null;
  depth: number;
  banned: Set<string>;
  open: Set<string>;
  toggle: (k: string) => void;
  onPick: (listId: string, parentId: string | null) => void;
  current?: string | null;
}) {
  const hub = useHub();
  const rows: Item[] = (parentId ? hub.childrenOf(parentId) : hub.children(list.id, null)).filter((i) => !i.done && !banned.has(i.id));
  return (
    <>
      {rows.map((t) => (
        <PlaceRow
          key={t.id}
          depth={depth}
          label={<span dir="auto">{t.title}</span>}
          expandable={depth < 3 && hub.childrenOf(t.id).some((c) => !c.done && !banned.has(c.id))}
          expanded={open.has(t.id)}
          onExpand={() => toggle(t.id)}
          onPick={() => onPick(list.id, t.id)}
          disabled={current === t.id}
          hint={current === t.id ? 'here now' : 'inside'}
        >
          {open.has(t.id) ? <Tasks list={list} parentId={t.id} depth={depth + 1} banned={banned} open={open} toggle={toggle} onPick={onPick} current={current} /> : null}
        </PlaceRow>
      ))}
    </>
  );
}

function PlaceRow({
  depth,
  label,
  expandable,
  expanded,
  onExpand,
  onPick,
  disabled,
  hint,
  children,
}: {
  depth: number;
  label: React.ReactNode;
  expandable: boolean;
  expanded: boolean;
  onExpand: () => void;
  onPick: () => void;
  disabled?: boolean;
  hint?: string;
  children?: React.ReactNode;
}) {
  // A long press opens it up instead of picking it.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);
  const start = () => {
    held.current = false;
    if (!expandable) return;
    timer.current = setTimeout(() => {
      held.current = true;
      onExpand();
    }, 450);
  };
  const stop = () => clearTimeout(timer.current);
  return (
    <li role="treeitem" aria-expanded={expandable ? expanded : undefined}>
      <div className="place__row" style={{ paddingInlineStart: 6 + depth * 18 }}>
        <button
          type="button"
          className="place__pick"
          disabled={disabled}
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
          onContextMenu={(e) => expandable && e.preventDefault()}
          onClick={() => {
            if (held.current) return;
            onPick();
          }}
        >
          {label}
          {hint ? <span className="place__hint">{hint}</span> : null}
        </button>
        {expandable ? (
          <button type="button" className={`place__open ${expanded ? 'is-open' : ''}`} aria-label={expanded ? 'Close' : 'Open'} onClick={onExpand}>
            <Icon name="chevron-down" className="icon--sm" />
          </button>
        ) : null}
      </div>
      {children ? <ul className="place__kids">{children}</ul> : null}
    </li>
  );
}

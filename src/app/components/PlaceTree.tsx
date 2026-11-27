import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Item, List } from '../../core/model';
import { isOpen } from '../../core/model';
import { useHub } from '../context';
import { fold } from '../../smart/normalize';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { G } from '../ui/glyphs';
import type { IconName } from '../ui/Icon';
import { FindField, ListBullet } from '../ui/primitives';
import { HOLD } from '../ui/tokens';

/** A place in the tree: a folder, or a task in one (its subtasks go under it). */
type Place = { listId: string; parentId: string | null };

const same = (a: Place | null | undefined, b: Place | null | undefined) => !!a && !!b && a.listId === b.listId && (a.parentId ?? null) === (b.parentId ?? null);

/**
 * The one tree for choosing where something goes: folders inside folders (folded into their
 * parent, a ⌄ or a long press opens one), and with `tasks` each folder's open tasks and their
 * subtasks (unfolded from the start). A search field on top narrows it. Tap a row to pick
 * it. Every "where" question in the app asks it this way: moving a task or a folder, Also in,
 * a filtered list's folder, a folder on Today, Show tasks from…, the composer's place.
 */
export function PlaceTree({
  onPick,
  tasks = false,
  value,
  current,
  offer,
  excludeList,
  excludeItem,
  disabled,
  hint,
  lead,
  root,
  scroll = false,
  label = 'Folders',
}: {
  /** A row was picked (null: the root row). */
  onPick: (place: Place | null) => void;
  /** Show tasks and subtasks under the folders. */
  tasks?: boolean;
  /** The one picked now: a check, and the tree opens the way down to it. */
  value?: Place | null;
  /** Where it is now: "here now", not pickable; the tree opens the way down to it. */
  current?: Place | null;
  /** Folders that can be picked; a folder that isn't but holds one that is stays, greyed. */
  offer?: (l: List) => boolean;
  /** A folder left out with everything inside it (moving a folder: never into its own insides). */
  excludeList?: string;
  /** A task left out with its subtasks (moving a task: never under itself). */
  excludeItem?: string;
  disabled?: (p: Place) => boolean;
  /** A word after a row's name. */
  hint?: (p: Place) => ReactNode;
  /** Before a folder's name (e.g. a switch). With a lead, tapping the name picks too. */
  lead?: (l: List) => ReactNode;
  /** A first row above the folders, picking null ("Folders, the top", "Any folder"). */
  root?: { label: string; icon: IconName; hint?: string; on?: boolean; here?: boolean };
  /** Keep it to a height and scroll (inside a small panel). */
  scroll?: boolean;
  label?: string;
}) {
  const hub = useHub();
  const banned = useMemo(() => new Set(excludeItem ? [excludeItem, ...hub.descendants(excludeItem).map((d) => d.id)] : []), [hub, excludeItem]);
  const outside = useMemo(() => new Set(excludeList ? hub.treeIds(excludeList) : []), [hub, excludeList]);
  const offered = (l: List) => !outside.has(l.id) && (!offer || offer(l));
  const subsOf = (id: string) => hub.subLists(id).filter((x) => !outside.has(x.id) && (offered(x) || hub.nestedLists(x.id).some(offered)));
  const tasksOf = (l: List, under: string | null): Item[] => (tasks && offered(l) ? hub.siblings(l.id, under).filter((i) => isOpen(i) && !banned.has(i.id)) : []);
  const tops = hub.topLists().filter((l) => !outside.has(l.id) && (offered(l) || hub.nestedLists(l.id).some(offered)));

  // Open from the start: the way down to what's picked and to where it is now.
  const [open, setOpen] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    const reveal = (p: Place | null | undefined) => {
      if (!p) return;
      for (const l of hub.listPath(p.listId)) keys.add(l.id);
      // Under a task, or among a folder's tasks: its folder opens too (subtasks are unfolded already).
      if (p.parentId || tasks) keys.add(p.listId);
    };
    reveal(current);
    reveal(value);
    return keys;
  });
  const toggle = (key: string) => {
    haptic('select');
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };

  const [q, setQ] = useState('');
  const query = fold(q.trim());
  // Searching: only what matches, and the way down to it, everything unfolded.
  const hits = useMemo(() => {
    if (!query) return null;
    const keep = new Set<string>();
    const has = (s: string) => fold(s).includes(query);
    const walkTasks = (l: List, under: string | null): boolean => {
      let any = false;
      for (const t of tasksOf(l, under)) {
        const inside = walkTasks(l, t.id);
        if (inside || has(t.title)) {
          keep.add(`i:${t.id}`);
          any = true;
        }
      }
      return any;
    };
    const walk = (l: List): boolean => {
      let any = has(l.name);
      for (const s of subsOf(l.id)) any = walk(s) || any;
      any = walkTasks(l, null) || any;
      if (any) keep.add(l.id);
      return any;
    };
    for (const l of tops) walk(l);
    return keep;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, hub]);

  const folderOpen = (id: string) => (hits ? hits.has(id) : open.has(id));
  const taskOpen = (id: string) => (hits ? true : !open.has(`shut:${id}`));
  const shown = (key: string) => !hits || hits.has(key);

  const taskRows = (l: List, under: string | null, depth: number): ReactNode[] =>
    tasksOf(l, under)
      .filter((t) => shown(`i:${t.id}`))
      .map((t) => {
        const p = { listId: l.id, parentId: t.id };
        const kids = tasksOf(l, t.id).length > 0;
        const here = same(current, p);
        return (
          <Row
            key={t.id}
            depth={depth}
            label={
              <>
                <Icon name={G.subtask} className="place__mark" />
                <span dir="auto">{t.title}</span>
              </>
            }
            on={same(value, p)}
            expandable={kids}
            expanded={taskOpen(t.id)}
            onExpand={() => toggle(`shut:${t.id}`)}
            onPick={() => onPick(p)}
            disabled={here || !!disabled?.(p)}
            hint={here ? 'here now' : hint?.(p)}
          >
            {kids && taskOpen(t.id) ? taskRows(l, t.id, depth + 1) : null}
          </Row>
        );
      });
  const folderRows = (ls: List[], depth: number): ReactNode[] =>
    ls
      .filter((l) => shown(l.id))
      .map((l) => {
        const p = { listId: l.id, parentId: null };
        const subs = subsOf(l.id);
        const expandable = subs.length > 0 || tasksOf(l, null).length > 0;
        const here = same(current, p);
        return (
          <Row
            key={l.id}
            depth={depth}
            lead={lead?.(l)}
            label={
              <>
                <ListBullet list={l} size="xs" />
                <span dir="auto">{l.name}</span>
              </>
            }
            on={same(value, p)}
            expandable={expandable}
            expanded={folderOpen(l.id)}
            onExpand={() => toggle(l.id)}
            onPick={() => onPick(p)}
            disabled={here || !offered(l) || !!disabled?.(p)}
            hint={here ? 'here now' : hint?.(p)}
          >
            {expandable && folderOpen(l.id) ? [...folderRows(subs, depth + 1), ...taskRows(l, null, depth + 1)] : null}
          </Row>
        );
      });

  const rows = folderRows(tops, 0);
  return (
    <div className={`placetree ${scroll ? 'placetree--scroll' : ''}`}>
      <FindField value={q} onChange={setQ} placeholder="Find a folder or task" />
      <ul className="place" role="tree" aria-label={label}>
        {root && !hits ? (
          <Row
            depth={0}
            label={
              <>
                <Icon name={root.icon} className="place__mark" />
                <span>{root.label}</span>
              </>
            }
            on={!!root.on}
            expandable={false}
            expanded={false}
            onExpand={() => undefined}
            onPick={() => onPick(null)}
            disabled={root.on || root.here}
            hint={root.here ? 'here now' : root.hint}
          />
        ) : null}
        {rows}
        {hits && !rows.length ? <li className="place__none">Nothing called “{q.trim()}”</li> : null}
      </ul>
    </div>
  );
}

/** One row: its lead, its name (pick), a word after it, and a ⌄ when it holds more. */
function Row({
  depth,
  lead,
  label,
  on,
  expandable,
  expanded,
  onExpand,
  onPick,
  disabled,
  hint,
  children,
}: {
  depth: number;
  lead?: ReactNode;
  label: ReactNode;
  on: boolean;
  expandable: boolean;
  expanded: boolean;
  onExpand: () => void;
  onPick: () => void;
  disabled?: boolean;
  hint?: ReactNode;
  children?: ReactNode;
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
    }, HOLD.press);
  };
  const stop = () => clearTimeout(timer.current);
  return (
    <li role="treeitem" aria-expanded={expandable ? expanded : undefined} aria-selected={on}>
      <div className={`place__row ${on ? 'is-on' : ''}`} style={{ '--depth': depth } as React.CSSProperties}>
        {lead}
        <button
          type="button"
          className="place__pick"
          aria-current={on || undefined}
          disabled={disabled}
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
          onContextMenu={(e) => expandable && e.preventDefault()}
          onClick={() => {
            if (held.current) return;
            haptic('tick');
            onPick();
          }}
        >
          {label}
          {hint ? <span className="place__hint">{hint}</span> : null}
          {on ? <Icon name={G.done} className="place__on" /> : null}
        </button>
        {expandable ? (
          <button type="button" className={`place__open ${expanded ? 'is-open' : ''}`} aria-label={expanded ? 'Fold' : 'Unfold'} aria-expanded={expanded} onClick={onExpand}>
            <Icon name={G.fold} className="icon--sm" />
          </button>
        ) : null}
      </div>
      {children ? <ul className="place__kids">{children}</ul> : null}
    </li>
  );
}

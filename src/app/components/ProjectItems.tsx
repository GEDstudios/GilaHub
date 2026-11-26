import { useEffect, useRef } from 'react';
import type { Item } from '../../core/model';
import { useHub } from '../context';
import { navigate } from '../router';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { ListBullet } from '../ui/primitives';
import { Sortable, useSortableItem, type Point } from '../ui/Sortable';
import { SettleContext, useSettle } from '../ui/useSettle';
import type { ProjectGroup } from '../views';
import { ItemRow } from './ItemRow';
import { TagMark } from './Tags';

const idOf = (i: Item) => i.id;

/** The project under the hand, if any: one marked [data-drop-list], or a project's tab in the bar. */
function dropListAt(p: Point): { el: HTMLElement; listId: string } | null {
  for (const e of document.elementsFromPoint(p.x, p.y)) {
    const t = e.closest<HTMLElement>('[data-drop-list], .tabbar [data-key^="l:"]');
    if (!t) continue;
    const listId = t.dataset.dropList ?? t.dataset.key?.slice(2);
    if (listId) return { el: t, listId };
  }
  return null;
}

type RowProps = { item: Item; settling?: boolean; showList?: boolean; skipTag?: string | null; flash?: boolean };

function SortableRow(p: RowProps) {
  const s = useSortableItem(p.item.id, { disabled: p.settling });
  return <ItemRow {...p} liRef={s.ref} liStyle={s.style} liClass={s.className} dragProps={s.props} />;
}

/**
 * A project's open things, the same for every project: the Urgent card on top, then one group
 * (a plain list), a group per tag (the aisles, in our order), or one per project inside. Hold a
 * row to move it; drop it in another group and it takes that tag, or moves to that project.
 * Ticked rows strike and fold before they leave for the tray.
 */
export function ProjectItems({
  groups: live,
  urgent,
  cards,
  draggable,
  showList,
  flash,
}: {
  groups: ProjectGroup[];
  urgent: Item[];
  cards: boolean;
  draggable: boolean;
  /** Rows say which project they're in (a tag's group mixes projects). */
  showList: boolean;
  flash: Set<string>;
}) {
  const hub = useHub();
  const { toast } = useOverlays();
  const settle = useSettle(idOf);
  // A group whose last thing was just ticked stays until that row has settled.
  const last = useRef<ProjectGroup[]>([]);
  const groups = [...live];
  last.current.forEach((g, at) => {
    if (!groups.some((x) => x.key === g.key) && g.items.some((i) => settle.held.has(i.id))) groups.splice(Math.min(at, groups.length), 0, { ...g, items: [] });
  });
  last.current = live;

  const ids = groups.flatMap((g) => g.items.map((i) => i.id));
  const groupOf = new Map(groups.flatMap((g) => g.items.map((i) => [i.id, g] as const)));
  const lastPt = useRef<[number, number] | null>(null);
  useEffect(() => {
    const track = (e: PointerEvent) => {
      lastPt.current = [e.clientX, e.clientY];
    };
    window.addEventListener('pointermove', track, { capture: true, passive: true });
    return () => window.removeEventListener('pointermove', track, { capture: true });
  }, []);

  // Drop a task on a project (a folder here, a step of the path, a project in the bar): it moves there.
  const lifted = useRef<string | null>(null);
  const lit = useRef<HTMLElement | null>(null);
  const light = (el: HTMLElement | null) => {
    if (lit.current === el) return;
    lit.current?.classList.remove('is-droptarget');
    el?.classList.add('is-droptarget');
    if (el) haptic('select');
    lit.current = el;
  };
  const into = {
    hit: (p: Point) => {
      const t = dropListAt(p);
      return !!t && t.listId !== hub.item(lifted.current)?.listId;
    },
    aim: (p: Point | null) => light(p ? (dropListAt(p)?.el ?? null) : null),
    drop: (id: string, p: Point) => {
      const t = dropListAt(p);
      const item = hub.item(id);
      const to = hub.list(t?.listId);
      light(null);
      if (!t || !item || !to) return;
      const was = { listId: item.listId, parentId: item.parentId ?? null };
      hub.move(id, { listId: to.id, parentId: null });
      haptic('success');
      toast(`Moved to ${to.name}`, { action: { label: 'Undo', run: () => hub.move(id, was) } });
    },
    lift: (id: string) => {
      lifted.current = id;
    },
    end: () => {
      lifted.current = null;
      light(null);
    },
  };

  const onMove = (next: string[], id: string) => {
    const from = groupOf.get(id);
    if (!from) return;
    const at = next.indexOf(id);
    // Where it landed: the group under the hand, else the one it now sits beside.
    const pt = lastPt.current;
    const key = pt ? document.elementsFromPoint(pt[0], pt[1]).map((e) => e.closest('[data-group]')?.getAttribute('data-group')).find(Boolean) : null;
    const to = groups.find((g) => g.key === key) ?? groupOf.get(next[at - 1]) ?? groupOf.get(next[at + 1]) ?? from;
    if (to !== from) {
      if (to.tag !== undefined) {
        hub.moveToTag(id, from.tag ?? null, to.tag);
        toast(to.tag ? `Tagged ${hub.tag(to.tag)?.name ?? ''}` : 'Untagged');
      } else if (to.listId) {
        hub.move(id, { listId: to.listId });
        toast(`Moved to ${hub.list(to.listId)?.name ?? 'there'}`);
      }
      haptic('drop');
    }
    hub.reorderIn(
      next.filter((x) => x === id || groupOf.get(x) === to),
      id,
    );
  };

  const rowsClass = `rows ${cards ? 'rows--cards' : ''}`;
  const shownUrgent = settle.view('urgent', urgent);
  const body = (
    <>
      {groups.map((g) => {
        const shown = settle.view(g.key, g.items);
        if (!shown.length && g.label) return null;
        const list = g.listId ? hub.list(g.listId) : undefined;
        // Rows name their project only where the group mixes projects.
        const mixed = showList && new Set(g.items.map((i) => i.listId)).size > 1;
        return (
          <section key={g.key} className={`aisle ${g.label ? '' : 'aisle--plain'}`} aria-label={g.label ?? undefined} data-group={g.key}>
            {g.label ? (
              <h2 className="aisle__head">
                {g.tag !== undefined ? (
                  <TagMark icon={g.tag ? g.icon : null} className="" />
                ) : list ? (
                  <button type="button" className="aisle__go" onClick={() => navigate({ name: 'list', id: list.id })}>
                    <ListBullet list={list} size="xs" />
                  </button>
                ) : null}
                {g.label}
                <span className="num">{g.items.length}</span>
              </h2>
            ) : null}
            <ul className={rowsClass}>
              {shown.map(({ row: i, settling }) =>
                draggable && !settling ? (
                  <SortableRow key={i.id} item={i} showList={mixed} skipTag={g.tag} flash={flash.has(i.id)} />
                ) : (
                  <ItemRow key={i.id} item={i} showList={mixed} skipTag={g.tag} settling={settling} flash={flash.has(i.id)} />
                ),
              )}
            </ul>
          </section>
        );
      })}
    </>
  );

  return (
    <SettleContext.Provider value={settle}>
      {shownUrgent.length ? (
        // The page's one lemon card: what's urgent, in the page's order (by tag: the walk).
        <section className="aisle aisle--urgent" aria-label="Urgent">
          <ul className={rowsClass}>
            <li className="aisle__cap">
              <h2 className="aisle__captitle">Urgent</h2>
              <span className="ccard__badge num">{urgent.length}</span>
            </li>
            {shownUrgent.map(({ row: i, settling }) => (
              <ItemRow key={i.id} item={i} showList={showList && new Set(urgent.map((u) => u.listId)).size > 1} inUrgent settling={settling} flash={flash.has(i.id)} />
            ))}
          </ul>
        </section>
      ) : null}
      {draggable ? (
        <Sortable
          ids={ids}
          onMove={onMove}
          layout={cards ? 'grid' : 'rows'}
          bounds="none"
          outside={into}
          label={(id) => hub.item(id)?.title ?? ''}
          renderOverlay={(id, { outside }) => {
            const item = hub.item(id);
            // Over a project: the task as a small chip, going in.
            if (item && outside)
              return (
                <span className="dropchip">
                  <Icon name="move" className="icon--sm" />
                  <span dir="auto">{item.title}</span>
                </span>
              );
            return item ? (
              <ul className={rowsClass}>
                <ItemRow item={item} showList={showList} skipTag={groupOf.get(id)?.tag} />
              </ul>
            ) : null;
          }}
        >
          {body}
        </Sortable>
      ) : (
        body
      )}
    </SettleContext.Provider>
  );
}

/**
 * Just done: what was ticked here and not cleared yet, as itself. It fills as you tick (each
 * thing drops in), the bar shows how much of this round is done, a tap puts a thing back, and
 * Clear files them away (Again? remembers). The same in every project; after 12h it clears itself.
 */
export function DoneTray({ items, left, onOut, onClear, strong }: { items: Item[]; left: number; onOut: (i: Item) => void; onClear: () => void; strong: boolean }) {
  const hub = useHub();
  const total = items.length + left;
  const pct = total ? Math.round((items.length / total) * 100) : 100;
  return (
    <section className={`cartcard ${left === 0 ? 'is-full' : ''}`} aria-label={`Just done: ${items.length} of ${total}`}>
      <div className="cartcard__head">
        <span className="cartcard__basket" key={items.length}>
          <Icon name="check" />
          <span className="cartcard__n num">{items.length}</span>
        </span>
        <span className="cartcard__title">Just done</span>
        <span className="cartcard__bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="cartcard__of num">
          {items.length}/{total}
        </span>
      </div>
      <div className="cartcard__items">
        {items.map((i) => {
          const e = hub.emojiOf(i);
          return (
            <button key={i.id} type="button" className="cartchip" onClick={() => onOut(i)} aria-label={`Put ${i.title} back`}>
              {e ? <span className="cartchip__e">{e}</span> : <Icon name="check" className="icon--xs" />}
              <span dir="auto">{i.title}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className={`btn btn--sm cartcard__pay ${strong || left === 0 ? '' : 'btn--quiet'}`} onClick={onClear}>
        Clear
      </button>
    </section>
  );
}

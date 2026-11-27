import { useEffect, useMemo, useRef, useState } from 'react';
import type { Item } from '../../core/model';
import { useHub } from '../context';
import { haptic } from '../ui/haptics';
import { useOverlays } from '../ui/overlays';
import type { Outside, Point } from '../ui/Sortable';
import { movedTo } from './TemplateAsk';
import { useOnce } from '../ui/useOnce';
import { Icon } from '../ui/Icon';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { DIST } from '../ui/tokens';
import { SettleContext, useSettle } from '../ui/useSettle';
import { ItemRow } from './ItemRow';
import { Disclosure } from '../ui/primitives';
import { G } from '../ui/glyphs';
import { isTouch } from '../ui/pointer';

const idOf = (i: Item) => i.id;

function SortableRow({ item, settling }: { item: Item; settling: boolean }) {
  const s = useSortableItem(item.id, { disabled: settling });
  return <ItemRow item={item} settling={settling} liRef={s.ref} liStyle={s.style} liClass={s.className} dragProps={s.props} />;
}

/** A number that bumps when it goes up. */
function Count({ n }: { n: number }) {
  const prev = useRef(n);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (n > prev.current) setBump((b) => b + 1);
    prev.current = n;
  }, [n]);
  return (
    <span key={bump} className={bump ? 'bump' : undefined}>
      {n}
    </span>
  );
}

/** A step of the path above at the hand: a folder (out on its own there) or a task further up (under it). */
function stepAt(p: Point): { el: HTMLElement; list?: string; item?: string } | null {
  for (const e of document.elementsFromPoint(p.x, p.y)) {
    const t = e.closest<HTMLElement>('.crumbs [data-drop-list], .crumbs [data-drop-item]');
    if (t) return { el: t, list: t.dataset.dropList, item: t.dataset.dropItem };
  }
  return null;
}

/**
 * A subtask dragged up onto the path (Folders › Home › Paint the hall): let go on a folder and
 * it's a task of its own there; on a task further up, it's that task's subtask instead. Onto a
 * sister subtask's middle (or pulled right, under the one above), it's a subtask of that one.
 */
function useLiftOut(parentId: string | null): Outside | undefined {
  const hub = useHub();
  const overlays = useOverlays();
  const lit = useRef<HTMLElement | null>(null);
  return useMemo(() => {
    if (!parentId) return undefined;
    const light = (el: HTMLElement | null) => {
      if (lit.current === el) return;
      lit.current?.classList.remove('is-droptarget');
      el?.classList.add('is-droptarget');
      if (el) haptic('select');
      lit.current = el;
    };
    // Where the hand was when the drag began (the first aim after a lift), for "pulled right".
    let liftX: number | null = null;
    let lifted: string | null = null;
    /** Onto a sister subtask's middle, or pulled right under the one above: a subtask of it. */
    const nestAt = (p: Point): { el: HTMLElement; id: string } | null => {
      if (!lifted) return null;
      const rows = [...document.querySelectorAll<HTMLElement>('li.row[data-id]')]
        .filter((li) => li.dataset.id !== lifted && !li.closest('.dragwrap') && hub.item(li.dataset.id)?.parentId === parentId)
        .map((li) => {
          const r = li.getBoundingClientRect();
          const t = getComputedStyle(li).transform;
          const top = r.top - (t === 'none' ? 0 : new DOMMatrixReadOnly(t).m42);
          return { li, id: li.dataset.id!, top, height: r.height, left: r.left, right: r.right };
        });
      const ok = (id: string) => !hub.item(id)?.done;
      for (const r of rows) {
        const band = (p.y - r.top) / r.height;
        if (p.x < r.left || p.x > r.right || band < 0.3 || band > 0.7) continue;
        return ok(r.id) ? { el: r.li, id: r.id } : null;
      }
      if (liftX !== null && p.x - liftX > DIST.nest) {
        const above = rows.filter((r) => r.top + r.height / 2 < p.y).sort((a, b) => b.top - a.top)[0];
        return above && ok(above.id) ? { el: above.li, id: above.id } : null;
      }
      return null;
    };
    const targetAt = (p: Point): { el: HTMLElement; list?: string; item?: string } | null => {
      const step = stepAt(p);
      if (step) return step;
      const n = nestAt(p);
      return n ? { el: n.el, item: n.id } : null;
    };
    return {
      lift: (id) => {
        lifted = id;
        liftX = null;
      },
      hit: (p) => {
        if (liftX === null) liftX = p.x;
        return !!targetAt(p);
      },
      aim: (p) => light(p ? (targetAt(p)?.el ?? null) : null),
      drop: (id, p) => {
        const t = targetAt(p);
        light(null);
        const item = hub.item(id);
        if (!t || !item) return;
        const was = { listId: item.listId, parentId: item.parentId ?? null };
        const to = t.item ? { listId: hub.item(t.item)?.listId ?? item.listId, parentId: t.item } : { listId: t.list ?? item.listId, parentId: null };
        hub.move(id, to);
        haptic('success');
        const where = to.parentId ? `under “${hub.item(to.parentId)?.title ?? 'it'}”` : `its own task in ${hub.list(to.listId)?.name ?? 'there'}`;
        movedTo(hub, overlays, id, was.listId, to.parentId ? was.listId : to.listId, `${item.title}: ${where}`, () => hub.move(id, was));
      },
      end: () => {
        light(null);
        lifted = null;
        liftX = null;
      },
    };
  }, [hub, overlays, parentId]);
}

/**
 * Open items (hold to reorder), then the add row, then a collapsible Done group.
 * Ticked rows settle before they leave.
 */
export function Children({
  listId,
  parentId,
  readonly,
  cards,
  show,
}: {
  listId: string;
  parentId: string | null;
  readonly?: boolean;
  cards?: boolean;
  /** A screen's filter: only these (a task shows when it or one of its subtasks passes). */
  show?: (i: Item) => boolean;
}) {
  const hub = useHub();
  const settle = useSettle(idOf);
  const all = hub.siblings(listId, parentId).filter((i) => !show || show(i));
  const open = all.filter((i) => !i.done);
  const done = all.filter((i) => i.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const rows = settle.view('open', open);
  const doneRows = settle.view('done', done);
  const [coach, coached] = useOnce('reorder', !readonly && open.length >= 3);
  const liftOut = useLiftOut(readonly ? null : parentId);

  const onMove = (next: string[], id: string) => {
    const at = next.indexOf(id);
    hub.reorder(id, next[at - 1] ?? null, next[at + 1] ?? null);
  };

  return (
    <SettleContext.Provider value={settle}>
      {readonly ? (
        <ul className={`rows ${cards ? 'rows--cards' : ''}`}>
          {rows.map(({ row, settling }) => (
            <ItemRow key={row.id} item={row} settling={settling} />
          ))}
        </ul>
      ) : (
        <Sortable
          ids={open.map(idOf)}
          layout={cards ? 'grid' : 'rows'}
          onMove={onMove}
          onLift={coached}
          outside={liftOut}
          // With the path to drop on, the row may leave its list's edges.
          bounds={liftOut ? 'none' : undefined}
          label={(id) => hub.item(id)?.title ?? ''}
          renderOverlay={(id, { outside }) => {
            const item = hub.item(id);
            // Over a step of the path: a small chip, going out.
            if (item && outside)
              return (
                <span className="dropchip">
                  <Icon name={G.move} className="icon--sm" />
                  <span dir="auto">{item.title}</span>
                </span>
              );
            return item ? (
              <ul className={`rows ${cards ? 'rows--cards' : ''}`}>
                <ItemRow item={item} />
              </ul>
            ) : null;
          }}
        >
          <ul className={`rows ${cards ? 'rows--cards' : ''}`}>
            {rows.map(({ row, settling }) => (
              <SortableRow key={row.id} item={row} settling={settling} />
            ))}
          </ul>
        </Sortable>
      )}
      {coach ? (
        <p className="coach">
          <Icon name={G.holdHint} className="icon--sm" />
          {isTouch() ? `Hold any ${cards ? 'card' : 'row'} to reorder` : `Drag any ${cards ? 'card' : 'row'} to reorder`}
        </p>
      ) : null}
      {doneRows.length ? (
        <Disclosure title="Done" count={<Count n={doneRows.length} />}>
          <ul className="rows">
            {doneRows.map(({ row }) => (
              <ItemRow key={row.id} item={row} />
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </SettleContext.Provider>
  );
}

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
import type { ChipKind } from '../ui/dragOut';
import { dropMarks, lineBy, restRect, type Landing } from '../ui/dropMark';
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

type Lift = Landing & { kind: ChipKind; listId?: string; parentId: string | null; before?: string | null };

/**
 * A subtask on its task's page, held: besides reordering among its sisters (the list's own drag),
 *   onto a sister's middle, or pulled right under the one above   under that one (a deeper subtask)
 *   pulled left                                                   out: a task of its own, right
 *                                                                 after this one (its step of the
 *                                                                 path darkens: that's where)
 *   onto a step of the path                                       a task of its own in that folder,
 *                                                                 or under that task further up
 * The chip in the hand says which (`kind`).
 */
function useLiftOut(parentId: string | null, onKind: (k: ChipKind) => void): Outside | undefined {
  const hub = useHub();
  const overlays = useOverlays();
  return useMemo(() => {
    if (!parentId) return undefined;
    const mark = dropMarks();
    // Where the hand was when the drag began (the first aim after a lift), for "pulled right / left".
    let liftX: number | null = null;
    let lifted: string | null = null;
    let kind: ChipKind | null = null;
    /** Onto a sister subtask's middle, or pulled right under the one above: a subtask of it. */
    const nestAt = (p: Point): { el: HTMLElement; id: string } | null => {
      if (!lifted) return null;
      const rows = [...document.querySelectorAll<HTMLElement>('li.row[data-id]')]
        .filter((li) => li.dataset.id !== lifted && !li.closest('.dragwrap') && hub.item(li.dataset.id)?.parentId === parentId)
        .map((li) => ({ li, id: li.dataset.id!, ...restRect(li) }));
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
    const targetAt = (p: Point): Lift | null => {
      const step = stepAt(p);
      if (step) return { into: step.el, kind: step.item ? 'subtask' : 'move', listId: step.list, parentId: step.item ?? null };
      const task = hub.item(parentId);
      if (task && liftX !== null && liftX - p.x > DIST.nest) {
        const sis = hub.siblings(task.listId, task.parentId ?? null);
        const where = task.parentId ? `.crumbs [data-drop-item="${task.parentId}"]` : `.crumbs [data-drop-list="${task.listId}"]`;
        return {
          into: document.querySelector<HTMLElement>(where),
          kind: 'move',
          listId: task.listId,
          parentId: task.parentId ?? null,
          before: sis[sis.findIndex((x) => x.id === task.id) + 1]?.id ?? null,
        };
      }
      const n = nestAt(p);
      return n ? { into: n.el, line: lineBy(n.el, 'bottom', true), kind: 'subtask', parentId: n.id } : null;
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
      aim: (p) => {
        const t = p ? targetAt(p) : null;
        mark(t);
        // (Here, in the frame loop, not in hit: that runs while the list renders.)
        if (t && t.kind !== kind) onKind((kind = t.kind));
      },
      drop: (id, p) => {
        const t = targetAt(p);
        mark(null);
        const item = hub.item(id);
        if (!t || !item) return;
        const was = { listId: item.listId, parentId: item.parentId ?? null };
        const to = { listId: t.parentId ? (hub.item(t.parentId)?.listId ?? item.listId) : (t.listId ?? item.listId), parentId: t.parentId, before: t.before ?? undefined };
        hub.move(id, to);
        haptic('success');
        const where = to.parentId ? `under “${hub.item(to.parentId)?.title ?? 'it'}”` : `its own task in ${hub.list(to.listId)?.name ?? 'there'}`;
        movedTo(hub, overlays, id, was.listId, to.parentId ? was.listId : to.listId, `${item.title}: ${where}`, () => hub.move(id, was));
      },
      end: () => {
        mark(null);
        lifted = null;
        liftX = null;
        kind = null;
      },
    };
  }, [hub, overlays, parentId, onKind]);
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
  const [chip, setChip] = useState<ChipKind>('move');
  const liftOut = useLiftOut(readonly ? null : parentId, setChip);

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
            // Over where it goes in: a small chip saying how (under a task, or out on its own).
            if (item && outside)
              return (
                <span className="dropchip">
                  <Icon name={chip === 'subtask' ? G.subtask : G.move} className="icon--sm" />
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

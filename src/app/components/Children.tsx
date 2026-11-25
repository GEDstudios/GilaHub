import { useEffect, useRef, useState } from 'react';
import type { Item } from '../../core/model';
import { useHub } from '../context';
import { useOnce } from '../ui/useOnce';
import { Icon } from '../ui/Icon';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { SettleContext, useSettle } from '../ui/useSettle';
import { ItemRow } from './ItemRow';
import { AddRow } from './QuickAdd';
import { Section } from '../ui/primitives';

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

/**
 * Open items (hold to reorder), then the add row, then a collapsible Done group.
 * Ticked rows settle before they leave.
 */
export function Children({
  listId,
  parentId,
  readonly,
  add,
}: {
  listId: string;
  parentId: string | null;
  readonly?: boolean;
  /** The in-place add, between the open rows and Done. */
  add?: { placeholder?: string; onAdded?: (id: string) => void };
}) {
  const hub = useHub();
  const settle = useSettle(idOf);
  const [showDone, setShowDone] = useState(false);
  const all = parentId ? hub.childrenOf(parentId) : hub.children(listId, null);
  const open = all.filter((i) => !i.done);
  const done = all.filter((i) => i.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const rows = settle.view('open', open);
  const doneRows = settle.view('done', done);
  const [coach, coached] = useOnce('reorder', !readonly && open.length >= 3);

  const onMove = (next: string[], id: string) => {
    const at = next.indexOf(id);
    hub.reorder(id, next[at - 1] ?? null, next[at + 1] ?? null);
  };

  return (
    <SettleContext.Provider value={settle}>
      {readonly ? (
        <ul className="rows">
          {rows.map(({ row, settling }) => (
            <ItemRow key={row.id} item={row} settling={settling} />
          ))}
        </ul>
      ) : (
        <Sortable
          ids={open.map(idOf)}
          onMove={onMove}
          onLift={coached}
          label={(id) => hub.item(id)?.title ?? ''}
          renderOverlay={(id) => {
            const item = hub.item(id);
            return item ? (
              <ul className="rows">
                <ItemRow item={item} />
              </ul>
            ) : null;
          }}
        >
          <ul className="rows">
            {rows.map(({ row, settling }) => (
              <SortableRow key={row.id} item={row} settling={settling} />
            ))}
          </ul>
        </Sortable>
      )}
      {coach ? (
        <p className="coach">
          <Icon name="hand" className="icon--sm" />
          {matchMedia('(pointer: coarse)').matches ? 'Hold any row to reorder' : 'Drag any row to reorder'}
        </p>
      ) : null}
      {add && !readonly ? <AddRow listId={listId} parentId={parentId} placeholder={add.placeholder} onAdded={add.onAdded} /> : null}
      {doneRows.length ? (
        <Section
          title="Done"
          count={<Count n={doneRows.length} />}
          action={
            <button type="button" className="textbtn" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
              {showDone ? 'Hide' : 'Show'}
            </button>
          }
        >
          {showDone ? (
            <ul className="rows">
              {doneRows.map(({ row }) => (
                <ItemRow key={row.id} item={row} />
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}
    </SettleContext.Provider>
  );
}

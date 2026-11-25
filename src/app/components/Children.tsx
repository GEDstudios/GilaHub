import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import type { Item } from '../../core/model';
import { useHub } from '../context';
import { haptic } from '../ui/haptics';
import { ItemRow } from './ItemRow';

function SortableRow({ item, fresh }: { item: Item; fresh?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <ItemRow
      item={item}
      fresh={fresh}
      liRef={setNodeRef}
      liStyle={{ transform: CSS.Translate.toString(transform), transition }}
      liClass={isDragging ? 'dragging' : ''}
      dragProps={{ ...attributes, ...listeners, role: undefined, tabIndex: undefined }}
    />
  );
}

/** Open items (drag to reorder) + a collapsible done group. */
export function Children({ listId, parentId, freshId, readonly }: { listId: string; parentId: string | null; freshId?: string | null; readonly?: boolean }) {
  const hub = useHub();
  const [showDone, setShowDone] = useState(false);
  const all = parentId ? hub.childrenOf(parentId) : hub.children(listId, null);
  const open = all.filter((i) => !i.done);
  const done = all.filter((i) => i.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = open.map((i) => i.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    const next = arrayMove(ids, from, to);
    const at = next.indexOf(String(active.id));
    hub.reorder(String(active.id), next[at - 1] ?? null, next[at + 1] ?? null);
  };

  return (
    <>
      {readonly ? (
        <ul className="rows">
          {open.map((i) => (
            <ItemRow key={i.id} item={i} />
          ))}
        </ul>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => haptic()} onDragEnd={onDragEnd}>
          <SortableContext items={open.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ul className="rows">
              {open.map((i) => (
                <SortableRow key={i.id} item={i} fresh={i.id === freshId} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {done.length ? (
        <>
          <button type="button" className="donetoggle" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            {showDone ? 'Hide' : 'Show'} {done.length} done
          </button>
          {showDone ? (
            <ul className="rows">
              {done.map((i) => (
                <ItemRow key={i.id} item={i} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </>
  );
}

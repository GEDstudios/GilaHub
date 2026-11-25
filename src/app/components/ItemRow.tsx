import { memo, type CSSProperties, type ReactNode, type Ref } from 'react';
import { diffDays, humanDate, humanTime, sinceDate, weekdayName } from '../../core/dates';
import type { Item } from '../../core/model';
import { describeRule } from '../../smart/recurrence';
import { useHub } from '../context';
import { use24h, usePrefs } from '../prefs';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Check, Diamond, ListBullet, PersonBullet, StepRing } from '../ui/primitives';
import { stepProgress, todayRef } from '../views';

export function dueLabel(item: Item, ref: string, h24: boolean): { text: string; soft: boolean } | null {
  if (!item.due) return null;
  const time = item.dueTime ? humanTime(item.dueTime, h24) : '';
  if (item.due < ref) return { text: sinceDate(item.due, ref), soft: true };
  if (item.due === ref) return time ? { text: time, soft: false } : null;
  const d = humanDate(item.due, ref);
  return { text: time ? `${d} · ${time}` : d, soft: false };
}

/** Who carries this item: the owner of a "Mine" item, or the assignee of an "Ours" one. */
export function useCarrier(item: Item) {
  const hub = useHub();
  const owner = hub.ownerOf(item);
  if (owner) return hub.member(owner);
  if (item.assignee === 'turns') return hub.member(item.turn);
  if (item.assignee && item.assignee !== 'both') return hub.member(item.assignee);
  return undefined;
}

export const ItemRow = memo(function ItemRow({
  item,
  showList,
  dateMode = 'full',
  trailing,
  fresh,
  liRef,
  liStyle,
  liClass,
  dragProps,
}: {
  item: Item;
  showList?: boolean;
  dateMode?: 'full' | 'none';
  trailing?: ReactNode;
  fresh?: boolean;
  liRef?: Ref<HTMLLIElement>;
  liStyle?: CSSProperties;
  liClass?: string;
  dragProps?: Record<string, unknown>;
}) {
  const hub = useHub();
  const prefs = usePrefs();
  const { toast } = useOverlays();
  const list = hub.list(item.listId);
  const ref = todayRef();
  const canTick = hub.canTick(item);
  const steps = stepProgress(hub, item.id);
  const carrier = useCarrier(item);
  const vis = hub.visibilityOf(item);
  const due = dateMode === 'full' ? dueLabel(item, ref, use24h(prefs)) : null;
  const readonly = !hub.canEdit(item);

  const onToggle = () => {
    if (!canTick) {
      toast(`That one is ${hub.member(hub.ownerOf(item))?.name ?? 'theirs'}’s to tick off.`);
      return;
    }
    if (item.repeat && !item.done) {
      const undo = hub.completeRepeating(item.id);
      const next = hub.item(item.id)?.due;
      toast(next ? `Nice. Next time: ${humanDate(next, ref)}` : 'Nice.', { action: { label: 'Undo', run: undo } });
      return;
    }
    const openSteps = !item.done ? hub.descendants(item.id).filter((d) => !d.done).length : 0;
    const undo = hub.toggle(item.id);
    if (openSteps) {
      toast(`Done. ${openSteps} step${openSteps > 1 ? 's' : ''} still open.`, {
        action: {
          label: 'Finish them',
          run: () => {
            undo();
            hub.toggle(item.id, { withChildren: true });
          },
        },
      });
    }
  };

  return (
    <li
      ref={liRef}
      style={liStyle}
      {...dragProps}
      className={`row row--tap ${item.done ? 'is-done' : ''} ${readonly ? 'row--readonly' : ''} ${fresh ? 'row--fresh' : ''} ${liClass ?? ''}`}
      onClick={() => navigate({ name: 'item', id: item.id })}
    >
      <Check on={item.done} color={list?.color} onToggle={onToggle} label={item.title} disabled={false} />
      <div className="row__body">
        <span className="row__title" dir="auto">
          {item.title || 'Untitled'}
        </span>
        <span className="row__meta">
          {showList && list ? (
            <span className="meta">
              <ListBullet list={list} size="xs" />
              <span dir="auto">{list.name}</span>
            </span>
          ) : null}
          {due ? <span className={`meta ${due.soft ? 'meta--soft' : ''}`}>{due.text}</span> : null}
          {item.repeat ? (
            <span className="meta" title={describeRule(item.repeat, (n) => weekdayName(n))}>
              <Icon name="repeat" />
            </span>
          ) : null}
          {item.remind !== null && item.remind !== undefined && item.due ? (
            <span className="meta">
              <Icon name="bell" />
            </span>
          ) : null}
          {steps.total ? (
            <span className="meta steps">
              <StepRing done={steps.done} total={steps.total} />
              {steps.done}/{steps.total}
            </span>
          ) : null}
          {item.notes ? (
            <span className="meta">
              <Icon name="note" />
            </span>
          ) : null}
          {vis === 'private' && list?.visibility !== 'private' ? (
            <span className="meta" title="Only me">
              <Icon name="lock" />
            </span>
          ) : null}
        </span>
      </div>
      <span className="row__trail">
        {trailing}
        {item.urgent ? <Diamond /> : null}
        {carrier && (list?.visibility === 'shared' || carrier.id !== list?.owner) ? <PersonBullet member={carrier} size="sm" /> : null}
      </span>
    </li>
  );
});

/** "since Tue" → quick catch-up actions, for the From earlier group. */
export function catchUpDays(due: string, ref: string): number {
  return diffDays(due, ref);
}

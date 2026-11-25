import { memo, type CSSProperties, type ReactNode, type Ref } from 'react';
import { diffDays, humanDate, humanTime, sinceDate, weekdayName } from '../../core/dates';
import type { Item } from '../../core/model';
import { describeRule } from '../../smart/recurrence';
import { useHub, useRt } from '../context';
import { afterTick } from '../notify';
import { use24h, usePrefs } from '../prefs';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { doneMany, useOverlays } from '../ui/overlays';
import { doerOf, requestState, visTagFor } from '../privacy';
import { Avatar, Check, ListBullet, StepRing } from '../ui/primitives';
import { ReqTag, UrgentTag, VisTag } from '../ui/tags';
import { useFresh } from '../ui/fresh';
import { useSettleHold } from '../ui/useSettle';
import { stepProgress, todayRef } from '../views';

export function dueLabel(item: Item, ref: string, h24: boolean): { text: string; soft: boolean } | null {
  if (!item.due) return null;
  const time = item.dueTime ? humanTime(item.dueTime, h24) : '';
  if (item.due < ref) return { text: sinceDate(item.due, ref), soft: true };
  if (item.due === ref) return time ? { text: time, soft: false } : null;
  const d = humanDate(item.due, ref);
  return { text: time ? `${d} · ${time}` : d, soft: false };
}

/** Who does it, for a row's avatar (see doerOf): never the owner, never someone asked. */
export function useDoer(item: Item) {
  return doerOf(useHub(), item);
}

export const ItemRow = memo(function ItemRow({
  item,
  showList,
  dateMode = 'full',
  trailing,
  below,
  settling,
  liRef,
  liStyle,
  liClass,
  dragProps,
}: {
  item: Item;
  showList?: boolean;
  dateMode?: 'full' | 'none';
  trailing?: ReactNode;
  /** Under the text, e.g. OK / Not yet (RequestActions className="row__acts"). */
  below?: ReactNode;
  /** Just ticked: drawn checked while it strikes through and folds away (useSettle). */
  settling?: boolean;
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
  const doer = useDoer(item);
  const req = requestState(hub, item);
  const vis = visTagFor(hub, item);
  const due = dateMode === 'full' ? dueLabel(item, ref, use24h(prefs)) : null;
  const readonly = !hub.canEdit(item);
  const rt = useRt();
  const hold = useSettleHold();
  const fresh = useFresh(item.id);
  // The owner never shows as an avatar (the privacy tag says whose); my own avatar only where it tells something.
  const avatar = !trailing && doer && (list?.visibility === 'shared' || doer.id !== list?.owner) ? doer : undefined;

  const onToggle = () => {
    if (!canTick) {
      toast(`That one is ${hub.member(hub.ownerOf(item))?.name ?? 'theirs'}’s to tick off.`);
      return;
    }
    if (!item.done) hold?.(item.id);
    if (item.repeat && !item.done) {
      const undo = hub.completeRepeating(item.id);
      const next = hub.item(item.id)?.due;
      toast(next ? `Nice. Next time: ${humanDate(next, ref)}` : 'Nice.', { action: { label: 'Undo', run: undo } });
      return;
    }
    const openSteps = !item.done && !item.needsOk ? hub.descendants(item.id).filter((d) => !d.done).length : 0;
    const undo = hub.toggle(item.id);
    const msg = afterTick(rt, hub, item.id);
    if (msg) {
      toast(msg, { action: { label: 'Undo', run: undo } });
      return;
    }
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
      return;
    }
    if (!item.done) toast('Done', { action: { label: 'Undo', run: undo }, group: 'done', many: doneMany });
  };

  return (
    <li
      ref={liRef}
      style={liStyle}
      {...dragProps}
      data-settle={item.id}
      data-id={item.id}
      className={`row row--tap ${item.done ? 'is-done' : ''} ${item.submittedAt && !item.done ? 'is-pending' : ''} ${readonly ? 'row--readonly' : ''} ${fresh ? 'row--fresh row--flash' : ''} ${settling ? 'is-settling' : ''} ${liClass ?? ''}`}
      onClick={() => navigate({ name: 'item', id: item.id })}
    >
      <Check on={item.done || !!settling} color={list?.color} onToggle={onToggle} label={item.title} />
      <div className="row__body">
        <span className="row__title" dir="auto">
          {item.title || 'Untitled'}
        </span>
        {(showList && list) || req || vis || due || item.repeat || steps.total ? (
          <span className="row__meta">
            {showList && list ? (
              <button
                type="button"
                className="meta meta--link"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate({ name: 'list', id: list.id });
                }}
              >
                <ListBullet list={list} size="xs" />
                <span dir="auto">{list.name}</span>
              </button>
            ) : null}
            {req ? <ReqTag state={req} /> : null}
            {vis ? <VisTag item={item} /> : null}
            {due ? <span className={`meta ${due.soft ? 'meta--soft' : ''}`}>{due.text}</span> : null}
            {item.repeat ? (
              <span className="meta" title={describeRule(item.repeat, (n) => weekdayName(n))}>
                <Icon name="repeat" />
              </span>
            ) : null}
            {steps.total ? (
              <span className="meta">
                <StepRing done={steps.done} total={steps.total} />
                {steps.done}/{steps.total}
              </span>
            ) : null}
          </span>
        ) : null}
        {below}
      </div>
      {trailing || item.urgent || avatar ? (
        <span className="row__trail">
          {trailing}
          {item.urgent ? <UrgentTag /> : null}
          {avatar ? <Avatar member={avatar} size="xs" /> : null}
        </span>
      ) : null}
    </li>
  );
});

/** "since Tue" → quick catch-up actions, for the From earlier group. */
export function catchUpDays(due: string, ref: string): number {
  return diffDays(due, ref);
}

import { memo, type CSSProperties, type ReactNode, type Ref } from 'react';
import { diffDays, humanDate, humanTime, sinceDate, weekdayName } from '../../core/dates';
import type { Item } from '../../core/model';
import { describeRule } from '../../smart/recurrence';
import { useHub } from '../context';
import { use24h, usePrefs } from '../prefs';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { ticksAway, useTick } from '../tick';
import { doerOf, requestState, visTagFor } from '../privacy';
import { Avatar, Check, ListBullet, StepRing } from '../ui/primitives';
import { ReqTag, UrgentTag, VisTag } from '../ui/tags';
import { useFresh } from '../ui/fresh';
import { useSettleHold } from '../ui/useSettle';
import { TagPills } from './Tags';
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
  skipTag,
  inUrgent,
  flash,
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
  /** The tag its group already says (By tag): not again on the row. */
  skipTag?: string | null;
  /** Drawn in the Urgent card: no Urgent tag needed. */
  inUrgent?: boolean;
  /** Just added or marked urgent by my partner: it glows a moment. */
  flash?: boolean;
  /** 'time': under a day's own heading, only the time. */
  dateMode?: 'full' | 'time' | 'none';
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
  const due = dateMode === 'full' ? dueLabel(item, ref, use24h(prefs)) : dateMode === 'time' && item.dueTime ? { text: humanTime(item.dueTime, use24h(prefs)), soft: false } : null;
  const readonly = !hub.canEdit(item);
  const tick = useTick();
  const hold = useSettleHold();
  const fresh = useFresh(item.id);
  // The owner never shows as an avatar (the privacy tag says whose); my own avatar only where it tells something.
  const avatar = !trailing && doer && (list?.visibility === 'shared' || doer.id !== list?.owner) ? doer : undefined;

  const onToggle = () => {
    if (!canTick) {
      toast(`That one is ${hub.member(hub.ownerOf(item))?.name ?? 'theirs'}’s to tick off.`);
      return;
    }
    // Taking back a "did it" just un-ticks: no strike-and-fold.
    if (ticksAway(hub, item)) hold?.(item.id);
    tick(item);
  };

  const twin = hub.linked(item);
  const tags = hub.tagsOf(item).filter((t) => t !== skipTag);
  return (
    <li
      ref={liRef}
      style={liStyle}
      {...dragProps}
      data-settle={item.id}
      data-id={item.id}
      className={`row row--tap ${item.done ? 'is-done' : ''} ${item.submittedAt && !item.done ? 'is-pending' : ''} ${readonly ? 'row--readonly' : ''} ${fresh ? 'row--fresh row--flash' : flash ? 'row--flash' : ''} ${settling ? 'is-settling' : ''} ${liClass ?? ''}`}
      onClick={() => navigate({ name: 'item', id: item.id })}
    >
      <Check on={item.done || !!settling} color={list?.color} onToggle={onToggle} label={item.title} />
      <div className="row__body">
        <span className="row__title" dir="auto">
          {item.title || 'Untitled'}
          {item.qty ? <span className="qty num">{/^\d+$/.test(item.qty) ? `×${item.qty}` : item.qty}</span> : null}
        </span>
        {(showList && list) || req || vis || due || item.repeat || steps.total || twin || tags.length ? (
          <span className="row__meta">
            {twin ? <TwinTag twin={twin} /> : null}
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
            <TagPills ids={tags} />
          </span>
        ) : null}
        {below}
      </div>
      {trailing || (item.urgent && !inUrgent && !item.done) || avatar ? (
        <span className="row__trail">
          {trailing}
          {item.urgent && !inUrgent && !item.done ? <UrgentTag /> : null}
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

/** "Also on Home shopping": the same thing lives there too; tap to go to it. */
export function TwinTag({ twin, label }: { twin: Item; label?: string }) {
  const hub = useHub();
  const list = hub.list(twin.listId);
  if (!list) return null;
  return (
    <button
      type="button"
      className="meta meta--link meta--twin"
      onClick={(e) => {
        e.stopPropagation();
        navigate({ name: 'item', id: twin.parentId ?? twin.id });
      }}
    >
      <Icon name="link" className="icon--xs" />
      <span dir="auto">{label ?? list.name}</span>
    </button>
  );
}

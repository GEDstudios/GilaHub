import { memo, useCallback, type CSSProperties, type ReactNode, type Ref } from 'react';
import { diffDays, humanDate, humanTime, sinceDate, weekdayName } from '../../core/dates';
import type { Item } from '../../core/model';
import { describeRule } from '../../smart/recurrence';
import { useHub } from '../context';
import { getPrefs, setPrefs, use24h, usePrefs } from '../prefs';
import { haptic } from '../ui/haptics';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { ticksAway, useTick } from '../tick';
import { doerOf, requestState, visTagFor } from '../privacy';
import { Avatar, Check, ListBullet, StepRing } from '../ui/primitives';
import { ReqTag, UrgentTag, VisTag } from '../ui/tags';
import { useFresh } from '../ui/fresh';
import { useSettleHold } from '../ui/useSettle';
import { useSwipe } from '../ui/swipe';
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
  inTray,
  nested,
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
  /** In the Ongoing card: swipe it left to take it out (no "Ongoing" pill: it's where it says). */
  inTray?: boolean;
  /** A subtask unfolded under its task: no swipe, no unfolding of its own. */
  nested?: boolean;
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

  // Swipe right: it's ongoing (I'm doing it now). In the Ongoing card, swipe left: not now.
  const canGo = !nested && !item.parentId && !item.done && !settling && hub.canEdit(item);
  const intoOngoing = canGo && !item.ongoingAt ? () => {
    const undo = hub.setOngoing(item.id, true);
    toast(`${item.title} is ongoing`, { ms: 2200, action: { label: 'Undo', run: undo } });
  } : undefined;
  const outOfOngoing = inTray && !nested && item.ongoingAt && !item.done ? () => {
    const undo = hub.setOngoing(item.id, false);
    toast(`${item.title}: not now`, { ms: 2200, action: { label: 'Undo', run: undo } });
  } : undefined;
  const swipeRef = useSwipe<HTMLLIElement>({ right: intoOngoing, left: outOfOngoing });
  const setRefs = useCallback(
    (el: HTMLLIElement | null) => {
      swipeRef.current = el;
      if (typeof liRef === 'function') liRef(el);
      else if (liRef) (liRef as { current: HTMLLIElement | null }).current = el;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liRef],
  );

  // Its subtasks, unfolded right here (this device remembers which).
  const unfolded = !nested && steps.total > 0 && prefs.unfolded.includes(item.id);
  const fold = (e: React.MouseEvent) => {
    e.stopPropagation();
    haptic('select');
    const now = getPrefs().unfolded;
    setPrefs({ unfolded: now.includes(item.id) ? now.filter((x) => x !== item.id) : [...now, item.id].slice(-200) });
  };
  const kids = unfolded ? hub.childrenOf(item.id) : [];
  const photo = hub.photosOf(`item:${item.id}`)[0];
  const thumb = photo ? hub.shotOf('photo', photo.id) : null;
  const ongoing = !!item.ongoingAt && !item.done && !inTray;
  const onBy = ongoing && item.ongoingBy && item.ongoingBy !== hub.meId ? hub.member(item.ongoingBy) : undefined;

  return (
    <li
      ref={setRefs}
      style={liStyle}
      {...dragProps}
      data-settle={item.id}
      data-id={item.id}
      className={`row row--tap ${item.done ? 'is-done' : ''} ${item.submittedAt && !item.done ? 'is-pending' : ''} ${readonly ? 'row--readonly' : ''} ${fresh ? 'row--fresh row--flash' : flash ? 'row--flash' : ''} ${settling ? 'is-settling' : ''} ${unfolded ? 'row--unfolded' : ''} ${nested ? 'row--nested' : ''} ${liClass ?? ''}`}
      onClick={() => navigate({ name: 'item', id: item.id })}
    >
      {intoOngoing ? (
        <span className="row__swipe row__swipe--right" aria-hidden="true">
          <span className="row__swipeset">
            <span className="row__swipedisc">
              <svg viewBox="0 0 24 24">
                <path d="M8.5 5.6v12.8c0 .9 1 1.4 1.7.9l9.4-6.4a1.1 1.1 0 0 0 0-1.8l-9.4-6.4c-.7-.5-1.7 0-1.7.9Z" />
              </svg>
            </span>
            <span className="row__swipelabel">Ongoing</span>
          </span>
        </span>
      ) : null}
      {outOfOngoing ? (
        <span className="row__swipe row__swipe--left" aria-hidden="true">
          <span className="row__swipeset">
            <span className="row__swipedisc">
              <svg viewBox="0 0 24 24">
                <path d="M7 7l10 10M17 7L7 17" fill="none" strokeWidth="2.6" strokeLinecap="round" />
              </svg>
            </span>
            <span className="row__swipelabel">Not now</span>
          </span>
        </span>
      ) : null}
      <Check on={item.done || !!settling} color={list?.color} onToggle={onToggle} label={item.title} />
      <div className="row__body">
        <span className="row__title" dir="auto">
          {item.title || 'Untitled'}
          {item.qty ? <span className="qty num">{/^\d+$/.test(item.qty) ? `×${item.qty}` : item.qty}</span> : null}
        </span>
        {(showList && list) || req || vis || due || item.repeat || steps.total || twin || tags.length || ongoing ? (
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
            {ongoing ? (
              <span className="meta meta--ongoing">
                <Icon name="play" />
                {onBy ? `${onBy.name}’s on it` : 'Ongoing'}
              </span>
            ) : null}
            {steps.total ? (
              nested ? (
                <span className="meta">
                  <StepRing done={steps.done} total={steps.total} />
                  {steps.done}/{steps.total}
                </span>
              ) : (
                <button
                  type="button"
                  className={`meta meta--fold ${unfolded ? 'is-open' : ''}`}
                  aria-expanded={unfolded}
                  aria-label={`${unfolded ? 'Fold' : 'Unfold'} the subtasks of ${item.title}: ${steps.done} of ${steps.total} done`}
                  onClick={fold}
                >
                  <StepRing done={steps.done} total={steps.total} />
                  {steps.done}/{steps.total}
                  <Icon name="chevron-down" className="meta__chev" />
                </button>
              )
            ) : null}
            <TagPills ids={tags} />
          </span>
        ) : null}
        {below}
      </div>
      {trailing || (item.urgent && !inUrgent && !item.done) || avatar || thumb || intoOngoing ? (
        <span className="row__trail">
          {trailing}
          {item.urgent && !inUrgent && !item.done ? <UrgentTag /> : null}
          {avatar ? <Avatar member={avatar} size="xs" /> : null}
          {thumb ? <img className="row__thumb" src={thumb} alt="" /> : null}
          {intoOngoing ? (
            // With a mouse (no swipe): the same, from a button that shows on hover.
            <button
              type="button"
              className="row__ongo"
              aria-label={`Put ${item.title} in Ongoing`}
              title="Ongoing"
              onClick={(e) => {
                e.stopPropagation();
                intoOngoing();
              }}
            >
              <Icon name="play" />
            </button>
          ) : null}
        </span>
      ) : null}
      {unfolded && kids.length ? (
        <ul className="rows rows--sub" onClick={(e) => e.stopPropagation()}>
          {kids.map((k) => (
            <ItemRow key={k.id} item={k} nested dateMode={dateMode} />
          ))}
        </ul>
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

import { useDragOut } from '../ui/dragOut';
import { movedTo } from './TemplateAsk';
import { memo, useCallback, useRef, type CSSProperties, type ReactNode, type Ref } from 'react';
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
import { Avatar, Check, ListBullet } from '../ui/primitives';
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
  nested,
  listLink = true,
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
  /** Its folder's name goes to the folder (off where a tap anywhere should open the task: Today). */
  listLink?: boolean;
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

  const swipeRef = useSwipe<HTMLLIElement>({});
  // A subtask unfolded here can be dragged out from under its task: onto the page (its own task),
  // onto another group or a step of the path (its own task there), or onto another task (under that one).
  const overlays = useOverlays();
  const lit = useRef<HTMLElement | null>(null);
  const light = (el: HTMLElement | null) => {
    if (lit.current === el) return;
    lit.current?.classList.remove('is-droptarget');
    el?.classList.add('is-droptarget');
    if (el) haptic('select');
    lit.current = el;
  };
  const outTarget = (p: { x: number; y: number }): { el: HTMLElement | null; listId: string; parentId: string | null } | null => {
    const els = document.elementsFromPoint(p.x, p.y);
    for (const e of els) {
      const crumb = e.closest<HTMLElement>('.crumbs [data-drop-list]');
      if (crumb) return { el: crumb, listId: crumb.dataset.dropList!, parentId: null };
      const row = e.closest<HTMLElement>('li.row:not(.row--nested)[data-id]');
      if (row) {
        // Still over its own task: nothing changes.
        if (row.dataset.id === item.parentId) return null;
        const under = hub.item(row.dataset.id);
        return under && !under.parentId ? { el: row, listId: under.listId, parentId: under.id } : null;
      }
      const group = e.closest<HTMLElement>('.aisle[data-list]');
      if (group) return { el: group, listId: group.dataset.list!, parentId: null };
    }
    return { el: null, listId: item.listId, parentId: null };
  };
  const outRef = useDragOut<HTMLLIElement>({
    label: item.title,
    enabled: !!nested && !!item.parentId && !readonly && !item.done,
    aim: (p) => light(p ? (outTarget(p)?.el ?? null) : null),
    drop: (p) => {
      light(null);
      const t = outTarget(p);
      if (!t) return;
      const was = { listId: item.listId, parentId: item.parentId ?? null };
      hub.move(item.id, { listId: t.listId, parentId: t.parentId });
      haptic('success');
      const where = t.parentId ? `under “${hub.item(t.parentId)?.title ?? 'it'}”` : `its own task${t.listId !== was.listId ? ` in ${hub.list(t.listId)?.name ?? 'there'}` : ''}`;
      movedTo(hub, overlays, item.id, was.listId, t.parentId ? was.listId : t.listId, `${item.title}: ${where}`, () => hub.move(item.id, was));
    },
  });
  const setRefs = useCallback(
    (el: HTMLLIElement | null) => {
      swipeRef.current = el;
      outRef.current = el;
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
      {item.stock != null ? <StockCount item={item} readonly={readonly} /> : <Check on={item.done || !!settling} color={list?.color} onToggle={onToggle} label={item.title} />}
      <div className="row__body">
        <span className="row__title" dir="auto">
          {item.title || 'Untitled'}
          {item.qty ? <span className="qty num">{/^\d+$/.test(item.qty) ? `×${item.qty}` : item.qty}</span> : null}
        </span>
        {(showList && list) || item.stock != null || req || vis || due || item.repeat || steps.total || twin || tags.length ? (
          <span className="row__meta">
            {twin ? <TwinTag twin={twin} /> : null}
            {showList && list && !listLink ? (
              <span className="meta">
                <ListBullet list={list} size="xs" />
                <span dir="auto">{list.name}</span>
              </span>
            ) : showList && list ? (
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
            {item.stock != null ? (
              <span className={`meta meta--stock ${item.stockUrgentAt != null && item.stock <= item.stockUrgentAt ? 'is-out' : hub.stockLow(item) ? 'is-low' : ''}`}>
                <Icon name="package" />
                {item.stock === 0 ? 'None left' : 'In stock'}
                {item.stockLink && hub.item(item.stockLink) && !hub.item(item.stockLink)!.done ? ` · on ${hub.list(hub.item(item.stockLink)!.listId)?.name ?? 'the list'}` : ''}
              </span>
            ) : null}
            {vis ? <VisTag item={item} /> : null}
            {due ? <span className={`meta ${due.soft ? 'meta--soft' : ''}`}>{due.text}</span> : null}
            {item.repeat ? (
              <span className="meta" title={describeRule(item.repeat, (n) => weekdayName(n))}>
                <Icon name="repeat" />
              </span>
            ) : null}
            {steps.total ? (
              nested ? (
                <span className="meta">
                  <Icon name="subtask" />
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
                  <Icon name="subtask" />
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
      {trailing || (item.urgent && !inUrgent && !item.done) || avatar || thumb ? (
        <span className="row__trail">
          {trailing}
          {item.urgent && !inUrgent && !item.done ? <UrgentTag /> : null}
          {avatar ? <Avatar member={avatar} size="xs" /> : null}
          {thumb ? <img className="row__thumb" src={thumb} alt="" /> : null}
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

/**
 * Where a task's tick would be, something we count shows how many are in: tap it when one is
 * used (it goes on the list by itself when it runs low). Never "done", so never cleared away.
 */
export function StockCount({ item, readonly }: { item: Item; readonly?: boolean }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const n = item.stock ?? 0;
  const out = item.stockUrgentAt != null && n <= item.stockUrgentAt;
  const low = hub.stockLow(item);
  return (
    <button
      type="button"
      className={`stockcount num ${out ? 'is-out' : low ? 'is-low' : ''}`}
      aria-label={`${item.title}: ${n} in stock. Used one`}
      title="Used one"
      disabled={readonly || n === 0}
      onClick={(e) => {
        e.stopPropagation();
        haptic('select');
        const before = item.stockLink ?? null;
        const undo = hub.useOne(item.id);
        const now = hub.item(item.id);
        const added = now?.stockLink && now.stockLink !== before;
        toast(added ? `${item.title}: ${now?.stock} left, on ${hub.list(hub.item(now!.stockLink)?.listId)?.name ?? 'the list'}` : `${item.title}: ${now?.stock ?? 0} left`, { ms: 2400, action: { label: 'Undo', run: undo } });
      }}
    >
      {n}
    </button>
  );
}

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

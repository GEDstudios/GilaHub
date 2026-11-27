import { useDragOut, type ChipKind } from '../ui/dragOut';
import { dropMarks, openGap } from '../ui/dropMark';
import { dweller, placer, unfoldTo, type Placement } from '../outline';
import { movedTo } from './TemplateAsk';
import { memo, useCallback, useMemo, useRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import { humanTime, sinceDate, weekdayName } from '../../core/dates';
import type { Item } from '../../core/model';
import { describeRule } from '../../smart/recurrence';
import { useHub } from '../context';
import { getPrefs, setPrefs, use24h, usePrefs } from '../prefs';
import { haptic } from '../ui/haptics';
import { navigate } from '../router';
import { StockCount } from './StockCount';
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
import { whenText } from '../labels';
import { G } from '../ui/glyphs';

function dueLabel(item: Item, ref: string, h24: boolean): { text: string; soft: boolean } | null {
  if (!item.due) return null;
  const time = item.dueTime ? humanTime(item.dueTime, h24) : '';
  if (item.due < ref) return { text: sinceDate(item.due, ref), soft: true };
  if (item.due === ref) return time ? { text: time, soft: false } : null;
  return { text: whenText(item.due, item.dueTime, ref, h24), soft: false };
}

/** Who does it, for a row's avatar (see doerOf): never the owner, never someone asked. */
function useDoer(item: Item) {
  return doerOf(useHub(), item);
}

export const ItemRow = memo(function ItemRow({
  item,
  showList,
  skipTag,
  inUrgent,
  flash,
  dateMode = 'full',
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
  /** Under the text, e.g. OK / Not yet (RequestActions className="row__acts"). */
  below?: ReactNode;
  /** Just ticked: drawn checked while it strikes through and folds away (useSettle). */
  settling?: boolean;
  liRef?: Ref<HTMLLIElement>;
  liStyle?: CSSProperties;
  liClass?: string;
  dragProps?: Record<string, unknown>;
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
  const canTick = hub.canEdit(item);
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
  const avatar = doer && (list?.visibility === 'shared' || doer.id !== list?.owner) ? doer : undefined;

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
  // A subtask unfolded here can be dragged anywhere in the list, outliner style (outline.ts says
  // where it lands; the rows part and a gap opens there, and the copy in the hand settles into it).
  // Onto a group or a step of the path, it's its own task there. Escape puts it back.
  const overlays = useOverlays();
  const mark = useMemo(dropMarks, []);
  const dwell = useMemo(() => dweller(), []);
  const place = useMemo(() => placer(hub, { among: true }), [hub]);
  type Target = { into?: HTMLElement; chip?: ChipKind; listId: string; parentId: string | null; before?: string | null; placed?: Placement };
  // Where it lands now (the drop goes there: under the hand there may be only the gap).
  const aimed = useRef<Target | null>(null);
  const outTarget = (p: { x: number; y: number }, from: { x: number; y: number }): Target | 'keep' | null => {
    for (const e of document.elementsFromPoint(p.x, p.y)) {
      if (e.closest('.dragout')) continue;
      const crumb = e.closest<HTMLElement>('.crumbs [data-drop-list]');
      if (crumb) return { into: crumb, chip: 'move', listId: crumb.dataset.dropList!, parentId: null };
      if (e.closest('li.row[data-id], .dropgap')) break;
      const group = e.closest<HTMLElement>('.aisle[data-list]');
      if (group) return { into: group, chip: 'move', listId: group.dataset.list!, parentId: null };
    }
    const pl = place(item, p, from.x);
    if (pl === 'keep' || !pl) return pl;
    return { into: pl.into, listId: pl.listId, parentId: pl.parentId, before: pl.before, placed: pl };
  };
  const outRef = useDragOut<HTMLLIElement>({
    label: item.title,
    enabled: !!nested && !!item.parentId && !readonly && !item.done,
    aim: (p, from) => {
      const t = p ? outTarget(p, from) : null;
      if (t !== 'keep') {
        aimed.current = t;
        mark(t ? { into: t.into, gap: t.placed?.gap } : null);
        dwell.at(t?.placed?.unfold);
      }
      if (!p) dwell.stop();
      const now = aimed.current;
      return now?.chip ?? (now?.placed ? openGap()?.getBoundingClientRect() : null);
    },
    drop: () => {
      const t = aimed.current;
      mark(null);
      dwell.stop();
      aimed.current = null;
      if (!t) return;
      const was = { listId: item.listId, parentId: item.parentId ?? null };
      // Among its sisters: just its place changes.
      if (t.parentId === was.parentId && t.listId === was.listId && t.before !== undefined) {
        hub.move(item.id, { before: t.before });
        haptic('drop');
        return;
      }
      hub.move(item.id, { listId: t.listId, parentId: t.parentId, before: t.before ?? undefined });
      unfoldTo(t.parentId);
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
        </span>
        {(showList && list) || req || vis || due || item.repeat || steps.total || twin || tags.length ? (
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
            {vis ? <VisTag item={item} /> : null}
            {due ? <span className={`meta ${due.soft ? 'meta--soft' : ''}`}>{due.text}</span> : null}
            {item.repeat ? (
              <span className="meta" title={describeRule(item.repeat, (n) => weekdayName(n))}>
                <Icon name={G.repeat} />
              </span>
            ) : null}
            {steps.total ? (
              nested ? (
                <span className="meta">
                  <Icon name={G.subtask} />
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
                  <Icon name={G.subtask} />
                  {steps.done}/{steps.total}
                  <Icon name={G.fold} className="meta__chev" />
                </button>
              )
            ) : null}
            <TagPills ids={tags} />
          </span>
        ) : null}
        {below}
      </div>
      {(item.urgent && !inUrgent && !item.done) || avatar || thumb ? (
        <span className="row__trail">
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

/** "Also on Home shopping": the same thing lives there too; tap to go to it. */
function TwinTag({ twin }: { twin: Item }) {
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
      <Icon name={G.linked} className="icon--xs" />
      <span dir="auto">{list.name}</span>
    </button>
  );
}

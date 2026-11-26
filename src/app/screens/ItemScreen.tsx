import { PathCrumbs } from '../components/PathCrumbs';
import { addPhotoTo, Photos } from '../components/Photos';
import { haptic } from '../ui/haptics';
import { useBackGuard } from '../ui/backGuard';
import { PlacePicker } from '../components/PlacePicker';
import { StockCount } from '../components/ItemRow';
import { useAlsoShop } from '../alsoShop';
import { tourOpened } from '../tour';
import { useEffect, useRef, useState } from 'react';
import { addDays, humanDate, relativeAgo, today as todayStr } from '../../core/dates';
import { isFlexible } from '../../smart/recurrence';
import { Children } from '../components/Children';
import { InlineEditor, Panel, useSummary } from '../components/editors';
import { notifyAbout, setUpReminders } from '../notify';
import { freshAgain, useLater, useTick } from '../tick';
import { OptRow } from '../components/pickers';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { useAddAction } from '../addAction';
import { TagMark, TagPicker, tagsLabel } from '../components/Tags';
import { useHub, useRt } from '../context';
import { back, navigate } from '../router';
import { isQuick, setQuick } from '../quick';
import { movedTo } from '../components/TemplateAsk';
import { usePrefs } from '../prefs';
import { allowedVis, itemVisChoice, setItemVis } from '../privacy';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Avatar, Band, Check, Empty, IconButton, lineVars, ListBullet, NewButton, Section } from '../ui/primitives';
import { RequestActions } from '../ui/tags';
import { AutoTitle } from '../ui/AutoTitle';
import type { Draft } from '../draft';

function ItemMenu({ id, onClose, onGone }: { id: string; onClose: () => void; onGone: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const item = hub.item(id);
  if (!item) return null;
  return (
    <Sheet onClose={onClose} title="More">
      <div className="group">
        {item.parentId ? (
          <OptRow
            icon="arrow-back"
            title="Make it its own task"
            sub={`Out from under “${hub.item(item.parentId)?.title ?? 'its task'}”, in ${hub.list(item.listId)?.name ?? 'its folder'}`}
            onClick={() => {
              const was = { listId: item.listId, parentId: item.parentId ?? null };
              hub.move(id, { listId: item.listId, parentId: null });
              onClose();
              toast(`“${item.title}” is its own task`, { action: { label: 'Undo', run: () => hub.move(id, was) } });
            }}
          />
        ) : null}
        <OptRow
          icon="copy"
          title="Duplicate"
          onClick={() => {
            const nid = hub.duplicate(id);
            onClose();
            if (nid) navigate({ name: 'item', id: nid }, { replace: true });
            toast('Duplicated');
          }}
        />
        <OptRow
          icon="trash"
          title="Delete"
          danger
          onClick={() => {
            const undo = hub.delete(id);
            onClose();
            onGone();
            toast(`Deleted “${item.title}”`, {
              action: { label: 'Undo', run: undo },
            });
          }}
        />
      </div>
    </Sheet>
  );
}

/**
 * Where it lives, open from its path: the projects (and their tasks and subtasks, opened down
 * to where it is now). Tap a new place, then say yes to "Move to …?". Undo is on the toast.
 */
function MoveSheet({ id, from, onClose }: { id: string; from: string | null; onClose: () => void }) {
  const hub = useHub();
  const overlays = useOverlays();
  const item = hub.item(id);
  const [to, setTo] = useState<{ listId: string; parentId: string | null } | null>(null);
  if (!item) return null;
  // Opened from the start: the folders down to where it is, then its tasks.
  const path = [...hub.listPath(item.listId).map((l) => l.id), item.listId, ...hub.ancestors(item).map((a) => a.id)];
  const fromName = from ? (hub.list(from)?.name ?? hub.item(from)?.title) : null;
  const name = (p: { listId: string; parentId: string | null }) => {
    const l = hub.list(p.listId)?.name ?? '';
    const parent = p.parentId ? hub.item(p.parentId)?.title : null;
    return parent ? `“${parent}” in ${l}` : l;
  };
  const go = () => {
    if (!to) return;
    const was = { listId: item.listId, parentId: item.parentId ?? null };
    hub.move(id, to);
    onClose();
    movedTo(hub, overlays, id, was.listId, to.parentId ? was.listId : to.listId, `Moved to ${name(to)}`, () => hub.move(id, was));
  };
  return (
    <Sheet onClose={onClose} title="Where it lives">
      {from && fromName ? (
        <p className="editlink move__open">
          <button
            type="button"
            className="textbtn"
            onClick={() => {
              onClose();
              navigate(hub.list(from) ? { name: 'list', id: from } : { name: 'item', id: from });
            }}
          >
            Open {fromName}
            <Icon name="arrow" className="icon--xs" />
          </button>
        </p>
      ) : null}
      <PlacePicker
        itemId={id}
        here
        initialOpen={path}
        filter={(l) => !l.owner || l.owner === hub.meId || l.visibility === 'visible'}
        onPick={(listId, parentId) => setTo({ listId, parentId })}
      />
      {to ? (
        <div className="moveask" role="alertdialog" aria-label={`Move to ${name(to)}?`}>
          <p dir="auto">
            Move to <strong>{name(to)}</strong>?
          </p>
          <div className="moveask__btns">
            <button type="button" className="btn btn--quiet" onClick={() => setTo(null)}>
              Cancel
            </button>
            <button type="button" className="btn" onClick={go}>
              Move
            </button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

/** One column of the stock panel: a word over − n +. */
function StockCol({ label, value, min = 0, max, onChange, tone }: { label: string; value: number; min?: number; max?: number; onChange: (n: number) => void; tone?: string }) {
  return (
    <div className={`stockcol ${tone ?? ''}`}>
      <span className="stockcol__label">{label}</span>
      <span className="stockcol__step">
        <button type="button" aria-label={`${label}: one less`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span className="stockcol__n num">{value}</span>
        <button type="button" aria-label={`${label}: one more`} disabled={max != null && value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </span>
    </div>
  );
}

/**
 * Stock on a task: Have · Want · Buy at, each − n +; under them a thin bar (have of want, a notch
 * where it gets bought). One quiet line under that: where it goes, when it's urgent, stop.
 * Opening it starts counting.
 */
function StockPanel({ id }: { id: string }) {
  const hub = useHub();
  const { toast, openSheet } = useOverlays();
  const item = hub.item(id);
  const on = item?.stock != null;
  const set = (patch: Parameters<typeof hub.setStock>[1]) => {
    const before = hub.item(id)?.stockLink ?? null;
    hub.setStock(id, patch);
    const now = hub.item(id);
    if (now?.stockLink && now.stockLink !== before) {
      const at = hub.stockPlace(now);
      toast(`On ${at.parentId ? `“${hub.item(at.parentId)?.title ?? ''}”` : (hub.list(at.listId)?.name ?? 'the list')}`);
    }
  };
  // Opening it is starting it.
  useEffect(() => {
    if (item && item.stock == null) hub.setStock(id, { stock: 2, stockFull: 4, stockAddAt: 1, stockUrgentAt: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!item || !on) return null;
  const have = item.stock ?? 0;
  const want = item.stockFull ?? Math.max(have, (item.stockAddAt ?? 1) + 1);
  const at = item.stockAddAt ?? 1;
  const urgentAt = item.stockUrgentAt ?? null;
  const low = have <= at;
  const out = urgentAt != null && have <= urgentAt;
  const place = hub.stockPlace(item);
  const placeName = place.parentId ? (hub.item(place.parentId)?.title ?? '') : (hub.list(place.listId)?.name ?? '');
  const pickPlace = () =>
    openSheet((close) => (
      <Sheet onClose={close} title="Goes on">
        <PlacePicker
          itemId={id}
          initialOpen={[...hub.listPath(place.listId).map((l) => l.id), place.listId]}
          filter={(l) => !l.owner || l.owner === hub.meId || l.visibility === 'visible'}
          onPick={(listId, parentId) => {
            set({ stockTo: listId, stockUnder: parentId });
            close();
          }}
        />
      </Sheet>
    ));
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / Math.max(1, want)) * 100))}%`;
  return (
    <Panel>
      <div className="stockcols">
        <StockCol label="Have" value={have} onChange={(n) => set({ stock: n })} tone={out ? 'is-out' : low ? 'is-low' : ''} />
        <StockCol label="Want" value={want} min={Math.max(1, at + 1)} onChange={(n) => set({ stockFull: n })} />
        <StockCol label="Buy at" value={at} max={want - 1} onChange={(n) => set({ stockAddAt: Math.min(n, want - 1) })} />
      </div>
      <div className={`stockbar ${out ? 'is-out' : low ? 'is-low' : ''}`} role="img" aria-label={`${have} of ${want}; bought at ${at}`}>
        <span className="stockbar__fill" style={{ width: pct(have) }} />
        <span className="stockbar__notch" style={{ left: pct(at) }} />
      </div>
      <div className="stockfoot">
        <button type="button" className="stockfoot__chip" onClick={pickPlace} title="Where it goes when it's low">
          <Icon name="cart" className="icon--xs" />
          <span dir="auto">{placeName}</span>
        </button>
        <span className={`stockfoot__chip stockfoot__urgent ${urgentAt == null ? 'is-off' : ''}`} title="Urgent at">
          <Icon name="urgent" className="icon--xs" />
          <button type="button" aria-label="Urgent at: one less" disabled={urgentAt == null} onClick={() => set({ stockUrgentAt: urgentAt == null || urgentAt <= 0 ? null : urgentAt - 1 })}>
            −
          </button>
          <span className="num">{urgentAt == null ? 'off' : urgentAt}</span>
          <button type="button" aria-label="Urgent at: one more" disabled={urgentAt != null && urgentAt >= at} onClick={() => set({ stockUrgentAt: urgentAt == null ? 0 : urgentAt + 1 })}>
            +
          </button>
        </span>
        <button type="button" className="stockfoot__stop" onClick={() => set({ stock: null })} aria-label="Stop counting" title="Stop counting">
          <Icon name="x" className="icon--xs" />
        </button>
      </div>
    </Panel>
  );
}

/** More ways to finish a repeating thing: earlier, skip it, or pause it. */
function DonePanel({ id, close }: { id: string; close: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const later = useLater();
  const item = hub.item(id);
  const ref = todayStr();
  if (!item?.repeat) return null;
  /** Today says what every tick says; an earlier day says which day it counted for. */
  const done = (day: string, label: string | null) => {
    const undo = hub.completeRepeating(id, day);
    toast(label ?? freshAgain(hub, id), {
      action: { label: 'Undo', run: undo },
    });
    close();
  };
  return (
    <div className="options">
      <button type="button" className="option" onClick={() => done(ref, null)}>
        Today
      </button>
      <button type="button" className="option" onClick={() => done(addDays(ref, -1), 'Counted for yesterday')}>
        Yesterday
      </button>
      <label className="option option--input">
        <Icon name="calendar" className="icon--sm" />
        <input
          type="date"
          max={ref}
          aria-label="Done on a day"
          onChange={(e) => e.target.value && done(e.target.value, `Counted for ${humanDate(e.target.value, ref)}`)}
        />
      </label>
      <button
        type="button"
        className="option"
        onClick={() => {
          later.run(item);
          close();
        }}
      >
        {isFlexible(item.repeat) ? 'Not today' : 'Skip this one'}
      </button>
      <button
        type="button"
        className="option"
        onClick={() => {
          hub.setPaused(id, !item.paused);
          close();
        }}
      >
        {item.paused ? 'Resume' : 'Pause'}
      </button>
    </div>
  );
}

export function ItemScreen({ id }: { id: string }) {
  const hub = useHub();
  const rt = useRt();
  const tick = useTick();
  const { openSheet, toast } = useOverlays();
  const summarize = useSummary();
  const item = hub.item(id);
  const inQuick = isQuick(id, usePrefs().quick);
  const [notes, setNotes] = useState(item?.notes ?? '');
  useEffect(() => setNotes(item?.notes ?? ''), [item?.notes]);
  // The + adds a step of this item (a chip in the sheet makes it its own task instead).
  const openNew = () => openSheet((close) => <QuickAddSheet onClose={close} listId={item?.listId} parentId={item?.id} />);
  useAddAction(openNew, 'Add a subtask');
  // From a notification's buttons: ?do=done ticks it, ?do=later moves it to tomorrow.
  useEffect(() => {
    const act = new URLSearchParams(location.search).get('do');
    const it = hub.item(id);
    if (!act || !it) return;
    try {
      history.replaceState(null, '', location.pathname);
    } catch {
      /* sandboxed */
    }
    if (act === 'done' && !it.done) {
      if (hub.canEdit(it)) tick(it);
    } else if (act === 'later') {
      hub.snooze(id, addDays(todayStr(), 1));
      toast(`${it.title}: tomorrow`);
    }
  }, [hub, id]);

  // What it was when I opened it: Back asks before leaving with changes (keep them, or put it back).
  const tracked = ['title', 'notes', 'due', 'dueTime', 'repeat', 'remind', 'nag', 'assignee', 'urgent', 'private', 'owner', 'tags', 'qty', 'needsOk'] as const;
  const snapOf = (it: typeof item) => (it ? Object.fromEntries(tracked.map((k) => [k, it[k] ?? null])) : null);
  const [snap] = useState(() => snapOf(item));
  // The name being typed counts too (it's only saved once the field lets go).
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const changed = !!item && !!snap && (JSON.stringify(snapOf(item)) !== JSON.stringify(snap) || notes !== (item.notes ?? '') || titleDraft !== null);
  const upToRef = useRef<() => void>(() => back({ name: 'today' }));
  useBackGuard({
    dirty: changed,
    title: 'Keep your changes?',
    text: 'You changed this task. Keep it as it is now, or put it back the way it was.',
    saveLabel: 'Keep changes',
    discardLabel: 'Put it back',
    onSave: () => {
      const it = hub.item(id);
      if (it && notes !== (it.notes ?? '')) hub.updateItem(id, { notes });
      if (it && titleDraft?.trim()) hub.updateItem(id, { title: titleDraft.trim() });
      setTitleDraft(null);
      upToRef.current();
    },
    onDiscard: () => {
      const it = hub.item(id);
      if (it && snap) {
        const privacy = it.private !== snap.private || it.owner !== snap.owner;
        hub.updateItem(id, snap as Parameters<typeof hub.updateItem>[1]);
        if (privacy) hub.rescope(id);
        setNotes((snap.notes as string | null) ?? '');
      }
      setTitleDraft(null);
      upToRef.current();
    },
  });

  // Start here: "Tap me to open me" is done by opening it (ticked as you leave, after reading).
  useEffect(
    () => () => {
      const it = hub.item(id);
      if (it) tourOpened(hub, it);
    },
    [hub, id],
  );

  if (!item) {
    return (
      <>
        <Band title="Not here" onBack={() => back({ name: 'today' })} />
        <Empty title="This item is gone" text="It may have been deleted, or made private by its owner." />
      </>
    );
  }

  const list = hub.list(item.listId);
  const ancestors = hub.ancestors(item);
  const movePath = (from: string | null) => openSheet((close) => <MoveSheet id={id} from={from} onClose={close} />);
  const editable = hub.canEdit(item);
  const vis = hub.visibilityOf(item);
  const partner = hub.partner();
  const partnerName = partner?.name ?? 'your partner';
  const logs = hub
    .logsFor(id)
    .filter((l) => l.kind === 'done')
    .slice(0, 5);
  // My partner's thing can be theirs, ours or mine again, but hiding it from them isn't mine to do.
  // Every choice, whatever it is now: a task set to Hila's can be made Private (mine) straight away.
  const allowed = allowedVis(hub, list, ancestors.at(-1));
  const visChoice = itemVisChoice(hub, item);
  const asker = item.requestedBy ? hub.member(item.requestedBy) : undefined;
  const iAsked = item.requestedBy === hub.meId;
  const upTo = ancestors.length
    ? { name: 'item' as const, id: ancestors[ancestors.length - 1].id }
    : list
      ? { name: 'list' as const, id: list.id }
      : { name: 'today' as const };
  upToRef.current = () => back(upTo);
  const steps = hub.childrenOf(id);

  // One thing, two places: "Also in Home shopping" (tap to go there, or stop), or "Also in…".
  const twin = hub.linked(item);
  const twinList = twin ? hub.list(twin.listId) : undefined;
  const alsoChip = {
    key: 'also',
    label: twin && twinList ? `Also in ${(twin.parentId && hub.item(twin.parentId)?.title) || twinList.name}` : 'Also in…',
    icon: 'link' as const,
    set: !!twinList,
    panel: (close: () => void) =>
      twin && twinList ? (
        <div className="tokens">
          <button
            type="button"
            className="token"
            onClick={() => navigate({ name: 'item', id: twin.parentId ?? twin.id })}
          >
            <ListBullet list={twinList} size="xs" />
            <span dir="auto">Go to {twinList.name}</span>
          </button>
          <button
            type="button"
            className="token"
            onClick={() => {
              const where = (twin.parentId && hub.item(twin.parentId)?.title) || twinList.name;
              const undo = hub.removeTwin(id);
              close();
              toast(`Taken out of ${where}`, { action: { label: 'Undo', run: undo } });
            }}
          >
            <Icon name="x" className="token__x" />
            <span dir="auto">Remove from {(twin.parentId && hub.item(twin.parentId)?.title) || twinList.name}</span>
          </button>
          <button
            type="button"
            className="token"
            onClick={() => {
              // Out of here: this copy goes, the one in the other place stays (and opens).
              const here = (item.parentId && hub.item(item.parentId)?.title) || list?.name || 'here';
              const undo = hub.removeTwin(twin.id);
              close();
              navigate({ name: 'item', id: twin.id }, { replace: true });
              toast(`Taken out of ${here}`, { action: { label: 'Undo', run: undo } });
            }}
          >
            <Icon name="x" className="token__x" />
            <span dir="auto">Remove from {(item.parentId && hub.item(item.parentId)?.title) || list?.name || 'here'}</span>
          </button>
        </div>
      ) : (
        <PlacePicker
          itemId={id}
          onPick={(lid, parentId) => {
            const other = hub.alsoIn(id, lid, parentId);
            const it = other ? hub.item(other) : undefined;
            const where = parentId ? hub.item(parentId)?.title : hub.list(lid)?.name;
            if (it) toast(`${it.title} is in ${where ?? 'there'} too`);
            close();
          }}
        />
      ),
  };

  // Its photos (a chip adds one; they show above the notes).
  const photoN = hub.photosOf(`item:${id}`).length;
  const addPhoto = () => addPhotoTo(hub, toast, `item:${id}`);

  // Its tags (what the words suggest is offered first), and on a shopping list how many.
  const tags = hub.tagsOf(item);
  const tl = tagsLabel(hub, tags);
  const suggest = hub.suggestTags(item.title, item.listId);
  const tagsChip = {
    key: 'tags',
    label: tl.label,
    icon: tl.lead ? undefined : ('tag' as const),
    lead: tl.lead ? <TagMark icon={tl.lead} /> : undefined,
    set: tags.length > 0,
    panel: () => <TagPicker value={tags} onChange={(next) => hub.setTags(id, next)} suggested={[...suggest.auto, ...suggest.more]} />,
  };

  const onToggle = () => {
    if (hub.canEdit(item)) tick(item);
  };

  const draft: Draft = {
    due: item.due ?? null,
    dueTime: item.dueTime ?? null,
    repeat: item.repeat ?? null,
    remind: item.remind ?? null,
    nag: item.nag ?? null,
    assignee: item.assignee ?? null,
    urgent: !!item.urgent,
    visibility: visChoice,
    needsOk: !!item.needsOk,
  };

  const change = (p: Partial<Draft>) => {
    if ('visibility' in p && p.visibility && p.visibility !== visChoice) {
      if (p.visibility === 'private' && partner) toast(`This will disappear for ${partnerName}`);
      setItemVis(hub, id, p.visibility);
      return;
    }
    if ('assignee' in p) {
      hub.assign(id, p.assignee ?? null);
      const now = hub.item(id);
      if (now && hub.isRequest(p.assignee) && now.requestedBy === hub.meId && item.assignee !== p.assignee) {
        notifyAbout(rt, hub, now, p.assignee as string, `🙋 ${hub.me()?.name ?? 'Your partner'} asked you`, now.title);
      }
      return;
    }
    if ('needsOk' in p) {
      hub.updateItem(id, { needsOk: !!p.needsOk });
      return;
    }
    if ('remind' in p && p.remind !== null && p.remind !== undefined) setUpReminders(rt, toast);
    const { visibility: _v, ...rest } = p;
    void _v;
    hub.updateItem(id, rest);
  };

  return (
    <>
      <Band
        onBack={() => {
          // The app's own back arrow keeps what was changed (the notes and a name being typed too) and leaves.
          const it = hub.item(id);
          if (it && notes !== (it.notes ?? '')) hub.updateItem(id, { notes });
          if (it && titleDraft?.trim()) hub.updateItem(id, { title: titleDraft.trim() });
          back(upTo);
        }}
        mini={item.title}
        actions={
          editable ? (
            <>
              {/* Highlights: a star by the "…" */}
              <button
                type="button"
                className={`iconbtn starbtn ${inQuick ? 'is-on' : ''}`}
                aria-pressed={inQuick}
                aria-label={inQuick ? 'In your Highlights' : 'Add to your Highlights'}
                title={inQuick ? 'In your Highlights' : 'Add to your Highlights'}
                onClick={() => {
                  haptic('select');
                  const undo = setQuick(id, !inQuick);
                  toast(inQuick ? 'Out of your Highlights' : 'In your Highlights, on Today', { action: { label: 'Undo', run: undo } });
                }}
              >
                <Icon name="star" lit={inQuick} />
              </button>
              <IconButton icon="more" label="More" onClick={() => openSheet((close) => <ItemMenu id={id} onClose={close} onGone={() => back(upTo)} />)} />
              <NewButton label="Add a subtask" onClick={openNew} />
            </>
          ) : undefined
        }
        crumbs={
          // Where it lives, from the top: every step goes there; the move button at the end moves it.
          <PathCrumbs
            onMove={editable ? () => movePath(null) : undefined}
            moveLabel="Move this task"
            also={
              editable
                ? {
                    label: alsoChip.label,
                    on: !!alsoChip.set,
                    onClick: () =>
                      openSheet((close) => (
                        <Sheet onClose={close} title={alsoChip.set ? alsoChip.label : 'Also in…'}>
                          {alsoChip.panel(close)}
                        </Sheet>
                      )),
                  }
                : undefined
            }
            steps={[
              { key: 'projects', label: 'Folders', go: () => navigate({ name: 'lists' }) },
              ...[...(list ? hub.listPath(list.id) : []), ...(list ? [list] : [])].map((l) => ({
                key: l.id,
                label: l.name,
                go: () => navigate({ name: 'list', id: l.id }),
                // A subtask dragged up onto it: out on its own, there.
                drop: editable ? l.id : undefined,
              })),
              ...ancestors.map((a) => ({
                key: a.id,
                label: a.title,
                go: () => navigate({ name: 'item', id: a.id }),
                dropItem: editable ? a.id : undefined,
              })),
            ]}
          />
        }
      >
        <div className={`hero hero--item ${item.done ? 'is-done' : ''}`} style={lineVars(list?.color)}>
          <div className="hero__top">
            <AutoTitle value={item.title} onSave={(t) => hub.updateItem(id, { title: t })} readOnly={!editable} onDraft={setTitleDraft} />
            {item.stock != null ? <StockCount item={item} readonly={!editable} /> : <Check on={item.done} onToggle={onToggle} label={item.done ? 'Mark not done' : 'Mark done'} />}
          </div>
          <p className="hero__sub">
            {item.submittedAt && !item.done
              ? iAsked
                ? `${hub.member(item.submittedBy)?.name ?? 'They'} says it’s done. Waiting for your OK.`
                : `Done. Waiting for ${asker?.name ?? 'their'} OK.`
              : item.done
                ? `Done${item.doneAt ? ` ${relativeAgo(item.doneAt)}` : ''}${item.doneBy && item.doneBy !== hub.meId ? ` by ${hub.member(item.doneBy)?.name ?? ''}` : ''}.`
                : item.paused
                  ? 'Paused.'
                  : `${summarize(draft) === 'No date' ? '' : summarize(draft)}${asker && !iAsked ? (item.sentBackAt ? ` ${asker.name} said not yet.` : ` ${asker.name} asked.`) : ''}`}
            {item.repeat && item.lastDoneAt && !item.done
              ? ` Last done ${relativeAgo(item.lastDoneAt)}${item.lastDoneBy && item.lastDoneBy !== hub.meId ? ` by ${hub.member(item.lastDoneBy)?.name ?? ''}` : ''}.`
              : ''}
          </p>
          {editable ? (
            // A photo: at the card's foot, under the tick.
            <button type="button" className="herophoto" aria-label={photoN ? `Add a photo (${photoN})` : 'Add a photo'} title="Add a photo" onClick={() => void addPhoto()}>
              <Icon name="image" />
              {photoN ? <span className="herophoto__n num">{photoN}</span> : null}
            </button>
          ) : null}
        </div>
      </Band>

      <div className="column">
        {item.submittedAt && !item.done && iAsked ? <RequestActions item={item} className="reqacts--page" /> : null}

        {editable ? (
          <InlineEditor
            extras={[
              ...(item.repeat
                ? [
                    {
                      key: 'done',
                      label: 'Done…',
                      icon: 'check' as const,
                      panel: (close: () => void) => <DonePanel id={id} close={close} />,
                    },
                  ]
                : []),
              ...(!item.parentId
                ? [
                    {
                      key: 'stock',
                      label: item.stock != null ? `${item.stock} in stock` : 'Stock',
                      icon: 'package' as const,
                      set: item.stock != null,
                      panel: () => <StockPanel id={id} />,
                    },
                  ]
                : []),
              tagsChip,
            ]}
            more
            later={['who']}
            value={draft}
            onChange={change}
            // First: when, urgent, who sees it; Who and the rest under the arrow.
            fields={(['when', 'repeat', 'remind', 'urgent', 'who', 'vis'] as const).filter(
              (f) => (f !== 'vis' || hub.canSetPrivacy(item)) && (f !== 'who' || vis !== 'private'),
            )}
            allowedVis={allowed}
            turn={item.turn}
            repeatFrom={item.repeat?.type === 'interval' ? item.repeat.from : 'schedule'}
          />
        ) : null}

        {vis === 'ours' && !item.assignee && editable && partner && !item.done ? (
          <button type="button" className="textbtn takeit" onClick={() => hub.takeIt(id)}>
            <Icon name="hand" className="icon--sm" /> I’ll take it
          </button>
        ) : null}

        <Photos on={`item:${id}`} />

        <textarea
          className="notes"
          dir="auto"
          value={notes}
          readOnly={!editable}
          placeholder={editable ? 'Add a note…' : ''}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (item.notes ?? '') && hub.updateItem(id, { notes })}
          aria-label="Notes"
        />

        {steps.length || editable ? (
          <Section title="Subtasks" count={steps.length}>
            <Children listId={item.listId} parentId={id} readonly={!editable} />
            {editable ? <SubtaskAdd listId={item.listId} parentId={id} /> : null}
          </Section>
        ) : null}

        {logs.length ? (
          <Section title="History">
            <ul className="rows rows--plain">
              {logs.map((l) => {
                const by = hub.member(l.by);
                return (
                  <li key={l.id} className="row">
                    <Avatar member={by} size="xs" />
                    <div className="row__body">
                      <span className="row__title">
                        {by?.id === hub.meId ? 'You' : by?.name}{' '}
                        <span className="row__aside">
                          {new Date(l.at).toLocaleString(undefined, {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </span>
                    </div>
                    {l.by !== hub.meId ? (
                      <button
                        type="button"
                        className={`heart ${l.thankedBy ? 'is-on' : ''}`}
                        onClick={() => hub.thank(l.id)}
                        aria-label="Say thanks"
                        aria-pressed={!!l.thankedBy}
                      >
                        <Icon name={l.thankedBy ? 'heart-fill' : 'heart'} />
                      </button>
                    ) : l.thankedBy ? (
                      <span className="heart is-on" title="Thanked">
                        <Icon name="heart-fill" />
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}
      </div>
    </>
  );
}

/** Write a subtask straight into the task's list of subtasks: Enter adds it and keeps going. */
function SubtaskAdd({ listId, parentId }: { listId: string; parentId: string }) {
  const hub = useHub();
  const alsoShop = useAlsoShop();
  const [t, setT] = useState('');
  const add = () => {
    const v = t.trim();
    if (!v) return;
    alsoShop(hub.addItem(listId, { title: v, parentId }));
    setT('');
  };
  return (
    <label className="composer__stepadd subtaskadd">
      <Icon name="plus" className="icon--sm" />
      <input
        value={t}
        dir="auto"
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder="Add a subtask"
        aria-label="Add a subtask"
        enterKeyHint="next"
      />
      {t.trim() ? (
        <button type="button" className="btn btn--sm composer__stepgo" onMouseDown={(e) => e.preventDefault()} onClick={add}>
          Add
        </button>
      ) : null}
    </label>
  );
}


import { PathCrumbs } from '../components/PathCrumbs';
import { addPhotoTo, Photos } from '../components/Photos';
import { useBackGuard } from '../ui/backGuard';
import { PlaceTree } from '../components/PlaceTree';
import { StockCount, stockTone, useStockSet } from '../components/StockCount';
import { isStocked } from '../../core/model';
import { useAlsoShop } from '../alsoShop';
import { tourOpened } from '../tour';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { addDays, humanDate, relativeAgo, today as todayStr } from '../../core/dates';
import { isFlexible } from '../../smart/recurrence';
import { Children } from '../components/Children';
import { InlineEditor, useSummary } from '../components/editors';
import { notifyAbout, setUpReminders } from '../notify';
import { freshAgain, useLater, useTick } from '../tick';
import { ActionSheet } from '../components/pickers';
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
import { Avatar, Band, Check, Choices, Empty, IconButton, lineVars, ListBullet, Section, StarButton, Stepper, ThanksButton, TextButton, Button } from '../ui/primitives';
import { RequestActions } from '../ui/tags';
import { AutoTitle } from '../ui/AutoTitle';
import type { Draft } from '../draft';
import { G, G_TEXT } from '../ui/glyphs';
import { myName } from '../labels';

function ItemMenu({ id, onClose, onGone }: { id: string; onClose: () => void; onGone: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const item = hub.item(id);
  if (!item) return null;
  return (
    <ActionSheet
      title="More"
      onClose={onClose}
      actions={[
        {
          icon: G.move,
          title: 'Make it its own task',
          sub: `Out from under “${hub.item(item.parentId)?.title ?? 'its task'}”, in ${hub.list(item.listId)?.name ?? 'its folder'}`,
          hidden: !item.parentId,
          run: () => {
            const was = { listId: item.listId, parentId: item.parentId ?? null };
            hub.move(id, { listId: item.listId, parentId: null });
            toast(`“${item.title}” is its own task`, { undo: () => hub.move(id, was) });
          },
        },
        {
          icon: G.copy,
          title: 'Duplicate',
          run: () => {
            const nid = hub.duplicate(id);
            if (nid) navigate({ name: 'item', id: nid }, { replace: true });
            toast('Duplicated');
          },
        },
        {
          icon: G.delete,
          title: 'Delete',
          danger: true,
          run: () => {
            const undo = hub.delete(id);
            onGone();
            toast(`Deleted “${item.title}”`, { undo });
          },
        },
      ]}
    />
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
          <TextButton
            iconAfter={G.continue}
            onClick={() => {
              onClose();
              navigate(hub.list(from) ? { name: 'list', id: from } : { name: 'item', id: from });
            }}
          >
            Open {fromName}
          </TextButton>
        </p>
      ) : null}
      <PlaceTree
        tasks
        excludeItem={id}
        current={{ listId: item.listId, parentId: item.parentId ?? null }}
        offer={(l) => !l.owner || l.owner === hub.meId || l.visibility === 'visible'}
        onPick={(p) => p && setTo(p)}
      />
      {to ? (
        <div className="moveask" role="alertdialog" aria-label={`Move to ${name(to)}?`}>
          <p dir="auto">
            Move to <strong>{name(to)}</strong>?
          </p>
          <Choices
            row
            choices={[
              { label: 'Cancel', quiet: true, run: () => setTo(null) },
              { label: 'Move', run: go },
            ]}
          />
        </div>
      ) : null}
    </Sheet>
  );
}

/** One column of the stock panel: a word over − n +. */
function StockCol({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stockcol">
      <span className="stockcol__label">{label}</span>
      {children}
    </div>
  );
}

/**
 * Stock on a task: Have · Buy at · Urgent, each − n +. At or under "Buy at" it's one of its
 * folder's tasks (to buy); above it, it waits in the folder's "In stock". At or under "Urgent" it's
 * urgent (off: never). One quiet line under them says where it is now, and stops counting.
 * Opening it starts counting.
 */
function StockPanel({ id }: { id: string }) {
  const hub = useHub();
  const item = hub.item(id);
  const on = item?.stock != null;
  const set = useStockSet(id);
  // Opening it is starting it.
  useEffect(() => {
    if (item && item.stock == null) hub.setStock(id, { stock: 2, stockAddAt: 1, stockUrgentAt: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!item || !on) return null;
  const have = item.stock ?? 0;
  const at = item.stockAddAt ?? 1;
  const urgentAt = item.stockUrgentAt ?? null;
  const tone = stockTone(item);
  const folder = hub.list(item.listId)?.name ?? 'its folder';
  return (
    <>
      <div className="stockcols">
        <StockCol label="Have">
          <Stepper label="Have" value={have} tone={tone} onChange={(n) => set({ stock: n ?? 0 })} />
        </StockCol>
        <StockCol label="Buy at">
          <Stepper label="Buy at" value={at} onChange={(n) => set({ stockAddAt: n ?? 0, ...(urgentAt != null && urgentAt > (n ?? 0) ? { stockUrgentAt: n ?? 0 } : {}) })} />
        </StockCol>
        <StockCol label="Urgent">
          <Stepper label="Urgent at" value={urgentAt} nullable max={at} onChange={(n) => set({ stockUrgentAt: n })} />
        </StockCol>
      </div>
      <div className="stockfoot">
        <span className="stockfoot__where">
          <Icon name={G.stock} className="icon--xs" />
          {isStocked(item) ? `In stock, in ${folder}` : `Time to buy: one of the tasks in ${folder}`}
        </span>
        <button type="button" className="stockfoot__stop" onClick={() => set({ stock: null })} aria-label="Stop counting" title="Stop counting">
          <Icon name={G.close} className="icon--xs" />
        </button>
      </div>
    </>
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
      undo,
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
        <Icon name={G.date} className="icon--sm" />
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
  const tracked = ['title', 'notes', 'due', 'dueTime', 'repeat', 'remind', 'nag', 'assignee', 'urgent', 'private', 'owner', 'tags', 'needsOk'] as const;
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
  const partnerName = partner?.name ?? 'your person';
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
    icon: G.linked,
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
              toast(`Taken out of ${where}`, { undo });
            }}
          >
            <Icon name={G.close} className="token__x" />
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
              toast(`Taken out of ${here}`, { undo });
            }}
          >
            <Icon name={G.close} className="token__x" />
            <span dir="auto">Remove from {(item.parentId && hub.item(item.parentId)?.title) || list?.name || 'here'}</span>
          </button>
        </div>
      ) : (
        <PlaceTree
          tasks
          excludeItem={id}
          onPick={(p) => {
            if (!p) return;
            const { listId: lid, parentId } = p;
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
    icon: tl.lead ? undefined : G.tag,
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
        notifyAbout(rt, hub, now, p.assignee as string, `${G_TEXT.ask} ${myName(hub)} asked you`, now.title);
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
              <StarButton
                on={inQuick}
                onLabel="In your Highlights"
                offLabel="Add to your Highlights"
                onChange={(on) => {
                  const undo = setQuick(id, on);
                  toast(on ? 'In your Highlights, on Today' : 'Out of your Highlights', { undo });
                }}
              />
              <IconButton icon={G.more} label="More" onClick={() => openSheet((close) => <ItemMenu id={id} onClose={close} onGone={() => back(upTo)} />)} />
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
              <Icon name={G.photo} />
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
                      icon: G.done,
                      panel: (close: () => void) => <DonePanel id={id} close={close} />,
                    },
                  ]
                : []),
              ...(!item.parentId
                ? [
                    {
                      key: 'stock',
                      label: item.stock != null ? `${item.stock} in stock` : 'Stock',
                      icon: G.stock,
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
                      <ThanksButton on={!!l.thankedBy} label="Say thanks" onToggle={() => hub.thank(l.id)} />
                    ) : l.thankedBy ? (
                      <span className="heart is-on" title="Thanked">
                        <Icon name={G.thanked} />
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
      <Icon name={G.add} className="icon--sm" />
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
        <Button small onMouseDown={(e) => e.preventDefault()} onClick={add} className="composer__stepgo">
          Add
        </Button>
      ) : null}
    </label>
  );
}


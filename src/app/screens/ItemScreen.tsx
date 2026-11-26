import { PlacePicker } from '../components/PlacePicker';
import { useAlsoShop } from '../alsoShop';
import { tourOpened } from '../tour';
import { useEffect, useState } from 'react';
import { addDays, humanDate, relativeAgo, today as todayStr } from '../../core/dates';
import { isFlexible } from '../../smart/recurrence';
import { Children } from '../components/Children';
import { InlineEditor, useSummary, type Draft } from '../components/editors';
import { notifyAbout, setUpReminders } from '../notify';
import { freshAgain, useLater, useTick } from '../tick';
import { ListPickerSheet, OptRow } from '../components/pickers';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { useAddAction } from '../addAction';
import { ShopItemSheet } from '../components/ShopItemSheet';
import { useHub, useRt } from '../context';
import { back, navigate } from '../router';
import { allowedVis, itemVisChoice, setItemVis } from '../privacy';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Avatar, Band, Check, Empty, IconButton, lineVars, ListBullet, NewButton, Section } from '../ui/primitives';
import { RequestActions } from '../ui/tags';
import { AutoTitle } from '../ui/AutoTitle';

function ItemMenu({ id, onClose, onGone }: { id: string; onClose: () => void; onGone: () => void }) {
  const hub = useHub();
  const { openSheet, toast } = useOverlays();
  const item = hub.item(id);
  if (!item) return null;
  return (
    <Sheet onClose={onClose} title="More">
      <div className="group">
        <OptRow
          icon="move"
          title="Move to another project"
          onClick={() => {
            onClose();
            openSheet((close) => (
              <ListPickerSheet
                onClose={close}
                current={item.listId}
                filter={(l) => l.kind !== 'shopping' && (!l.owner || l.owner === hub.meId)}
                onPick={(l) => {
                  hub.move(id, { listId: l.id });
                  toast(`Moved to ${l.name}`);
                }}
              />
            ));
          }}
        />
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
      if (hub.canTick(it)) tick(it);
    } else if (act === 'later') {
      hub.snooze(id, addDays(todayStr(), 1));
      toast(`${it.title}: tomorrow`);
    }
  }, [hub, id]);

  // Start here: "Tap me to open me" is done by opening it (ticked as you leave, after reading).
  useEffect(
    () => () => {
      const it = hub.item(id);
      if (it) tourOpened(hub, it);
    },
    [hub, id],
  );

  useEffect(() => {
    // Shopping items edit in their own sheet.
    if (item && hub.list(item.listId)?.kind === 'shopping' && !item.parentId) {
      navigate({ name: 'shop' }, { replace: true });
      openSheet((close) => <ShopItemSheet id={item.id} onClose={close} />);
    }
  }, [item, hub, openSheet]);

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
  const editable = hub.canEdit(item);
  const vis = hub.visibilityOf(item);
  const partner = hub.partner();
  const partnerName = partner?.name ?? 'your partner';
  const logs = hub
    .logsFor(id)
    .filter((l) => l.kind === 'done')
    .slice(0, 5);
  // My partner's thing can be theirs, ours or mine again, but hiding it from them isn't mine to do.
  const allowed = allowedVis(hub, list, ancestors.at(-1)).filter((v) => v !== 'private' || itemVisChoice(hub, item) !== 'theirs');
  const visChoice = itemVisChoice(hub, item);
  const asker = item.requestedBy ? hub.member(item.requestedBy) : undefined;
  const iAsked = item.requestedBy === hub.meId;
  const upTo = ancestors.length
    ? { name: 'item' as const, id: ancestors[ancestors.length - 1].id }
    : list
      ? { name: 'list' as const, id: list.id }
      : { name: 'today' as const };
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
            onClick={() => navigate(twinList.kind === 'shopping' ? { name: 'shop' } : { name: 'item', id: twin.parentId ?? twin.id })}
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
              navigate(twinList.kind === 'shopping' ? { name: 'shop' } : { name: 'item', id: twin.id }, { replace: true });
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

  const onToggle = () => {
    if (hub.canTick(item)) tick(item);
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
        onBack={() => back(upTo)}
        mini={item.title}
        actions={
          editable ? (
            <>
              <IconButton icon="more" label="More" onClick={() => openSheet((close) => <ItemMenu id={id} onClose={close} onGone={() => back(upTo)} />)} />
              <NewButton label="Add a subtask" onClick={openNew} />
            </>
          ) : undefined
        }
        crumbs={
          <nav className="crumbs" aria-label="Path">
            <button type="button" onClick={() => list && navigate({ name: 'list', id: list.id })} dir="auto">
              {list?.name}
            </button>
            {ancestors.map((a) => (
              <span key={a.id} className="crumbs__step">
                <Icon name="chevron-right" className="icon--sm" />
                <button type="button" onClick={() => navigate({ name: 'item', id: a.id })} dir="auto">
                  {a.title}
                </button>
              </span>
            ))}
          </nav>
        }
      >
        <div className={`hero hero--item ${item.done ? 'is-done' : ''}`} style={lineVars(list?.color)}>
          <div className="hero__top">
            <AutoTitle value={item.title} onSave={(t) => hub.updateItem(id, { title: t })} readOnly={!editable} />
            <Check on={item.done} onToggle={onToggle} label={item.done ? 'Mark not done' : 'Mark done'} />
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
                  : `${summarize(draft)}${asker && !iAsked ? (item.sentBackAt ? ` ${asker.name} said not yet.` : ` ${asker.name} asked.`) : ''}`}
            {item.repeat && item.lastDoneAt && !item.done
              ? ` Last done ${relativeAgo(item.lastDoneAt)}${item.lastDoneBy && item.lastDoneBy !== hub.meId ? ` by ${hub.member(item.lastDoneBy)?.name ?? ''}` : ''}.`
              : ''}
          </p>
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
              alsoChip,
              // Someday: out of sight (Today, counts, reminders) till it's brought back.
              ...(list?.kind === 'tasks' && !item.parentId && !item.done
                ? [
                    {
                      key: 'backlog',
                      label: item.someday ? 'In the backlog' : 'Backlog',
                      icon: 'inbox' as const,
                      set: !!item.someday,
                      toggle: () => {
                        const undo = hub.setSomeday(id, !item.someday);
                        toast(item.someday ? `Back in ${list.name}` : 'In the backlog, out of sight', { action: { label: 'Undo', run: undo } });
                      },
                    },
                  ]
                : []),
            ]}
            value={draft}
            onChange={change}
            fields={(['when', 'repeat', 'remind', 'who', 'vis', 'urgent'] as const).filter(
              (f) => (f !== 'vis' || hub.canSetPrivacy(item)) && (f !== 'who' || vis !== 'private'),
            )}
            allowedVis={allowed}
            turn={item.turn}
            prompt="Want to modify something?"
            repeatFrom={list?.kind === 'chores' ? 'done' : 'schedule'}
          />
        ) : null}

        {vis === 'ours' && !item.assignee && editable && partner && !item.done ? (
          <button type="button" className="textbtn takeit" onClick={() => hub.takeIt(id)}>
            <Icon name="hand" className="icon--sm" /> I’ll take it
          </button>
        ) : null}

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


import { useEffect, useRef, useState } from 'react';
import { addDays, humanDate, relativeAgo, today as todayStr } from '../../core/dates';
import { isFlexible } from '../../smart/recurrence';
import { Children } from '../components/Children';
import { InlineEditor, useSummary, type Draft } from '../components/editors';
import { ListPickerSheet, OptRow } from '../components/pickers';
import { QuickAdd } from '../components/QuickAdd';
import { ShopItemSheet } from '../components/ShopItemSheet';
import { useHub, useRt } from '../context';
import { back, navigate } from '../router';
import { enablePush } from '../runtime';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Avatar, Band, Check, Empty, IconButton, lineVars, Section } from '../ui/primitives';

function AutoTitle({ value, onSave, readOnly }: { value: string; onSave: (v: string) => void; readOnly: boolean }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [v]);
  return (
    <textarea
      ref={ref}
      className="hero__titleinput"
      dir="auto"
      rows={1}
      value={v}
      readOnly={readOnly}
      aria-label="Title"
      onChange={(e) => setV(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      onBlur={() => {
        const t = v.trim();
        if (t && t !== value) onSave(t);
        else setV(value);
      }}
    />
  );
}

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
          onClick={() => {
            const undo = hub.delete(id);
            onClose();
            onGone();
            toast(`Deleted “${item.title}”`, { action: { label: 'Undo', run: undo } });
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
  const item = hub.item(id);
  const ref = todayStr();
  if (!item?.repeat) return null;
  const done = (day: string, label: string) => {
    const undo = hub.completeRepeating(id, day);
    toast(label, { action: { label: 'Undo', run: undo } });
    close();
  };
  return (
    <div className="options">
      <button type="button" className="option" onClick={() => done(ref, 'Done. Fresh again.')}>
        Today
      </button>
      <button type="button" className="option" onClick={() => done(addDays(ref, -1), 'Counted for yesterday')}>
        Yesterday
      </button>
      <label className="option option--input">
        <Icon name="calendar" className="icon--sm" />
        <input type="date" max={ref} aria-label="Done on a day" onChange={(e) => e.target.value && done(e.target.value, `Counted for ${humanDate(e.target.value, ref)}`)} />
      </label>
      {isFlexible(item.repeat) ? (
        <button
          type="button"
          className="option"
          onClick={() => {
            const undo = hub.snooze(id, addDays(ref, 1));
            toast('Tomorrow, then', { action: { label: 'Undo', run: undo } });
            close();
          }}
        >
          Not today
        </button>
      ) : (
        <button
          type="button"
          className="option"
          onClick={() => {
            const undo = hub.skip(id);
            toast(`Skipped. Next: ${humanDate(hub.item(id)!.due!, ref)}`, { action: { label: 'Undo', run: undo } });
            close();
          }}
        >
          Skip this one
        </button>
      )}
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
  const { openSheet, toast } = useOverlays();
  const summarize = useSummary();
  const item = hub.item(id);
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [freshId, setFreshId] = useState<string | null>(null);
  useEffect(() => setNotes(item?.notes ?? ''), [item?.notes]);

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
  const ref = todayStr();
  const logs = hub.logsFor(id).filter((l) => l.kind === 'done').slice(0, 5);
  const parentVis = ancestors.length ? hub.visibilityOf(ancestors[ancestors.length - 1]) : null;
  const allowed =
    list?.visibility === 'private' || parentVis === 'private'
      ? (['private'] as const)
      : list?.visibility === 'visible'
        ? (['mine', 'private'] as const)
        : (['ours', 'mine', 'private'] as const);
  const upTo = ancestors.length ? { name: 'item' as const, id: ancestors[ancestors.length - 1].id } : list ? { name: 'list' as const, id: list.id } : { name: 'today' as const };
  const steps = hub.childrenOf(id);

  const onToggle = () => {
    if (!hub.canTick(item)) return;
    if (item.repeat && !item.done) {
      const undo = hub.completeRepeating(id);
      toast(`Nice. Next time: ${humanDate(hub.item(id)!.due!, ref)}`, { action: { label: 'Undo', run: undo } });
    } else hub.toggle(id);
  };

  const draft: Draft = {
    due: item.due ?? null,
    dueTime: item.dueTime ?? null,
    repeat: item.repeat ?? null,
    remind: item.remind ?? null,
    assignee: item.assignee ?? null,
    urgent: !!item.urgent,
    visibility: vis,
  };

  const change = (p: Partial<Draft>) => {
    if ('visibility' in p && p.visibility && p.visibility !== vis) {
      if (p.visibility === 'private' && partner) toast(`This will disappear for ${partnerName}`);
      hub.setItemVisibility(id, p.visibility);
      return;
    }
    if ('assignee' in p) {
      hub.updateItem(id, { assignee: p.assignee ?? null, turn: p.assignee === 'turns' ? (item.turn ?? hub.meId) : null });
      return;
    }
    if ('remind' in p && p.remind !== null && p.remind !== undefined) {
      void enablePush(rt).then((s) => {
        if (s === 'install') toast('Add Gila Hub to your Home Screen to get reminders on iPhone.');
        else if (s === 'denied') toast('Notifications are blocked in your settings. Reminders will show in the app.');
        else if (s === 'no-relay') toast('Reminder set. It pops up while Gila Hub is open.');
      });
    }
    const { visibility: _v, ...rest } = p;
    void _v;
    hub.updateItem(id, rest);
  };

  return (
    <>
      <Band
        onBack={() => back(upTo)}
        mini={item.title}
        actions={editable ? <IconButton icon="more" label="More" onClick={() => openSheet((close) => <ItemMenu id={id} onClose={close} onGone={() => back(upTo)} />)} /> : undefined}
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
            {item.done ? `Done${item.doneAt ? ` ${relativeAgo(item.doneAt)}` : ''}.` : item.paused ? 'Paused.' : summarize(draft)}
            {item.repeat && item.lastDoneAt && !item.done
              ? ` Last done ${relativeAgo(item.lastDoneAt)}${item.lastDoneBy && item.lastDoneBy !== hub.meId ? ` by ${hub.member(item.lastDoneBy)?.name ?? ''}` : ''}.`
              : ''}
          </p>
        </div>
      </Band>

      <div className="column">
        {editable ? (
          <InlineEditor
            extras={item.repeat ? [{ key: 'done', label: 'Done…', icon: 'check', panel: (close) => <DonePanel id={id} close={close} /> }] : []}
            value={draft}
            onChange={change}
            fields={hub.canSetPrivacy(item) ? ['when', 'repeat', 'remind', 'who', 'vis', 'urgent'] : ['when', 'repeat', 'remind', 'who', 'urgent']}
            allowedVis={[...allowed]}
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

        {steps.length ? (
          <Section title="Steps" count={steps.length}>
            <Children listId={item.listId} parentId={id} freshId={freshId} readonly={!editable} />
            {editable ? <QuickAdd listId={item.listId} parentId={id} onAdded={setFreshId} placeholder="Add a step" /> : null}
          </Section>
        ) : editable ? (
          <div className="steps-add">
            <QuickAdd listId={item.listId} parentId={id} onAdded={setFreshId} placeholder="Add a step" />
          </div>
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
                          {new Date(l.at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </span>
                    </div>
                    {l.by !== hub.meId ? (
                      <button type="button" className={`heart ${l.thankedBy ? 'is-on' : ''}`} onClick={() => hub.thank(l.id)} aria-label="Say thanks" aria-pressed={!!l.thankedBy}>
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

import { useEffect, useRef, useState } from 'react';
import { addDays, humanDate, humanTime, relativeAgo, today as todayStr, weekdayName } from '../../core/dates';
import { describeRule, isFlexible } from '../../smart/recurrence';
import { Children } from '../components/Children';
import { useCarrier } from '../components/ItemRow';
import { DateSheet, ListPickerSheet, OptRow, RemindSheet, RepeatSheet, VIS_HINT, VisibilityControl, WhoSheet, remindLabel, whoLabel } from '../components/pickers';
import { QuickAdd } from '../components/QuickAdd';
import { ShopItemSheet } from '../components/ShopItemSheet';
import { useHub, useRt } from '../context';
import { use24h, usePrefs } from '../prefs';
import { back, navigate } from '../router';
import { enablePush } from '../runtime';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Band, Check, Empty, PersonBullet, Section, Switch } from '../ui/primitives';

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
      className="bandtitle"
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

export function ItemScreen({ id }: { id: string }) {
  const hub = useHub();
  const rt = useRt();
  const prefs = usePrefs();
  const { openSheet, toast } = useOverlays();
  const item = hub.item(id);
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [freshId, setFreshId] = useState<string | null>(null);
  const carrier = useCarrier(item ?? ({} as never));
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
  const h24 = use24h(prefs);
  const logs = hub.logsFor(id).filter((l) => l.kind === 'done').slice(0, 6);
  const parentVis = ancestors.length ? hub.visibilityOf(ancestors[ancestors.length - 1]) : null;
  const allowed =
    list?.visibility === 'private' || parentVis === 'private'
      ? (['private'] as const)
      : list?.visibility === 'visible'
        ? (['mine', 'private'] as const)
        : (['ours', 'mine', 'private'] as const);
  const upTo = ancestors.length ? { name: 'item' as const, id: ancestors[ancestors.length - 1].id } : list ? { name: 'list' as const, id: list.id } : { name: 'today' as const };

  const onToggle = () => {
    if (!hub.canTick(item)) return;
    if (item.repeat && !item.done) {
      const undo = hub.completeRepeating(id);
      toast(`Nice. Next time: ${humanDate(hub.item(id)!.due!, ref)}`, { action: { label: 'Undo', run: undo } });
    } else hub.toggle(id);
  };

  const setReminder = (v: number | null) => {
    hub.updateItem(id, { remind: v, due: v !== null && !item.due ? ref : item.due });
    if (v !== null) {
      void enablePush(rt).then((s) => {
        if (s === 'install') toast('Add Gila Hub to your Home Screen to get reminders on iPhone.');
        else if (s === 'denied') toast('Notifications are blocked in your settings — reminders will show in the app.');
        else if (s === 'no-relay') toast('Reminder set. It will pop up while Gila Hub is open.');
      });
    }
  };

  const dateValue = item.due ? `${humanDate(item.due, ref)}${item.dueTime ? ` · ${humanTime(item.dueTime, h24)}` : ''}` : 'Someday';

  return (
    <>
      <Band
        className="band--item"
        title={<AutoTitle value={item.title} onSave={(t) => hub.updateItem(id, { title: t })} readOnly={!editable} />}
        mini={item.title}
        lead={<Check on={item.done} color={list?.color} onToggle={onToggle} label={item.done ? 'Mark not done' : 'Mark done'} />}
        onBack={() => back(upTo)}
        crumbs={
          <nav className="crumbs" aria-label="Path">
            <button type="button" onClick={() => list && navigate({ name: 'list', id: list.id })} dir="auto">
              {list?.name}
            </button>
            {ancestors.map((a) => (
              <span key={a.id} style={{ display: 'contents' }}>
                <Icon name="chevron-right" className="icon--sm" />
                <button type="button" onClick={() => navigate({ name: 'item', id: a.id })} dir="auto">
                  {a.title}
                </button>
              </span>
            ))}
          </nav>
        }
      />
      <div className="column">
        {!editable ? (
          <p className="hint" style={{ marginTop: 16 }}>
            This is {hub.member(hub.ownerOf(item))?.name}’s. You can see it — only they change it.
          </p>
        ) : null}

        {item.repeat && editable ? (
          <div className="chorepanel">
            <div className="chorepanel__row">
              <span className="chorepanel__label">Done</span>
              <div className="chips">
                <button type="button" className="chip chip--on" onClick={onToggle}>
                  <Icon name="check" /> Today
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    const undo = hub.completeRepeating(id, addDays(ref, -1));
                    toast('Counted for yesterday', { action: { label: 'Undo', run: undo } });
                  }}
                >
                  Yesterday
                </button>
                <label className="chip">
                  Pick a day
                  <input
                    type="date"
                    className="sr-only"
                    max={ref}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const undo = hub.completeRepeating(id, e.target.value);
                      toast(`Counted for ${humanDate(e.target.value, ref)}`, { action: { label: 'Undo', run: undo } });
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="chorepanel__row">
              <span className="chorepanel__label">Not now</span>
              <div className="chips">
                {isFlexible(item.repeat) ? (
                  <button
                    type="button"
                    className="chip chip--outline"
                    onClick={() => {
                      const undo = hub.snooze(id, addDays(ref, 1));
                      toast('Tomorrow, then', { action: { label: 'Undo', run: undo } });
                    }}
                  >
                    <Icon name="snooze" /> Tomorrow
                  </button>
                ) : (
                  <button
                    type="button"
                    className="chip chip--outline"
                    onClick={() => {
                      const undo = hub.skip(id);
                      toast(`Skipped — next: ${humanDate(hub.item(id)!.due!, ref)}`, { action: { label: 'Undo', run: undo } });
                    }}
                  >
                    <Icon name="skip" /> Skip this one
                  </button>
                )}
                <button type="button" className="chip chip--outline" onClick={() => hub.setPaused(id, !item.paused)}>
                  <Icon name="pause" /> {item.paused ? 'Resume' : 'Pause'}
                </button>
              </div>
            </div>
            <p className="chorepanel__next">
              {item.paused ? 'Paused — it won’t come due until you resume it.' : item.due ? `Next: ${humanDate(item.due, ref)}` : ''}
              {item.lastDoneAt ? ` · last done ${relativeAgo(item.lastDoneAt)} by ${hub.member(item.lastDoneBy)?.name ?? '—'}` : ''}
            </p>
          </div>
        ) : null}

        <div className="card" style={{ margin: '18px var(--gutter) 0' }}>
          <OptRow
            icon="calendar"
            title="When"
            value={dateValue}
            disabled={!editable}
            onClick={() =>
              openSheet((close) => <DateSheet onClose={close} due={item.due} time={item.dueTime} onSave={(d, t) => hub.updateItem(id, { due: d, dueTime: t })} />)
            }
          />
          <OptRow
            icon="repeat"
            title="Repeat"
            value={item.repeat ? describeRule(item.repeat, (n) => weekdayName(n)) : 'Never'}
            disabled={!editable}
            onClick={() =>
              openSheet((close) => (
                <RepeatSheet
                  onClose={close}
                  rule={item.repeat}
                  defaultFrom={list?.kind === 'chores' ? 'done' : 'schedule'}
                  onSave={(r) => hub.updateItem(id, { repeat: r, due: r && !item.due ? ref : item.due })}
                />
              ))
            }
          />
          <OptRow icon="bell" title="Remind me" value={remindLabel(item.remind)} disabled={!editable} onClick={() => openSheet((close) => <RemindSheet onClose={close} value={item.remind} onSave={setReminder} />)} />
          {vis === 'ours' ? (
            <OptRow
              icon="user"
              title="Who"
              lead={carrier ? <PersonBullet member={carrier} size="md" /> : undefined}
              value={whoLabel(hub, item.assignee, item.turn)}
              disabled={!editable}
              onClick={() =>
                openSheet((close) => (
                  <WhoSheet onClose={close} value={item.assignee} repeating={!!item.repeat} onSave={(a) => hub.updateItem(id, { assignee: a, turn: a === 'turns' ? (item.turn ?? hub.meId) : null })} />
                ))
              }
            />
          ) : null}
          <div className="optrow">
            <span className="optrow__icon">◆</span>
            <span className="optrow__text">
              Urgent <span className="optrow__sub">Floats to the top</span>
            </span>
            <Switch on={!!item.urgent} onChange={(on) => editable && hub.updateItem(id, { urgent: on })} label="Urgent" />
          </div>
        </div>

        {vis === 'ours' && !item.assignee && editable && partner && !item.done ? (
          <div style={{ margin: '12px var(--gutter) 0' }}>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => hub.takeIt(id)}>
              <Icon name="hand" className="icon--sm" /> I’ll take it
            </button>
          </div>
        ) : null}

        {editable && allowed.length > 1 ? (
          <div className="field" style={{ margin: '22px var(--gutter) 0' }}>
            <span className="field__label">Who can see it</span>
            <VisibilityControl
              value={vis}
              allowed={[...allowed]}
              partnerName={partnerName}
              onChange={(nv) => {
                if (nv === 'private' && vis !== 'private' && partner) toast(`This will disappear for ${partnerName}`);
                hub.setItemVisibility(id, nv);
              }}
            />
            <p className="hint" style={{ margin: '8px 2px 0' }}>
              {VIS_HINT(vis, partnerName)}
            </p>
          </div>
        ) : vis === 'private' ? (
          <p className="hint" style={{ marginTop: 18 }}>
            <Icon name="lock" className="icon--sm" style={{ display: 'inline', verticalAlign: '-3px' }} /> Only you can see this.
          </p>
        ) : null}

        <div className="field" style={{ margin: '22px var(--gutter) 0' }}>
          <span className="field__label">Notes</span>
          <textarea
            className="input"
            dir="auto"
            value={notes}
            readOnly={!editable}
            placeholder={editable ? 'Anything worth remembering…' : ''}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (item.notes ?? '') && hub.updateItem(id, { notes })}
          />
        </div>

        <Section title="Steps" count={hub.childrenOf(id).length || undefined}>
          {editable ? (
            <div style={{ marginTop: -8 }}>
              <QuickAdd listId={item.listId} parentId={id} onAdded={setFreshId} placeholder="Add a step" />
            </div>
          ) : null}
          <div style={{ marginTop: 10 }}>
            <Children listId={item.listId} parentId={id} freshId={freshId} readonly={!editable} />
          </div>
          {!hub.childrenOf(id).length && editable ? <p className="hint">Break it down. Steps can have their own steps, as deep as you like.</p> : null}
        </Section>

        {logs.length ? (
          <Section title="History">
            <ul className="rows">
              {logs.map((l) => {
                const by = hub.member(l.by);
                return (
                  <li key={l.id} className="row">
                    <PersonBullet member={by} size="md" />
                    <div className="row__body">
                      <span className="row__title">{by?.id === hub.meId ? 'You' : by?.name}</span>
                      <span className="row__meta">{new Date(l.at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                    {l.by !== hub.meId ? (
                      <button type="button" className={`iconbtn heart ${l.thankedBy ? 'is-on' : ''}`} onClick={() => hub.thank(l.id)} aria-label="Say thanks" aria-pressed={!!l.thankedBy}>
                        <Icon name={l.thankedBy ? 'heart-fill' : 'heart'} />
                      </button>
                    ) : l.thankedBy ? (
                      <span className="meta" style={{ color: 'var(--tomato)' }}>
                        <Icon name="heart-fill" className="icon--sm" /> thanked
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}

        {editable ? (
          <div className="itemactions">
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() =>
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
                ))
              }
            >
              <Icon name="move" className="icon--sm" /> Move
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => {
                const nid = hub.duplicate(id);
                if (nid) navigate({ name: 'item', id: nid }, { replace: true });
                toast('Duplicated');
              }}
            >
              <Icon name="copy" className="icon--sm" /> Duplicate
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => {
                const undo = hub.delete(id);
                back(upTo);
                toast(`Deleted “${item.title}”`, { action: { label: 'Undo', run: undo } });
              }}
            >
              <Icon name="trash" className="icon--sm" /> Delete
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

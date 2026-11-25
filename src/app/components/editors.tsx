import { useState, type ReactNode } from 'react';
import type { ItemVisibility } from '../../core/actions';
import { addDays, humanDate, humanTime, today as todayStr, weekday, weekdayName } from '../../core/dates';
import type { Assignee, RepeatRule, RepeatUnit } from '../../core/model';
import { describeRule } from '../../smart/recurrence';
import { useHub } from '../context';
import { use24h, usePrefs, weekStart } from '../prefs';
import { REMIND_OPTIONS } from '../reminders';
import { Icon, type IconName } from '../ui/Icon';
import { Avatar, Chip } from '../ui/primitives';

/** Everything the inline editor can change about an item. */
export interface Draft {
  due: string | null;
  dueTime: string | null;
  repeat: RepeatRule | null;
  remind: number | null;
  assignee: Assignee;
  urgent: boolean;
  visibility: ItemVisibility;
}

export type Field = 'when' | 'repeat' | 'remind' | 'who' | 'vis' | 'urgent';

const VIS: Record<ItemVisibility, { label: string; icon: IconName }> = {
  ours: { label: 'Ours', icon: 'ours' },
  mine: { label: 'Mine', icon: 'mine' },
  private: { label: 'Only me', icon: 'lock' },
};

export const ruleShort = (r: RepeatRule) => describeRule(r, (n) => weekdayName(n)).replace(" after it's done", '');

export function remindText(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return REMIND_OPTIONS.find((o) => o.value === v)?.label ?? `${v} min before`;
}

export function whoText(hub: ReturnType<typeof useHub>, a: Assignee | undefined, turn?: string | null): string {
  if (!a) return 'Either of us';
  if (a === 'both') return 'Together';
  if (a === 'turns') return turn ? `Turns · ${turn === hub.meId ? 'you' : (hub.member(turn)?.name ?? '')} next` : 'Taking turns';
  return a === hub.meId ? 'Me' : (hub.member(a)?.name ?? 'Someone');
}

/** One calm sentence that says what the item is set to, like Tasky's card subtitle. */
export function useSummary() {
  const hub = useHub();
  const prefs = usePrefs();
  const h24 = use24h(prefs);
  return (d: Partial<Draft>, opts: { listName?: string } = {}): string => {
    const ref = todayStr();
    const parts: string[] = [];
    if (d.due) {
      const day = humanDate(d.due, ref);
      parts.push(d.dueTime ? `${day} at ${humanTime(d.dueTime, h24)}` : day);
    }
    if (d.repeat) parts.push(ruleShort(d.repeat).toLowerCase().replace(/^every/, d.due ? 'then every' : 'every'));
    if (d.assignee) {
      const who = whoText(hub, d.assignee);
      parts.push(d.assignee === 'both' ? 'together' : d.assignee === 'turns' ? 'taking turns' : who === 'Me' ? 'for you' : `for ${who}`);
    }
    const r = remindText(d.remind);
    if (r) parts.push(`reminder ${r.toLowerCase()}`);
    if (!parts.length) return opts.listName ? `In ${opts.listName}. No date, whenever suits.` : 'No date. Whenever suits.';
    const s = parts.join(', ');
    return `${s[0].toUpperCase()}${s.slice(1)}.`;
  };
}

/**
 * Inline controls: a row of soft chips; tapping one opens its options right
 * below, in place. No forms, no stacked sheets.
 */
export function InlineEditor({
  value,
  onChange,
  fields,
  allowedVis = ['ours', 'mine', 'private'],
  repeatFrom = 'schedule',
  readOnly,
  prompt = 'Want to change something?',
}: {
  value: Draft;
  onChange: (patch: Partial<Draft>) => void;
  fields: Field[];
  allowedVis?: ItemVisibility[];
  repeatFrom?: 'done' | 'schedule';
  readOnly?: boolean;
  prompt?: string | null;
}) {
  const hub = useHub();
  const prefs = usePrefs();
  const h24 = use24h(prefs);
  const [open, setOpen] = useState<Field | null>(null);
  const ref = todayStr();
  const toggle = (f: Field) => setOpen(open === f ? null : f);
  const partner = hub.partner();

  const chip = (f: Field, label: ReactNode, icon: IconName, set: boolean) => (
    <button
      key={f}
      type="button"
      className={`echip ${set ? 'is-set' : ''} ${open === f ? 'is-open' : ''}`}
      onClick={() => toggle(f)}
      aria-expanded={open === f}
      disabled={readOnly}
    >
      <Icon name={icon} className="icon--sm" />
      <span>{label}</span>
    </button>
  );

  const chips: ReactNode[] = [];
  for (const f of fields) {
    if (f === 'when') chips.push(chip('when', value.due ? `${humanDate(value.due, ref)}${value.dueTime ? ` · ${humanTime(value.dueTime, h24)}` : ''}` : 'Date', 'calendar', !!value.due));
    if (f === 'repeat') chips.push(chip('repeat', value.repeat ? ruleShort(value.repeat) : 'Repeat', 'repeat', !!value.repeat));
    if (f === 'remind') chips.push(chip('remind', remindText(value.remind) ?? 'Remind me', 'bell', value.remind !== null));
    if (f === 'who' && partner) chips.push(chip('who', whoText(hub, value.assignee), 'user', !!value.assignee));
    if (f === 'vis' && allowedVis.length > 1) chips.push(chip('vis', VIS[value.visibility].label, VIS[value.visibility].icon, value.visibility !== allowedVis[0]));
    if (f === 'urgent')
      chips.push(
        <button
          key="urgent"
          type="button"
          className={`echip ${value.urgent ? 'is-urgent' : ''}`}
          onClick={() => onChange({ urgent: !value.urgent })}
          aria-pressed={value.urgent}
          disabled={readOnly}
        >
          <span className="echip__diamond" aria-hidden="true" />
          <span>Urgent</span>
        </button>,
      );
  }

  return (
    <div className="inline">
      {prompt ? <p className="inline__prompt">{prompt}</p> : null}
      <div className="inline__chips">{chips}</div>
      {open === 'when' ? <WhenPanel due={value.due} time={value.dueTime} onChange={(due, dueTime) => onChange({ due, dueTime })} /> : null}
      {open === 'repeat' ? (
        <RepeatPanel
          rule={value.repeat}
          defaultFrom={repeatFrom}
          onChange={(repeat) => onChange({ repeat, due: repeat && !value.due ? ref : value.due })}
        />
      ) : null}
      {open === 'remind' ? (
        <Panel>
          <Options
            value={value.remind === null ? 'none' : String(value.remind)}
            options={[{ value: 'none', label: 'No reminder' }, ...REMIND_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))]}
            onPick={(v) => {
              onChange({ remind: v === 'none' ? null : Number(v), due: v !== 'none' && !value.due ? ref : value.due });
              setOpen(null);
            }}
          />
          <p className="panel__hint">{value.dueTime ? 'Counted from the time it’s due.' : 'Without a time, it comes at 9:00 on the day.'}</p>
        </Panel>
      ) : null}
      {open === 'who' ? (
        <Panel>
          <WhoOptions
            value={value.assignee}
            repeating={!!value.repeat}
            onPick={(a) => {
              onChange({ assignee: a });
              setOpen(null);
            }}
          />
        </Panel>
      ) : null}
      {open === 'vis' ? (
        <Panel>
          <Options
            value={value.visibility}
            options={allowedVis.map((v) => ({ value: v, label: VIS[v].label, icon: VIS[v].icon }))}
            onPick={(v) => onChange({ visibility: v as ItemVisibility })}
          />
          <p className="panel__hint">{visHint(value.visibility, partner?.name ?? 'your partner')}</p>
        </Panel>
      ) : null}
    </div>
  );
}

export const visHint = (v: ItemVisibility, partner: string) =>
  v === 'ours'
    ? 'You both see it and can change it.'
    : v === 'mine'
      ? `${partner} can see it. Only you change it.`
      : `${partner} can’t see it at all. It’s encrypted with your personal key.`;

export function Panel({ children }: { children: ReactNode }) {
  return <div className="panel">{children}</div>;
}

export function Options<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T | null;
  options: Array<{ value: T; label: ReactNode; icon?: IconName }>;
  onPick: (v: T) => void;
}) {
  return (
    <div className="options" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={`option ${o.value === value ? 'is-on' : ''}`} onClick={() => onPick(o.value)}>
          {o.icon ? <Icon name={o.icon} className="icon--sm" /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function WhoOptions({ value, onPick, repeating }: { value: Assignee; onPick: (a: Assignee) => void; repeating: boolean }) {
  const hub = useHub();
  const me = hub.me();
  const partner = hub.partner();
  const key = value ?? 'either';
  return (
    <Options
      value={key}
      onPick={(k) => onPick(k === 'either' ? null : (k as Assignee))}
      options={[
        { value: 'either', label: 'Either of us' },
        ...(me ? [{ value: me.id, label: <><Avatar member={me} size="xs" /> Me</> }] : []),
        ...(partner ? [{ value: partner.id, label: <><Avatar member={partner} size="xs" /> {partner.name}</> }] : []),
        { value: 'both', label: 'Together' },
        ...(repeating && partner ? [{ value: 'turns', label: 'Take turns' }] : []),
      ]}
    />
  );
}

export function WhenPanel({ due, time, onChange }: { due: string | null; time: string | null; onChange: (due: string | null, time: string | null) => void }) {
  const prefs = usePrefs();
  const ref = todayStr();
  const ws = weekStart(prefs);
  const weekendDay = ws === 0 ? 5 : 6;
  let weekend = addDays(ref, 1);
  while (weekday(weekend) !== weekendDay) weekend = addDays(weekend, 1);
  let nextWeek = addDays(ref, 1);
  while (weekday(nextWeek) !== ws) nextWeek = addDays(nextWeek, 1);
  const quick: Array<[string, string]> = [
    ['Today', ref],
    ['Tomorrow', addDays(ref, 1)],
    [ws === 0 ? 'Friday' : 'Weekend', weekend],
    ['Next week', nextWeek],
  ];
  return (
    <Panel>
      <Options value={due} options={quick.map(([label, v]) => ({ value: v, label }))} onPick={(v) => onChange(v, time)} />
      <div className="panel__row">
        <label className="option option--input">
          <Icon name="calendar" className="icon--sm" />
          <input type="date" value={due ?? ''} onChange={(e) => onChange(e.target.value || null, e.target.value ? time : null)} aria-label="Pick a date" />
        </label>
        <label className="option option--input">
          <Icon name="clock" className="icon--sm" />
          <input type="time" value={time ?? ''} onChange={(e) => onChange(due ?? ref, e.target.value || null)} aria-label="Time" />
        </label>
        {due ? (
          <button type="button" className="panel__clear" onClick={() => onChange(null, null)}>
            No date
          </button>
        ) : null}
      </div>
    </Panel>
  );
}

const SIMPLE: Array<{ key: string; label: string; every: number; unit: RepeatUnit }> = [
  { key: 'd1', label: 'Every day', every: 1, unit: 'day' },
  { key: 'w1', label: 'Every week', every: 1, unit: 'week' },
  { key: 'm1', label: 'Every month', every: 1, unit: 'month' },
];

export function RepeatPanel({ rule, onChange, defaultFrom }: { rule: RepeatRule | null; onChange: (r: RepeatRule | null) => void; defaultFrom: 'done' | 'schedule' }) {
  const prefs = usePrefs();
  const ws = weekStart(prefs);
  const from = rule?.type === 'interval' ? rule.from : defaultFrom;
  const simpleKey = rule?.type === 'interval' ? SIMPLE.find((s) => s.every === rule.every && s.unit === rule.unit)?.key : undefined;
  const [mode, setMode] = useState<'simple' | 'custom' | 'days'>(rule?.type === 'weekdays' ? 'days' : rule && !simpleKey ? 'custom' : 'simple');
  const key = !rule ? 'never' : mode === 'days' ? 'days' : mode === 'custom' ? 'custom' : (simpleKey ?? 'custom');
  const every = rule?.type === 'interval' ? rule.every : 3;
  const unit = rule?.type === 'interval' ? rule.unit : 'day';
  const days = rule?.type === 'weekdays' ? rule.days : [weekday(todayStr())];
  const order = [...Array(7).keys()].map((i) => (i + ws) % 7);

  return (
    <Panel>
      <Options
        value={key}
        options={[
          { value: 'never', label: 'Never' },
          ...SIMPLE.map((s) => ({ value: s.key, label: s.label })),
          { value: 'days', label: 'On set days' },
          { value: 'custom', label: 'Custom' },
        ]}
        onPick={(k) => {
          if (k === 'never') {
            setMode('simple');
            onChange(null);
          } else if (k === 'days') {
            setMode('days');
            onChange({ type: 'weekdays', days });
          } else if (k === 'custom') {
            setMode('custom');
            onChange({ type: 'interval', every, unit, from });
          } else {
            const s = SIMPLE.find((x) => x.key === k)!;
            setMode('simple');
            onChange({ type: 'interval', every: s.every, unit: s.unit, from });
          }
        }}
      />
      {mode === 'custom' && rule?.type === 'interval' ? (
        <div className="panel__row">
          <span className="stepper">
            <button type="button" onClick={() => onChange({ ...rule, every: Math.max(1, rule.every - 1) })} aria-label="Fewer">
              −
            </button>
            <span className="num">Every {rule.every}</span>
            <button type="button" onClick={() => onChange({ ...rule, every: Math.min(365, rule.every + 1) })} aria-label="More">
              +
            </button>
          </span>
          <Options
            value={rule.unit}
            options={(['day', 'week', 'month'] as const).map((u) => ({ value: u, label: rule.every === 1 ? u : `${u}s` }))}
            onPick={(u) => onChange({ ...rule, unit: u as RepeatUnit })}
          />
        </div>
      ) : null}
      {mode === 'days' && rule?.type === 'weekdays' ? (
        <div className="weekdays">
          {order.map((d) => {
            const on = rule.days.includes(d);
            return (
              <button
                key={d}
                type="button"
                className={`weekday ${on ? 'is-on' : ''}`}
                aria-pressed={on}
                aria-label={weekdayName(d)}
                onClick={() => {
                  const next = on ? rule.days.filter((x) => x !== d) : [...rule.days, d];
                  if (next.length) onChange({ type: 'weekdays', days: next.sort() });
                }}
              >
                {weekdayName(d).slice(0, 2)}
              </button>
            );
          })}
        </div>
      ) : null}
      {rule?.type === 'interval' ? (
        <label className="panel__toggle">
          <input type="checkbox" checked={rule.from === 'done'} onChange={(e) => onChange({ ...rule, from: e.target.checked ? 'done' : 'schedule' })} />
          <span>
            Count from when it’s done
            <small>{rule.from === 'done' ? 'Done early or late, the clock restarts that day.' : 'Stays on the calendar. Missed ones never pile up.'}</small>
          </span>
        </label>
      ) : rule?.type === 'weekdays' ? (
        <p className="panel__hint">Doing it early counts for the next one. Missed ones collapse into one.</p>
      ) : null}
    </Panel>
  );
}

export { Chip };

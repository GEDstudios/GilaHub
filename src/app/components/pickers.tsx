import { useState, type ReactNode } from 'react';
import type { ItemVisibility } from '../../core/actions';
import { addDays, fromDateStr, humanDate, today as todayStr, weekday, weekdayName } from '../../core/dates';
import { LINE_COLORS, type Assignee, type LineColor, type List, type RepeatRule, type RepeatUnit } from '../../core/model';
import { categoryMeta, categoryOrder, type Flavor } from '../../smart/categorize';
import { describeRule } from '../../smart/recurrence';
import { useHub } from '../context';
import { usePrefs, weekStart } from '../prefs';
import { REMIND_OPTIONS } from '../reminders';
import { Icon, type IconName } from '../ui/Icon';
import { Sheet } from '../ui/overlays';
import { Bullet, ListBullet, PersonBullet, Seg } from '../ui/primitives';

export function OptRow({
  icon,
  lead,
  title,
  sub,
  value,
  onClick,
  on,
  disabled,
}: {
  icon?: IconName;
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  on?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="optrow" onClick={onClick} disabled={disabled} aria-pressed={on}>
      {lead ?? (icon ? <span className="optrow__icon"><Icon name={icon} className="icon--sm" /></span> : null)}
      <span className="optrow__text">
        <span dir="auto">{title}</span>
        {sub ? <span className="optrow__sub">{sub}</span> : null}
      </span>
      {value !== undefined ? <span className="optrow__value">{value}</span> : null}
      {on ? <Icon name="check" /> : null}
    </button>
  );
}

// ---------------------------------------------------------------- lists

export function ListPickerSheet({
  onClose,
  onPick,
  current,
  filter,
  title = 'Move to',
}: {
  onClose: () => void;
  onPick: (l: List) => void;
  current?: string;
  filter?: (l: List) => boolean;
  title?: string;
}) {
  const hub = useHub();
  const lists = hub.lists().filter((l) => (filter ? filter(l) : true));
  return (
    <Sheet onClose={onClose} title={title}>
      <div className="card">
        {lists.map((l) => (
          <OptRow
            key={l.id}
            lead={<ListBullet list={l} size="md" />}
            title={l.name}
            sub={l.visibility === 'private' ? 'Only me' : l.visibility === 'visible' ? `${hub.member(l.owner)?.name ?? ''}’s` : 'Ours'}
            on={l.id === current}
            onClick={() => {
              onPick(l);
              onClose();
            }}
          />
        ))}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- date

export function DateSheet({
  onClose,
  due,
  time,
  onSave,
}: {
  onClose: () => void;
  due: string | null | undefined;
  time: string | null | undefined;
  onSave: (due: string | null, time: string | null) => void;
}) {
  const prefs = usePrefs();
  const ref = todayStr();
  const [d, setD] = useState<string | null>(due ?? null);
  const [t, setT] = useState<string | null>(time ?? null);
  const ws = weekStart(prefs);
  const weekendDay = ws === 0 ? 5 : 6;
  let weekend = ref;
  while (weekday(weekend) !== weekendDay) weekend = addDays(weekend, 1);
  let nextWeek = addDays(ref, 1);
  while (weekday(nextWeek) !== ws) nextWeek = addDays(nextWeek, 1);
  const quick: Array<[string, string]> = [
    ['Today', ref],
    ['Tomorrow', addDays(ref, 1)],
    [ws === 0 ? 'Friday' : 'Weekend', weekend],
    ['Next week', nextWeek],
  ];
  const save = (nd: string | null, nt: string | null) => {
    onSave(nd, nd ? nt : null);
    onClose();
  };
  return (
    <Sheet onClose={onClose} title="When?">
      <div className="chips" style={{ marginBottom: 16 }}>
        {quick.map(([label, value]) => (
          <button key={label} type="button" className={`chip ${d === value ? 'chip--on' : ''}`} onClick={() => setD(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className="card">
        <label className="optrow">
          <span className="optrow__icon">
            <Icon name="calendar" className="icon--sm" />
          </span>
          <span className="optrow__text">Date</span>
          <input
            type="date"
            className="input"
            style={{ width: 'auto', height: 40, fontSize: 15 }}
            value={d ?? ''}
            onChange={(e) => setD(e.target.value || null)}
          />
        </label>
        <label className="optrow">
          <span className="optrow__icon">
            <Icon name="clock" className="icon--sm" />
          </span>
          <span className="optrow__text">
            Time <span className="optrow__sub">Optional</span>
          </span>
          <input type="time" className="input" style={{ width: 'auto', height: 40, fontSize: 15 }} value={t ?? ''} onChange={(e) => setT(e.target.value || null)} />
        </label>
      </div>
      <p className="hint" style={{ margin: '10px 2px 0' }}>
        {d ? `${humanDate(d, ref)}${d !== ref ? ` · ${fromDateStr(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` : ''}` : 'No date — it waits in its list.'}
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button type="button" className="btn btn--ghost" onClick={() => save(null, null)} disabled={!due}>
          No date
        </button>
        <button type="button" className="btn btn--me" style={{ flex: 1 }} onClick={() => save(d, t)}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- repeat

const PRESETS: Array<{ label: string; rule: RepeatRule }> = [
  { label: 'Every day', rule: { type: 'interval', every: 1, unit: 'day', from: 'done' } },
  { label: 'Every 2 days', rule: { type: 'interval', every: 2, unit: 'day', from: 'done' } },
  { label: 'Every 3 days', rule: { type: 'interval', every: 3, unit: 'day', from: 'done' } },
  { label: 'Every week', rule: { type: 'interval', every: 1, unit: 'week', from: 'done' } },
  { label: 'Every 2 weeks', rule: { type: 'interval', every: 2, unit: 'week', from: 'done' } },
  { label: 'Every month', rule: { type: 'interval', every: 1, unit: 'month', from: 'done' } },
];

export function RepeatSheet({
  onClose,
  rule,
  onSave,
  defaultFrom = 'done',
}: {
  onClose: () => void;
  rule: RepeatRule | null | undefined;
  onSave: (r: RepeatRule | null) => void;
  defaultFrom?: 'done' | 'schedule';
}) {
  const prefs = usePrefs();
  const ws = weekStart(prefs);
  const [kind, setKind] = useState<'interval' | 'weekdays'>(rule?.type ?? 'interval');
  const [every, setEvery] = useState(rule?.type === 'interval' ? rule.every : 1);
  const [unit, setUnit] = useState<RepeatUnit>(rule?.type === 'interval' ? rule.unit : 'week');
  const [from, setFrom] = useState<'done' | 'schedule'>(rule?.type === 'interval' ? rule.from : defaultFrom);
  const [days, setDays] = useState<number[]>(rule?.type === 'weekdays' ? rule.days : [weekday(todayStr())]);
  const order = [...Array(7).keys()].map((i) => (i + ws) % 7);

  const current: RepeatRule = kind === 'weekdays' ? { type: 'weekdays', days: [...days].sort() } : { type: 'interval', every, unit, from };

  return (
    <Sheet onClose={onClose} title="Repeat">
      <Seg
        label="Repeat type"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'interval', label: 'Every few days' },
          { value: 'weekdays', label: 'On set days' },
        ]}
      />
      {kind === 'interval' ? (
        <>
          <div className="chips" style={{ marginTop: 16 }}>
            {PRESETS.map((p) => {
              const r = p.rule as Extract<RepeatRule, { type: 'interval' }>;
              const on = every === r.every && unit === r.unit;
              return (
                <button key={p.label} type="button" className={`chip ${on ? 'chip--on' : ''}`} onClick={() => (setEvery(r.every), setUnit(r.unit))}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="optrow">
              <span className="optrow__text">Every</span>
              <button type="button" className="iconbtn" onClick={() => setEvery(Math.max(1, every - 1))} aria-label="Fewer">
                −
              </button>
              <span className="num" style={{ fontWeight: 720, minWidth: 24, textAlign: 'center' }}>
                {every}
              </span>
              <button type="button" className="iconbtn" onClick={() => setEvery(Math.min(365, every + 1))} aria-label="More">
                <Icon name="plus" className="icon--sm" />
              </button>
              <select className="input" style={{ width: 'auto', height: 40, fontSize: 15 }} value={unit} onChange={(e) => setUnit(e.target.value as RepeatUnit)}>
                <option value="day">{every === 1 ? 'day' : 'days'}</option>
                <option value="week">{every === 1 ? 'week' : 'weeks'}</option>
                <option value="month">{every === 1 ? 'month' : 'months'}</option>
                <option value="year">{every === 1 ? 'year' : 'years'}</option>
              </select>
            </div>
          </div>
          <div className="field">
            <span className="field__label">Count the next time from…</span>
            <Seg
              label="Anchor"
              value={from}
              onChange={setFrom}
              options={[
                { value: 'done', label: 'When it’s done' },
                { value: 'schedule', label: 'The calendar' },
              ]}
            />
            <p className="hint" style={{ margin: '8px 2px 0' }}>
              {from === 'done'
                ? 'Done early or late, the clock restarts that day. Best for cleaning.'
                : 'Stays on the calendar. Doing it early counts for the next one; missed ones never pile up.'}
            </p>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginTop: 16 }}>
            {order.map((d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={`chip ${on ? 'chip--on' : ''}`}
                  style={{ justifyContent: 'center', padding: 0 }}
                  onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])}
                  aria-pressed={on}
                >
                  {weekdayName(d).slice(0, 2)}
                </button>
              );
            })}
          </div>
          <p className="hint" style={{ margin: '10px 2px 0' }}>
            Doing it early counts for the next one. Missed ones collapse into one — never a pile-up.
          </p>
        </>
      )}
      <p style={{ margin: '18px 2px 0', fontWeight: 650 }}>{kind === 'weekdays' && !days.length ? 'Pick at least one day' : describeRule(current, (n) => weekdayName(n))}</p>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!rule}
          onClick={() => {
            onSave(null);
            onClose();
          }}
        >
          Don’t repeat
        </button>
        <button
          type="button"
          className="btn btn--me"
          style={{ flex: 1 }}
          disabled={kind === 'weekdays' && !days.length}
          onClick={() => {
            onSave(current);
            onClose();
          }}
        >
          Done
        </button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- who

export function WhoSheet({
  onClose,
  value,
  onSave,
  repeating,
}: {
  onClose: () => void;
  value: Assignee | undefined;
  onSave: (a: Assignee) => void;
  repeating?: boolean;
}) {
  const hub = useHub();
  const me = hub.me();
  const partner = hub.partner();
  const pick = (a: Assignee) => {
    onSave(a);
    onClose();
  };
  return (
    <Sheet onClose={onClose} title="Who’s doing it?">
      <div className="card">
        <OptRow icon="ours" title="Either of us" sub="Whoever gets to it first" on={!value} onClick={() => pick(null)} />
        {me ? <OptRow lead={<PersonBullet member={me} size="md" />} title={`Me (${me.name})`} on={value === me.id} onClick={() => pick(me.id)} /> : null}
        {partner ? <OptRow lead={<PersonBullet member={partner} size="md" />} title={partner.name} on={value === partner.id} onClick={() => pick(partner.id)} /> : null}
        <OptRow icon="hand" title="Together" sub="Something we do as a pair" on={value === 'both'} onClick={() => pick('both')} />
        {repeating && partner ? <OptRow icon="repeat" title="Take turns" sub="The turn passes when it’s done" on={value === 'turns'} onClick={() => pick('turns')} /> : null}
      </div>
    </Sheet>
  );
}

export function whoLabel(hub: ReturnType<typeof useHub>, a: Assignee | undefined, turn?: string | null): string {
  if (!a) return 'Either of us';
  if (a === 'both') return 'Together';
  if (a === 'turns') return `Taking turns${turn ? ` · ${hub.member(turn)?.name ?? ''}’s turn` : ''}`;
  return a === hub.meId ? 'Me' : (hub.member(a)?.name ?? 'Someone');
}

// ---------------------------------------------------------------- reminder

export function RemindSheet({ onClose, value, onSave }: { onClose: () => void; value: number | null | undefined; onSave: (v: number | null) => void }) {
  const pick = (v: number | null) => {
    onSave(v);
    onClose();
  };
  return (
    <Sheet onClose={onClose} title="Remind me">
      <div className="card">
        {REMIND_OPTIONS.map((o) => (
          <OptRow key={o.value} icon="bell" title={o.label} on={value === o.value} onClick={() => pick(o.value)} />
        ))}
        <OptRow icon="x" title="No reminder" on={value === null || value === undefined} onClick={() => pick(null)} />
      </div>
      <p className="hint" style={{ margin: '12px 2px 0' }}>
        Without a time, reminders come at 9:00 on the day.
      </p>
    </Sheet>
  );
}

export function remindLabel(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'None';
  return REMIND_OPTIONS.find((o) => o.value === v)?.label ?? `${v} min before`;
}

// ---------------------------------------------------------------- aisle

export function AisleSheet({ onClose, flavor, value, onPick }: { onClose: () => void; flavor: Flavor; value: string; onPick: (c: string) => void }) {
  return (
    <Sheet onClose={onClose} title="Which aisle?">
      <div className="card">
        {categoryOrder(flavor).map((c) => {
          const m = categoryMeta(flavor, c);
          return (
            <OptRow
              key={c}
              lead={<span className="optrow__icon" style={{ fontSize: 18 }}>{m.e}</span>}
              title={m.en}
              sub={m.he}
              on={c === value}
              onClick={() => {
                onPick(c);
                onClose();
              }}
            />
          );
        })}
      </div>
      <p className="hint" style={{ margin: '12px 2px 0' }}>
        We’ll remember this for next time — on both phones.
      </p>
    </Sheet>
  );
}

// ---------------------------------------------------------------- color

export function Swatches({
  value,
  onChange,
  label,
  taken,
}: {
  value: LineColor;
  onChange: (c: LineColor) => void;
  label: string;
  taken?: LineColor[];
}) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Color">
      {LINE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          className={`swatch ${c === value ? 'is-on' : ''}`}
          onClick={() => onChange(c)}
          disabled={taken?.includes(c) && c !== value}
        >
          <Bullet color={c} label={label} size="lg" />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- visibility

export function VisibilityControl({
  value,
  onChange,
  allowed,
  partnerName,
}: {
  value: ItemVisibility;
  onChange: (v: ItemVisibility) => void;
  allowed: ItemVisibility[];
  partnerName: string;
}) {
  const opts: Array<{ value: ItemVisibility; label: ReactNode; title: string }> = [
    {
      value: 'ours',
      label: (
        <>
          <Icon name="ours" className="icon--sm" /> Ours
        </>
      ),
      title: 'Both of us see and edit it',
    },
    {
      value: 'mine',
      label: (
        <>
          <Icon name="mine" className="icon--sm" /> Mine
        </>
      ),
      title: `${partnerName} can see it; only I change it`,
    },
    {
      value: 'private',
      label: (
        <>
          <Icon name="lock" className="icon--sm" /> Only me
        </>
      ),
      title: `${partnerName} can’t see it at all`,
    },
  ];
  return <Seg label="Who can see this" value={value} onChange={onChange} options={opts.filter((o) => allowed.includes(o.value))} />;
}

export const VIS_HINT = (v: ItemVisibility, partner: string) =>
  v === 'ours' ? 'We both see and change it.' : v === 'mine' ? `${partner} can see it. Only you change it.` : `Invisible to ${partner} — encrypted with your personal key.`;

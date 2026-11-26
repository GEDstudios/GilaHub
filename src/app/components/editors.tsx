import { useState, type ReactNode } from 'react';
import { addMonths, daysInMonth, fromDateStr, humanDate, humanTime, today as todayStr, weekday, weekdayName } from '../../core/dates';
import type { Assignee, RepeatRule, RepeatUnit } from '../../core/model';
import { describeRule, firstDue, ordinalDay } from '../../smart/recurrence';
import { useHub } from '../context';
import { use24h, usePrefs, weekStart } from '../prefs';
import { visHint, visLabel, VIS_ICON, type VisChoice } from '../privacy';
import { withNotification } from '../compose';
import { REMIND_OPTIONS } from '../reminders';
import { Icon, type IconName } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Avatar, Switch } from '../ui/primitives';
import { PairSheet } from './PairSheet';

/** Everything the inline editor can change about an item. */
export interface Draft {
  due: string | null;
  dueTime: string | null;
  repeat: RepeatRule | null;
  remind: number | null;
  /** Notify again until done (with a notification, on a thing that doesn't repeat). */
  nag?: RepeatRule | null;
  assignee: Assignee;
  urgent: boolean;
  visibility: VisChoice;
  /** For a request to the partner: I OK it before it counts as done. */
  needsOk?: boolean;
}

export type Field = 'when' | 'repeat' | 'remind' | 'who' | 'vis' | 'urgent';

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
    if (r) parts.push(`notify ${r.toLowerCase()}${d.nag && !d.repeat ? `, then ${ruleShort(d.nag).toLowerCase()} until done` : ''}`);
    if (!parts.length) return opts.listName ? `In ${opts.listName}` : 'No date';
    const s = parts.join(', ');
    return `${s[0].toUpperCase()}${s.slice(1)}.`;
  };
}

/**
 * One soft chip of the inline editor. `ghost` = a dashed invitation (e.g. while on my own).
 * `lead` replaces the icon (a project's bullet); `compact` is the add row's 34 px size.
 */
export function EChip({
  label,
  icon,
  lead,
  set,
  open,
  onToggle,
  disabled,
  ghost,
  compact,
}: {
  label: ReactNode;
  icon?: IconName;
  lead?: ReactNode;
  set: boolean;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  ghost?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={`echip ${set ? 'is-set' : ''} ${open ? 'is-open' : ''} ${ghost ? 'echip--ghost' : ''} ${compact ? 'echip--sm' : ''}`}
      onClick={onToggle}
      aria-expanded={open}
      disabled={disabled}
    >
      {lead ?? (icon ? <Icon name={icon} className="icon--sm" /> : null)}
      <span dir="auto">{label}</span>
    </button>
  );
}

/**
 * Who sees it: Ours, Mine, {P}'s or Only me, with one line on what that means.
 * Renders its chip and, when open, its panel (panels sort after the chip row; see .inline__chips).
 */
export function VisChip({
  value,
  allowed,
  onChange,
  open,
  onToggle,
  disabled,
  compact,
}: {
  value: VisChoice;
  allowed: VisChoice[];
  onChange: (v: VisChoice) => void;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const partner = hub.partner();
  if (allowed.length < 2) return null;
  const hint = visHint(value, partner?.name ?? null);
  return (
    <>
      <EChip
        label={visLabel(value, partner?.name)}
        icon={VIS_ICON[value]}
        set={value !== allowed[0]}
        open={open}
        onToggle={onToggle}
        disabled={disabled}
        compact={compact}
      />
      {open ? (
        <Panel>
          <Options value={value} options={allowed.map((v) => ({ value: v, label: visLabel(v, partner?.name), icon: VIS_ICON[v] }))} onPick={onChange} />
          {hint ? <p className="panel__hint">{hint}</p> : null}
          {!partner ? (
            <button type="button" className="textbtn panel__invite" onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)}>
              Invite your person
            </button>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}

/**
 * Who does it. Paired: Either of us / Me / Ask {P} / Together (/ Take turns), and after
 * asking, "Needs my OK when done". On my own: a ghost "Ask your person" that leads to pairing.
 */
export function WhoChip({
  value,
  turn,
  needsOk,
  repeating,
  mode,
  onChange,
  open,
  onToggle,
  disabled,
  compact,
}: {
  value: Assignee;
  turn?: string | null;
  needsOk: boolean;
  repeating: boolean;
  /** 'item': it already exists ("Asked Hila"); 'compose': it's being written ("Ask Hila"). */
  mode: 'item' | 'compose';
  onChange: (patch: { assignee?: Assignee; needsOk?: boolean }) => void;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const me = hub.me();
  const partner = hub.partner();

  if (!partner) {
    return (
      <>
        <EChip label="Ask your person" icon="user" set={false} open={open} onToggle={onToggle} disabled={disabled} ghost compact={compact} />
        {open ? (
          <Panel>
            <p className="panel__hint panel__hint--first">Hand things to your person, and ask for an OK when they’re done.</p>
            <button type="button" className="btn btn--sm panel__cta" onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)}>
              Bring them in
            </button>
          </Panel>
        ) : null}
      </>
    );
  }

  const asking = value === partner.id;
  const ask = repeating ? partner.name : mode === 'item' ? `Asked ${partner.name}` : `Ask ${partner.name}`;
  const label = !value
    ? 'Who'
    : asking
      ? `${ask}${needsOk && !repeating ? ' · needs OK' : ''}`
      : value === 'turns'
        ? `Turns · ${!turn || turn === hub.meId ? 'you' : partner.name} next`
        : whoText(hub, value);
  return (
    <>
      <EChip label={label} icon="user" set={!!value} open={open} onToggle={onToggle} disabled={disabled} compact={compact} />
      {open ? (
        <Panel>
          <Options
            value={value ?? 'either'}
            onPick={(k) => {
              const a = k === 'either' ? null : (k as Assignee);
              onChange({ assignee: a });
              if (a !== partner.id || repeating) onToggle();
            }}
            options={[
              { value: 'either', label: 'Either of us' },
              ...(me ? [{ value: me.id, label: <><Avatar member={me} size="xs" /> Me</> }] : []),
              { value: partner.id, label: <><Avatar member={partner} size="xs" /> {repeating ? partner.name : `Ask ${partner.name}`}</> },
              { value: 'both', label: 'Together' },
              ...(repeating ? [{ value: 'turns', label: 'Take turns' }] : []),
            ]}
          />
          {asking && !repeating ? (
            <>
              <div className="optrow optrow--panel">
                <span className="optrow__text">Needs my OK when done</span>
                <Switch on={needsOk} label="Needs my OK when done" onChange={(v) => onChange({ needsOk: v })} />
              </div>
              <p className="panel__hint">{partner.name} gets a notification.</p>
            </>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
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
  prompt = null,
  turn,
  extras = [],
  whoMode = 'item',
  compact,
  after,
  className,
}: {
  value: Draft;
  onChange: (patch: Partial<Draft>) => void;
  fields: Field[];
  allowedVis?: VisChoice[];
  repeatFrom?: 'done' | 'schedule';
  readOnly?: boolean;
  prompt?: string | null;
  /** For "turns": whose turn it is. */
  turn?: string | null;
  /** Extra chips that come first, each with its own panel (e.g. "Done…" on chores, List in the composer). */
  extras?: Array<{ key: string; label: ReactNode; icon?: IconName; lead?: ReactNode; set?: boolean; panel?: (close: () => void) => ReactNode; /** A plain on/off chip: no panel. */ toggle?: () => void }>;
  /** 'compose' while the thing is being written ("Ask Hila" rather than "Asked Hila"). */
  whoMode?: 'item' | 'compose';
  /** The add row's smaller chips. */
  compact?: boolean;
  /** After the chips, in the same row (an add row's parsed tokens). */
  after?: ReactNode;
  className?: string;
}) {
  const prefs = usePrefs();
  const h24 = use24h(prefs);
  const [open, setOpen] = useState<string | null>(null);
  const ref = todayStr();
  const toggle = (f: string) => setOpen(open === f ? null : f);
  const chip = (f: string, label: ReactNode, icon: IconName | undefined, set: boolean, lead?: ReactNode, onToggle = () => toggle(f)) => (
    <EChip key={f} label={label} icon={icon} lead={lead} set={set} open={open === f} onToggle={onToggle} disabled={readOnly} compact={compact} />
  );

  const chips: ReactNode[] = [];
  for (const x of extras) {
    chips.push(chip(x.key, x.label, x.icon, x.set ?? true, x.lead, x.toggle));
    if (open === x.key && x.panel) chips.push(<Panel key={`${x.key}:panel`}>{x.panel(() => setOpen(null))}</Panel>);
  }
  for (const f of fields) {
    // One "When" chip holds the day, the time, the repeat and the notification (when this editor
    // has a date at all; new chores, with no date chip, keep Repeat and Notification as chips).
    const inWhen = fields.includes('when');
    const repeatInside = inWhen && fields.includes('repeat');
    const remindInside = inWhen && fields.includes('remind');
    if (f === 'when') {
      const text = value.due ? `${humanDate(value.due, ref)}${value.dueTime ? `, ${humanTime(value.dueTime, h24)}` : ''}` : repeatInside && value.repeat ? ruleShort(value.repeat) : 'Date';
      const marks = (
        <>
          {text}
          {repeatInside && value.repeat && value.due ? <Icon name="repeat" className="echip__mark" title={ruleShort(value.repeat)} /> : null}
          {remindInside && value.remind != null ? <Icon name="bell" className="echip__mark" title={`Notify ${(remindText(value.remind) ?? '').toLowerCase()}`} /> : null}
        </>
      );
      chips.push(chip('when', marks, 'calendar', !!value.due || (repeatInside && !!value.repeat)));
      if (open === 'when')
        chips.push(<WhenCard key="when:panel" value={value} onChange={onChange} repeat={repeatInside} remind={remindInside} repeatFrom={repeatFrom} />);
    }
    if (f === 'repeat' && !repeatInside) {
      chips.push(chip('repeat', value.repeat ? ruleShort(value.repeat) : 'Repeat', 'repeat', !!value.repeat));
      if (open === 'repeat')
        chips.push(
          <RepeatPanel
            key="repeat:panel"
            rule={value.repeat}
            defaultFrom={repeatFrom}
            // Calendar repeats (set days, days of the month) decide the date; "every N" keeps yours.
            onChange={(repeat) => {
              const due = repeat && (repeat.type !== 'interval' || !value.due) ? firstDue(repeat, ref) : value.due;
              onChange({ repeat, due, ...(due !== value.due ? withNotification(value, due) : {}) });
            }}
          />,
        );
    }
    if (f === 'remind' && !remindInside) {
      const off = value.remind == null;
      // Tapping the chip while it's off turns it on ("When due", today if undated) and shows the options.
      const turnOn = () => {
        onChange({ remind: 0, due: value.due ?? ref });
        setOpen('remind');
      };
      chips.push(chip('remind', off ? 'Notification' : `Notify ${(remindText(value.remind) ?? '').toLowerCase()}`, 'bell', !off, undefined, off ? turnOn : undefined));
      if (open === 'remind')
        chips.push(
          <Panel key="remind:panel">
            <Options
              value={value.remind == null ? 'none' : String(value.remind)}
              options={[{ value: 'none', label: 'No notification' }, ...REMIND_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))]}
              onPick={(v) => {
                onChange({ remind: v === 'none' ? null : Number(v), due: v !== 'none' && !value.due ? ref : value.due, ...(v === 'none' ? { nag: null } : {}) });
                setOpen(null);
              }}
            />
          </Panel>,
        );
    }
    if (f === 'who')
      chips.push(
        <WhoChip
          key="who"
          value={value.assignee}
          turn={turn}
          needsOk={!!value.needsOk}
          repeating={!!value.repeat}
          mode={whoMode}
          onChange={onChange}
          open={open === 'who'}
          onToggle={() => toggle('who')}
          disabled={readOnly}
          compact={compact}
        />,
      );
    if (f === 'vis')
      chips.push(
        <VisChip
          key="vis"
          value={value.visibility}
          allowed={allowedVis}
          onChange={(visibility) => onChange({ visibility })}
          open={open === 'vis'}
          onToggle={() => toggle('vis')}
          disabled={readOnly}
          compact={compact}
        />,
      );
    if (f === 'urgent')
      chips.push(
        <button
          key="urgent"
          type="button"
          className={`echip ${value.urgent ? 'is-urgent' : ''} ${compact ? 'echip--sm' : ''}`}
          onClick={() => onChange({ urgent: !value.urgent })}
          aria-pressed={value.urgent}
          disabled={readOnly}
        >
          <Icon name="urgent" className="icon--sm" />
          <span>Urgent</span>
        </button>,
      );
  }

  return (
    <div className={`inline ${className ?? ''}`}>
      {prompt ? <p className="inline__prompt">{prompt}</p> : null}
      <div className="inline__chips">
        {chips}
        {after}
      </div>
    </div>
  );
}

export function Panel({ children }: { children: ReactNode; title?: string }) {
  return <div className="panel">{children}</div>;
}

/** A part of a panel: a hairline, a small heading, then its choices. */
function PanelPart({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="panel__part">
      {title ? <p className="panel__head">{title}</p> : null}
      {children}
    </div>
  );
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

/**
 * When: one card for the day, the time, the repeat and the notification. Like a calendar app:
 * the month first (any day, one tap; today ringed, the day it's on filled), then a short list,
 * each line saying what it's set to: Time (the phone's own picker), Repeat, Notify (with its
 * switch) and, under Notify, Again until done. A line opens its choices under it, one at a time.
 */
export function WhenCard({
  value,
  onChange,
  repeat,
  remind,
  repeatFrom,
}: {
  value: Draft;
  onChange: (p: Partial<Draft>) => void;
  repeat: boolean;
  remind: boolean;
  repeatFrom: 'done' | 'schedule';
}) {
  const prefs = usePrefs();
  const h24 = use24h(prefs);
  const ref = todayStr();
  const [part, setPart] = useState<'repeat' | 'notify' | 'again' | null>(null);
  const flip = (p: 'repeat' | 'notify' | 'again') => setPart(part === p ? null : p);

  const setDay = (due: string | null) => onChange(due ? { due, ...withNotification(value, due) } : { due: null, dueTime: null, remind: null, nag: null });
  const setTime = (dueTime: string | null) => onChange(dueTime ? { dueTime, due: value.due ?? ref, ...withNotification(value, value.due ?? ref) } : { dueTime: null });
  const onRepeat = (r: RepeatRule | null) => {
    const due = r && (r.type !== 'interval' || !value.due) ? firstDue(r, ref) : value.due;
    onChange({ repeat: r, due, ...(r ? { nag: null } : {}), ...(due !== value.due ? withNotification(value, due) : {}) });
  };
  const notifyOn = value.remind != null;
  const setNotify = (on: boolean) => {
    onChange(on ? { remind: 0, due: value.due ?? ref } : { remind: null, nag: null });
    setPart(on ? 'notify' : null);
  };
  const again = remind && notifyOn && !value.repeat && value.nag !== undefined;

  return (
    <div className="panel whencard">
      <MonthPicker value={value.due} onPick={(d) => setDay(d === value.due ? null : d)} />

      <div className="whencard__rows">
        <div className={`whenrow ${value.dueTime ? 'is-set' : ''}`}>
          <div className="whenrow__line">
            <label className="whenrow__btn whenrow__btn--time">
              <Icon name="clock" className="icon--sm" lit={!!value.dueTime} />
              <span className="whenrow__title">Time</span>
              <span className="whenrow__value">{value.dueTime ? humanTime(value.dueTime, h24) : 'Any time'}</span>
              {/* The phone's own time picker, opened by the line itself */}
              <input type="time" className="whenrow__native" value={value.dueTime ?? ''} onChange={(e) => setTime(e.target.value || null)} aria-label="Time" />
            </label>
            {value.dueTime ? (
              <button type="button" className="whenrow__clear" aria-label="Any time" onClick={() => setTime(null)}>
                <Icon name="x" className="icon--xs" />
              </button>
            ) : null}
          </div>
        </div>
        {repeat ? (
          <WhenRow icon="repeat" title="Repeat" value={value.repeat ? ruleShort(value.repeat) : 'Never'} on={!!value.repeat} open={part === 'repeat'} onOpen={() => flip('repeat')}>
            <RepeatPanel bare rule={value.repeat} defaultFrom={repeatFrom} onChange={onRepeat} />
          </WhenRow>
        ) : null}
        {remind ? (
          <WhenRow
            icon="bell"
            title="Notify"
            value={notifyOn ? (remindText(value.remind) ?? '') : 'Off'}
            on={notifyOn}
            open={part === 'notify' && notifyOn}
            onOpen={() => (notifyOn ? flip('notify') : setNotify(true))}
            trail={<Switch on={notifyOn} label="Notify" onChange={setNotify} />}
          >
            <Options value={String(value.remind)} options={REMIND_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))} onPick={(v) => onChange({ remind: Number(v) })} />
          </WhenRow>
        ) : null}
        {again ? (
          <WhenRow icon="refresh" title="Again until done" value={value.nag ? ruleShort(value.nag) : 'Just once'} on={!!value.nag} open={part === 'again'} onOpen={() => flip('again')} sub>
            <RepeatPanel bare nag rule={value.nag ?? null} defaultFrom="schedule" onChange={(nag) => onChange({ nag })} />
          </WhenRow>
        ) : null}
      </div>

      {value.due ? (
        <div className="whencard__foot">
          <button type="button" className="whencard__clear" onClick={() => setDay(null)}>
            <Icon name="x" className="icon--sm" />
            Remove date
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A month, small: tap a day. Today is ringed, the picked day filled; past days are faint. */
function MonthPicker({ value, onPick }: { value: string | null; onPick: (d: string) => void }) {
  const prefs = usePrefs();
  const ws = weekStart(prefs);
  const ref = todayStr();
  const [month, setMonth] = useState(() => (value ?? ref).slice(0, 7));
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const lead = (weekday(first) - ws + 7) % 7;
  const count = daysInMonth(y, m - 1);
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const shift = (n: number) => setMonth(addMonths(first, n).slice(0, 7));
  const title = fromDateStr(first).toLocaleDateString(undefined, { month: 'long', year: y === Number(ref.slice(0, 4)) ? undefined : 'numeric' });
  return (
    <div className="month">
      <div className="month__head">
        <span className="month__title">{title}</span>
        {month !== ref.slice(0, 7) ? (
          <button type="button" className="textbtn month__today" onClick={() => setMonth(ref.slice(0, 7))}>
            Today
          </button>
        ) : null}
        <button type="button" className="iconbtn iconbtn--sm" aria-label="Earlier month" onClick={() => shift(-1)}>
          <Icon name="chevron-left" className="icon--sm" />
        </button>
        <button type="button" className="iconbtn iconbtn--sm" aria-label="Later month" onClick={() => shift(1)}>
          <Icon name="chevron-right" className="icon--sm" />
        </button>
      </div>
      <div className="month__grid" role="grid" aria-label={title}>
        {[...Array(7).keys()].map((i) => (
          <span key={`h${i}`} className="month__wd" aria-hidden="true">
            {weekdayName((i + ws) % 7).slice(0, 1)}
          </span>
        ))}
        {cells.map((d, i) =>
          d ? (
            <button
              key={d}
              type="button"
              role="gridcell"
              aria-selected={d === value}
              aria-label={humanDate(d, ref)}
              className={`month__day ${d === value ? 'is-on' : ''} ${d === ref ? 'is-today' : ''} ${d < ref ? 'is-past' : ''}`}
              onClick={() => onPick(d)}
            >
              {Number(d.slice(8))}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
    </div>
  );
}

/** One line of the When card: what it is, what it's set to; a tap opens its choices under it. */
function WhenRow({
  icon,
  title,
  value,
  on,
  open,
  onOpen,
  trail,
  sub,
  children,
}: {
  icon: IconName;
  title: string;
  value: string;
  on: boolean;
  open: boolean;
  onOpen: () => void;
  trail?: ReactNode;
  /** Belongs to the row above (Again until done, under Notify). */
  sub?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`whenrow ${open ? 'is-open' : ''} ${on ? 'is-set' : ''} ${sub ? 'whenrow--sub' : ''}`}>
      <div className="whenrow__line">
        <button type="button" className="whenrow__btn" aria-expanded={open} onClick={onOpen}>
          <Icon name={icon} className="icon--sm" lit={on} />
          <span className="whenrow__title">{title}</span>
          <span className="whenrow__value" dir="auto">
            {value}
          </span>
          {trail ? null : <Icon name="chevron-down" className="whenrow__chev icon--xs" />}
        </button>
        {trail}
      </div>
      {open ? <div className="whenrow__body">{children}</div> : null}
    </div>
  );
}

const SIMPLE: Array<{ key: string; label: string; every: number; unit: RepeatUnit }> = [
  { key: 'd1', label: 'Every day', every: 1, unit: 'day' },
  { key: 'w1', label: 'Every week', every: 1, unit: 'week' },
  { key: 'm1', label: 'Every month', every: 1, unit: 'month' },
];

export function RepeatPanel({
  rule,
  onChange: set,
  defaultFrom,
  nag,
  bare,
  title,
}: {
  rule: RepeatRule | null;
  onChange: (r: RepeatRule | null) => void;
  defaultFrom: 'done' | 'schedule';
  /** For "notify again until done": once is the other choice, and it always keeps to the calendar. */
  nag?: boolean;
  /** Inside another panel (the date's, the notification's): no card of its own, a small heading. */
  bare?: boolean;
  title?: string;
}) {
  const Wrap = bare ? PanelPart : Panel;
  const onChange = (r: RepeatRule | null) => set(nag && r?.type === 'interval' ? { ...r, from: 'schedule' } : r);
  const prefs = usePrefs();
  const ws = weekStart(prefs);
  const from = rule?.type === 'interval' ? rule.from : defaultFrom;
  const simpleKey = rule?.type === 'interval' ? SIMPLE.find((s) => s.every === rule.every && s.unit === rule.unit)?.key : undefined;
  const [mode, setMode] = useState<'simple' | 'custom' | 'days' | 'month'>(
    rule?.type === 'weekdays' ? 'days' : rule?.type === 'monthdays' ? 'month' : rule && !simpleKey ? 'custom' : 'simple',
  );
  const key = !rule ? 'never' : mode === 'days' ? 'days' : mode === 'month' ? 'month' : mode === 'custom' ? 'custom' : (simpleKey ?? 'custom');
  const every = rule?.type === 'interval' ? rule.every : 3;
  const unit = rule?.type === 'interval' ? rule.unit : 'day';
  const days = rule?.type === 'weekdays' ? rule.days : [weekday(todayStr())];
  const monthDays = rule?.type === 'monthdays' ? rule.days : [fromDateStr(todayStr()).getDate()];
  const order = [...Array(7).keys()].map((i) => (i + ws) % 7);

  return (
    <Wrap title={title}>
      <Options
        value={key}
        options={[
          { value: 'never', label: nag ? 'Just once' : 'Never' },
          ...SIMPLE.map((s) => ({ value: s.key, label: s.label })),
          { value: 'days', label: 'On set days' },
          { value: 'month', label: 'Days of the month' },
          { value: 'custom', label: 'Custom' },
        ]}
        onPick={(k) => {
          if (k === 'never') {
            setMode('simple');
            onChange(null);
          } else if (k === 'days') {
            setMode('days');
            onChange({ type: 'weekdays', days });
          } else if (k === 'month') {
            setMode('month');
            onChange({ type: 'monthdays', days: monthDays });
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
      {mode === 'month' && rule?.type === 'monthdays' ? (
        <div className="monthdays" role="group" aria-label="Days of the month">
          {[...Array(31).keys()].map((i) => i + 1).concat(-1).map((d) => {
            const on = rule.days.includes(d);
            return (
              <button
                key={d}
                type="button"
                className={`monthday ${on ? 'is-on' : ''} ${d === -1 ? 'monthday--last' : ''}`}
                aria-pressed={on}
                aria-label={d === -1 ? 'Last day of the month' : ordinalDay(d)}
                onClick={() => {
                  const next = on ? rule.days.filter((x) => x !== d) : [...rule.days, d];
                  if (next.length) onChange({ type: 'monthdays', days: next.sort((a, b) => a - b) });
                }}
              >
                {d === -1 ? 'Last' : d}
              </button>
            );
          })}
        </div>
      ) : null}
      {rule?.type === 'interval' && !nag ? (
        <div className="optrow optrow--panel">
          <span className="optrow__text">Count from when it’s done</span>
          <Switch on={rule.from === 'done'} label="Count from when it’s done" onChange={(v) => onChange({ ...rule, from: v ? 'done' : 'schedule' })} />
        </div>
      ) : null}
    </Wrap>
  );
}


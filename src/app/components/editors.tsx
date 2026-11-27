import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { addMonths, daysInMonth, fromDateStr, humanDate, humanTime, today as todayStr, weekday, weekdayName } from '../../core/dates';
import type { Assignee, RepeatRule, RepeatUnit } from '../../core/model';
import type { Draft, Field } from '../draft';
import { REMIND_OPTIONS, remindText, ruleShort, whenText, whoInSentence, whoText } from '../labels';
import { firstDue, ordinalDay } from '../../smart/recurrence';
import { useHub } from '../context';
import { sheetOpened } from '../router';
import { use24h, usePrefs, weekStart } from '../prefs';
import { visHint, visLabel, VIS_ICON, type VisChoice } from '../privacy';
import { withNotification } from '../compose';
import { Icon, type IconName } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Avatar, IconButton, lightVar, Stepper, Switch } from '../ui/primitives';
import { PairSheet } from './PairSheet';
import { G } from '../ui/glyphs';
import { SwitchRow } from './pickers';
import { useMouse } from '../ui/pointer';



/** One calm sentence that says what the item is set to, like Tasky's card subtitle. */
export function useSummary() {
  const hub = useHub();
  const prefs = usePrefs();
  const h24 = use24h(prefs);
  return (d: Partial<Draft>, opts: { listName?: string } = {}): string => {
    const ref = todayStr();
    const parts: string[] = [];
    if (d.due) parts.push(whenText(d.due, d.dueTime, ref, h24, 'sentence'));
    if (d.repeat) parts.push(ruleShort(d.repeat).toLowerCase().replace(/^every/, d.due ? 'then every' : 'every'));
    if (d.assignee) parts.push(whoInSentence(hub, d.assignee));
    const r = remindText(d.remind);
    if (r) parts.push(`notify ${r.toLowerCase()}${d.nag ? `, then ${ruleShort(d.nag).toLowerCase()} until done` : ''}`);
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
  ghost,
  compact,
  tone,
  style,
  name,
}: {
  /** Empty: just its glyph (then `name` says what it is). */
  label: ReactNode;
  /** What it is, for a chip with no words (and its tooltip). */
  name?: string;
  icon?: IconName;
  lead?: ReactNode;
  set: boolean;
  /** An extra class (a chip with a look of its own, like who sees it). */
  tone?: string;
  style?: CSSProperties;
  open: boolean;
  onToggle: () => void;
  ghost?: boolean;
  compact?: boolean;
}) {
  // Open, a tap anywhere outside the chip and its panel closes it (not inside another chip, which
  // opens itself, nor in a sheet opened over this one).
  const ref = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const chip = ref.current;
      const t = e.target instanceof Element ? e.target : null;
      if (!chip || !t || chip.contains(t)) return;
      if (t.closest('.panel, .echip, .livecursor, .toasts')) return;
      const theirs = t.closest('.sheet');
      if (theirs && theirs !== chip.closest('.sheet')) return;
      toggleRef.current();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);
  return (
    <button
      ref={ref}
      type="button"
      className={`echip ${set ? 'is-set' : ''} ${open ? 'is-open' : ''} ${ghost ? 'echip--ghost' : ''} ${compact ? 'echip--sm' : ''} ${label === '' ? 'echip--icon' : ''} ${tone ?? ''}`}
      style={style}
      onClick={onToggle}
      aria-expanded={open}
      aria-label={name}
      title={name}
    >
      {lead ?? (icon ? <Icon name={icon} className="icon--sm" /> : null)}
      {label === '' ? null : <span dir="auto">{label}</span>}
    </button>
  );
}

/**
 * Who sees it: Ours, Mine, {P}'s or Only me, with one line on what that means.
 * Renders its chip and, when open, its panel (panels sort after the chip row; see .inline__chips).
 */
function VisChip({
  value,
  allowed,
  onChange,
  open,
  onToggle,
  compact,
}: {
  value: VisChoice;
  allowed: VisChoice[];
  onChange: (v: VisChoice) => void;
  open: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const partner = hub.partner();
  if (allowed.length < 2) return null;
  const hint = visHint(value, partner?.name ?? null);
  const me = hub.me();
  // Loud on purpose, coloured by who will see it: both of us (our two colours), me (mine), my
  // person (theirs), or nobody else (ink, locked).
  const who = value === 'ours' ? [me, partner] : value === 'mine' ? [me] : value === 'theirs' ? [partner] : [];
  const faces = who.filter((m): m is NonNullable<typeof m> => !!m);
  return (
    <>
      <EChip
        label={visLabel(value, partner?.name)}
        tone={`echip--vis echip--vis-${value}`}
        style={{ '--me': lightVar(me?.color ?? 'lemon'), '--them': lightVar(partner?.color ?? 'sky') } as CSSProperties}
        lead={
          faces.length ? (
            <span className="echip__faces">
              {faces.map((m) => (
                <Avatar key={m.id} member={m} size="xs" />
              ))}
            </span>
          ) : (
            <Icon name={VIS_ICON[value]} className="icon--sm" />
          )
        }
        set={value !== allowed[0]}
        open={open}
        onToggle={onToggle}
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
function WhoChip({
  value,
  turn,
  needsOk,
  repeating,
  mode,
  onChange,
  open,
  onToggle,
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
  compact?: boolean;
}) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const me = hub.me();
  const partner = hub.partner();

  if (!partner) {
    return (
      <>
        <EChip label="Ask your person" icon={G.person} set={false} open={open} onToggle={onToggle} ghost compact={compact} />
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
      <EChip label={label} icon={G.person} set={!!value} open={open} onToggle={onToggle} compact={compact} />
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
              <SwitchRow panel title="Needs my OK when done" on={needsOk} onChange={(v) => onChange({ needsOk: v })} />
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
  turn,
  extras = [],
  whoMode = 'item',
  compact,
  after,
  className,
  more,
  later = [],
}: {
  /** The fields lead; the extras wait behind an expand arrow (those already set stay in sight). */
  more?: boolean;
  /** Fields that wait behind it too, while they're unset (Who). */
  later?: Field[];
  value: Draft;
  onChange: (patch: Partial<Draft>) => void;
  fields: Field[];
  allowedVis?: VisChoice[];
  repeatFrom?: 'done' | 'schedule';
  /** For "turns": whose turn it is. */
  turn?: string | null;
  /** Extra chips that come first, each with its own panel (e.g. "Done…" on chores, List in the composer). */
  extras?: Array<{ key: string; label: ReactNode; name?: string; icon?: IconName; lead?: ReactNode; set?: boolean; panel?: (close: () => void) => ReactNode; /** A plain on/off chip: no panel. */ toggle?: () => void }>;
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
  // An open panel is a step back: the phone's Back closes just the panel (what was picked in it
  // stays), not the screen or sheet under it.
  useEffect(() => {
    if (!open) return;
    const step = sheetOpened(() => setOpen(null));
    return () => step.closed();
  }, [open]);
  const chip = (f: string, label: ReactNode, icon: IconName | undefined, set: boolean, lead?: ReactNode, onToggle = () => toggle(f), name?: string) => (
    <EChip key={f} label={label} name={name} icon={icon} lead={lead} set={set} open={open === f} onToggle={onToggle} compact={compact} />
  );

  const [moreOpen, setMoreOpen] = useState(false);
  const extraChips: ReactNode[] = [];
  const hiddenChips: ReactNode[] = [];
  for (const x of extras) {
    const into = more && !(x.set ?? true) && open !== x.key ? hiddenChips : extraChips;
    into.push(chip(x.key, x.label, x.icon, x.set ?? true, x.lead, x.toggle, x.name));
    if (open === x.key && x.panel) into.push(<Panel key={`${x.key}:panel`}>{x.panel(() => setOpen(null))}</Panel>);
  }
  const chips: ReactNode[] = more ? [] : extraChips;
  const fieldSet = (f: Field) => (f === 'who' ? value.assignee != null : f === 'urgent' ? value.urgent : f === 'when' ? !!value.due : true);
  for (const f of fields) {
    const from = chips.length;
    const waits = !!more && later.includes(f) && !fieldSet(f) && open !== f;
    // One "When" chip holds the day, the time, the repeat and the notification (when this editor
    // has a date at all; new chores, with no date chip, keep Repeat and Notification as chips).
    const inWhen = fields.includes('when');
    const repeatInside = inWhen && fields.includes('repeat');
    const remindInside = inWhen && fields.includes('remind');
    if (f === 'when') {
      const text = value.due ? whenText(value.due, value.dueTime, ref, h24) : repeatInside && value.repeat ? ruleShort(value.repeat) : 'Date';
      const marks = (
        <>
          {text}
          {repeatInside && value.repeat && value.due ? <Icon name={G.repeat} className="echip__mark" title={ruleShort(value.repeat)} /> : null}
          {remindInside && value.remind != null ? <Icon name={G.remind} className="echip__mark" title={`Notify ${(remindText(value.remind) ?? '').toLowerCase()}`} /> : null}
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
        >
          <Icon name={G.urgent} className="icon--sm" />
          <span>Urgent</span>
        </button>,
      );
    if (waits) hiddenChips.unshift(...chips.splice(from));
  }

  if (more) {
    chips.push(...extraChips);
    if (hiddenChips.length) {
      chips.push(
        <button key="more" type="button" className={`echip--expand ${moreOpen ? 'is-open' : ''}`} aria-expanded={moreOpen} aria-label={moreOpen ? 'Fewer' : 'More'} title={moreOpen ? 'Fewer' : 'More'} onClick={() => setMoreOpen(!moreOpen)}>
          <Icon name={G.fold} />
        </button>,
      );
      if (moreOpen) chips.push(...hiddenChips);
    }
  }

  return (
    <div className={`inline ${className ?? ''}`}>
      <div className="inline__chips">
        {chips}
        {after}
      </div>
    </div>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return <div className="panel">{children}</div>;
}

/** A part of a panel (a row's choices, under a hairline). */
function PanelPart({ children }: { children: ReactNode }) {
  return <div className="panel__part">{children}</div>;
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
function WhenCard({
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
  const [part, setPart] = useState<'time' | 'repeat' | 'notify' | 'again' | null>(null);
  const flip = (p: 'time' | 'repeat' | 'notify' | 'again') => setPart(part === p ? null : p);
  const mouse = useMouse();
  // Typing the time in its row (a computer): what it was, to put back on Esc.
  const [timeEdit, setTimeEdit] = useState<{ was: string | null } | null>(null);

  const setDay = (due: string | null) => onChange(due ? { due, ...withNotification(value, due) } : { due: null, dueTime: null, remind: null, nag: null });
  const setTime = (dueTime: string | null) => onChange(dueTime ? { dueTime, due: value.due ?? ref, ...withNotification(value, value.due ?? ref) } : { dueTime: null });
  const onRepeat = (r: RepeatRule | null) => {
    const due = r && (r.type !== 'interval' || !value.due) ? firstDue(r, ref) : value.due;
    onChange({ repeat: r, due, ...(due !== value.due ? withNotification(value, due) : {}) });
  };
  const notifyOn = value.remind != null;
  const setNotify = (on: boolean) => {
    onChange(on ? { remind: 0, due: value.due ?? ref } : { remind: null, nag: null });
    setPart(on ? 'notify' : null);
  };
  // Again until done: on a repeating task too (each time, until that time is done).
  const again = remind && notifyOn && value.nag !== undefined;

  return (
    <div className="panel whencard">
      {/* Taking the date off: first thing, above the month */}
      {value.due ? (
        <div className="whencard__head">
          <button type="button" className="whencard__clear" onClick={() => setDay(null)}>
            <Icon name={G.close} className="icon--sm" />
            Remove date
          </button>
        </div>
      ) : null}
      <MonthPicker value={value.due} onPick={(d) => setDay(d === value.due ? null : d)} />

      <div className="whencard__rows">
        {/* The time. A phone: its own picker. A computer: a part of the day in one tap, or − / + by a quarter hour. */}
        {!mouse ? (
          <div className={`whenrow ${value.dueTime ? 'is-set' : ''}`}>
            <div className="whenrow__line">
              <label className="whenrow__btn whenrow__btn--time">
                <Icon name={G.time} className="icon--sm" lit={!!value.dueTime} />
                <span className="whenrow__title">Time</span>
                <span className="whenrow__value">{value.dueTime ? humanTime(value.dueTime, h24) : 'Any time'}</span>
                <input type="time" className="whenrow__native" value={value.dueTime ?? ''} onChange={(e) => setTime(e.target.value || null)} aria-label="Time" />
              </label>
              {value.dueTime ? (
                <button type="button" className="whenrow__clear" aria-label="Any time" onClick={() => setTime(null)}>
                  <Icon name={G.close} className="icon--xs" />
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          // A computer: the time is typed right in its row (hour : minute), like any other field.
          <div className={`whenrow ${value.dueTime ? 'is-set' : ''}`}>
            <div className="whenrow__line">
              <span className="whenrow__btn whenrow__btn--static">
                <Icon name={G.time} className="icon--sm" lit={!!value.dueTime} />
                <span className="whenrow__title">Time</span>
              </span>
              {timeEdit ? (
                <TimePicker
                  autoFocus
                  value={value.dueTime}
                  h24={h24}
                  onChange={setTime}
                  onDone={() => setTimeEdit(null)}
                  onCancel={() => {
                    setTime(timeEdit.was);
                    setTimeEdit(null);
                  }}
                />
              ) : (
                <button type="button" className="whenrow__valuebtn" onClick={() => setTimeEdit({ was: value.dueTime ?? null })}>
                  {value.dueTime ? humanTime(value.dueTime, h24) : 'Any time'}
                </button>
              )}
              {value.dueTime && !timeEdit ? (
                <button type="button" className="whenrow__clear" aria-label="Any time" onClick={() => setTime(null)}>
                  <Icon name={G.close} className="icon--xs" />
                </button>
              ) : null}
            </div>
          </div>
        )}
        {repeat ? (
          <WhenRow icon={G.repeat} title="Repeat" value={value.repeat ? ruleShort(value.repeat) : 'Never'} on={!!value.repeat} open={part === 'repeat'} onOpen={() => flip('repeat')}>
            <RepeatPanel bare rule={value.repeat} defaultFrom={repeatFrom} onChange={onRepeat} />
          </WhenRow>
        ) : null}
        {remind ? (
          <WhenRow
            icon={G.remind}
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
          <WhenRow icon={G.nag} title="Again until done" value={value.nag ? ruleShort(value.nag) : 'Just once'} on={!!value.nag} open={part === 'again'} onOpen={() => flip('again')} sub>
            <RepeatPanel bare nag rule={value.nag ?? null} defaultFrom="schedule" onChange={(nag) => onChange({ nag })} />
          </WhenRow>
        ) : null}
      </div>

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
        <IconButton small icon={G.prev} label="Earlier month" onClick={() => shift(-1)} />
        <IconButton small icon={G.next} label="Later month" onClick={() => shift(1)} />
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
          {trail ? null : <Icon name={G.fold} className="whenrow__chev icon--xs" />}
        </button>
        {trail}
      </div>
      {open ? <div className="whenrow__body">{children}</div> : null}
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The time on a computer, typed: an hour box and a minute box (type, or ↑ ↓), AM / PM on a
 * 12-hour clock. Two digits in the hour move on to the minutes. It's kept as soon as it reads as
 * a time; Enter (or leaving it) is done, Esc puts back what it was.
 */
function TimePicker({
  value,
  h24,
  onChange,
  onDone,
  onCancel,
  autoFocus,
}: {
  value: string | null;
  h24: boolean;
  onChange: (t: string) => void;
  onDone?: () => void;
  /** Esc: put back what it was. */
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const start = value ?? nextHour();
  const [H, M] = start.split(':').map(Number);
  const [pm, setPm] = useState(H >= 12);
  const [hh, setHh] = useState(h24 ? pad2(H) : String(H % 12 === 0 ? 12 : H % 12));
  const [mm, setMm] = useState(pad2(M));
  const hourBox = useRef<HTMLInputElement>(null);
  const minBox = useRef<HTMLInputElement>(null);
  // The first digit typed into a box starts it afresh; the next ones add to it.
  const fresh = useRef({ h: true, m: true });
  const typeHour = (d: string) => {
    const v = fresh.current.h ? d : (hh + d).slice(-2);
    fresh.current.h = false;
    setHh(v);
    keep(v);
    // Two digits (or one that can't start a longer hour): on to the minutes.
    if (v.length === 2 || Number(v) > (h24 ? 2 : 1)) minBox.current?.focus();
  };
  const typeMin = (d: string) => {
    const v = fresh.current.m ? d : (mm + d).slice(-2);
    fresh.current.m = false;
    setMm(v);
    keep(hh, v);
  };
  useEffect(() => {
    if (autoFocus) hourBox.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** What the boxes say, as "HH:MM" (null while they don't make a time). */
  const read = (h = hh, m = mm, p = pm): string | null => {
    const hn = Number(h);
    const mn = Number(m === '' ? '0' : m);
    if (h === '' || Number.isNaN(hn) || Number.isNaN(mn) || mn > 59) return null;
    if (h24) return hn > 23 ? null : `${pad2(hn)}:${pad2(mn)}`;
    if (hn < 1 || hn > 12) return null;
    return `${pad2((hn % 12) + (p ? 12 : 0))}:${pad2(mn)}`;
  };
  const keep = (h = hh, m = mm, p = pm) => {
    const t = read(h, m, p);
    if (t) onChange(t);
  };
  const step = (which: 'h' | 'm', by: number) => {
    if (which === 'h') {
      const max = h24 ? 24 : 12;
      const lo = h24 ? 0 : 1;
      let n = (Number(hh) || lo) + by;
      if (n > (h24 ? 23 : 12)) n = lo;
      if (n < lo) n = max - (h24 ? 1 : 0);
      const v = h24 ? pad2(n) : String(n);
      setHh(v);
      keep(v);
    } else {
      const n = (((Number(mm) || 0) + by * 5) % 60 + 60) % 60;
      const v = pad2(n - (n % 5));
      setMm(v);
      keep(hh, v);
    }
  };
  const keys = (which: 'h' | 'm') => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      if (which === 'h') typeHour(e.key);
      else typeMin(e.key);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      step(which, e.key === 'ArrowUp' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      keep();
      onDone?.();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (which === 'm' && e.key === 'Backspace' && mm === '') {
      hourBox.current?.focus();
    }
  };
  return (
    <div
      className="tentry tentry--compact"
      // Leaving it (a click elsewhere, Tab out): done.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDone?.();
      }}
    >
      <div className="tentry__row tentry__row--compact">
        <label className="tentry__cell">
          <input
            ref={hourBox}
            className="tentry__box num"
            inputMode="numeric"
            maxLength={2}
            value={hh}
            aria-label="Hour"
            onFocus={(e) => {
              fresh.current.h = true;
              e.target.select();
            }}
            onChange={(e) => {
              // Pasted, or typed some other way: digits only.
              const v = e.target.value.replace(/\D/g, '').slice(0, 2);
              setHh(v);
              keep(v);
            }}
            onKeyDown={keys('h')}
            onBlur={() => h24 && setHh((h) => (h.length === 1 ? pad2(Number(h)) : h))}
          />
        </label>
        <span className="tentry__colon">:</span>
        <label className="tentry__cell">
          <input
            ref={minBox}
            className="tentry__box num"
            inputMode="numeric"
            maxLength={2}
            value={mm}
            aria-label="Minute"
            onFocus={(e) => {
              fresh.current.m = true;
              e.target.select();
            }}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 2);
              setMm(v);
              keep(hh, v);
            }}
            onKeyDown={keys('m')}
            onBlur={() => setMm((m) => (m.length === 1 ? pad2(Number(m)) : m))}
          />
        </label>
        {h24 ? null : (
          <span className="tentry__ampm" role="radiogroup" aria-label="AM or PM">
            {(['AM', 'PM'] as const).map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={(x === 'PM') === pm}
                className={(x === 'PM') === pm ? 'is-on' : ''}
                onClick={() => {
                  setPm(x === 'PM');
                  keep(hh, mm, x === 'PM');
                }}
              >
                {x}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** Where the boxes start with no time yet: the next whole hour. */
const nextHour = () => `${pad2((new Date().getHours() + 1) % 24)}:00`;

/** A time on its own (Settings, a template): the phone's own picker, or typed on a computer. */
export function TimeField({ value, onChange, label = 'Time' }: { value: string | null; onChange: (t: string | null) => void; label?: string }) {
  const h24 = use24h(usePrefs());
  const mouse = useMouse();
  // A phone: its own time picker.
  if (!mouse) return <input type="time" className="timefield" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label={label} />;
  return <TimePicker value={value} h24={h24} onChange={onChange} />;
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
}: {
  rule: RepeatRule | null;
  onChange: (r: RepeatRule | null) => void;
  defaultFrom: 'done' | 'schedule';
  /** For "notify again until done": once is the other choice, and it always keeps to the calendar. */
  nag?: boolean;
  /** Inside another panel (the date's, the notification's): no card of its own. */
  bare?: boolean;
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
    <Wrap>
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
          <Stepper label="Every" value={rule.every} min={1} max={365} format={(v) => `Every ${v}`} onChange={(v) => onChange({ ...rule, every: v ?? 1 })} />
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
        <SwitchRow panel title="Count from when it’s done" on={rule.from === 'done'} onChange={(v) => onChange({ ...rule, from: v ? 'done' : 'schedule' })} />
      ) : null}
    </Wrap>
  );
}


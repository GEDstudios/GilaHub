import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { today as todayStr } from '../../core/dates';
import type { Assignee } from '../../core/model';
import type { Draft, Field } from '../draft';
import { REMIND_OPTIONS, remindText, ruleShort, whenText, whoInSentence, whoText } from '../labels';
import { firstDue } from '../../smart/recurrence';
import { useHub } from '../context';
import { sheetOpened } from '../router';
import { use24h } from '../prefs';
import { usePrefs } from '../usePrefs';
import { visHint, visLabel, VIS_ICON, type VisChoice } from '../privacy';
import { withNotification } from '../compose';
import { Icon, type IconName } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Avatar, lightVar, TextButton, Button } from '../ui/primitives';
import { PairSheet } from './PairSheet';
import { G } from '../ui/glyphs';
import { SwitchRow } from './pickers';
import { EChip, Options, Panel } from './chips';
import { WhenCard } from './WhenCard';
import { RepeatPanel } from './RepeatPanel';

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
            <TextButton onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)} className="panel__invite">
              Invite your person
            </TextButton>
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
            <Button small onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)} className="panel__cta">
              Bring them in
            </Button>
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
      chips.push(chip('when', marks, G.date, !!value.due || (repeatInside && !!value.repeat)));
      if (open === 'when')
        chips.push(<WhenCard key="when:panel" value={value} onChange={onChange} repeat={repeatInside} remind={remindInside} repeatFrom={repeatFrom} />);
    }
    if (f === 'repeat' && !repeatInside) {
      chips.push(chip('repeat', value.repeat ? ruleShort(value.repeat) : 'Repeat', G.repeat, !!value.repeat));
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
      chips.push(chip('remind', off ? 'Notification' : `Notify ${(remindText(value.remind) ?? '').toLowerCase()}`, G.remind, !off, undefined, off ? turnOn : undefined));
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
        <EChip key="urgent" label="Urgent" icon={G.urgent} set={false} pressed={value.urgent} tone={value.urgent ? 'is-urgent' : ''} onToggle={() => onChange({ urgent: !value.urgent })} compact={compact} />,
      );
    if (waits) hiddenChips.unshift(...chips.splice(from));
  }

  if (more) {
    chips.push(...extraChips);
    if (hiddenChips.length) {
      chips.push(
        <button key="more" type="button" className="echip--expand" aria-expanded={moreOpen} aria-label={moreOpen ? 'Fewer' : 'More'} title={moreOpen ? 'Fewer' : 'More'} onClick={() => setMoreOpen(!moreOpen)}>
          <Icon name={G.fold} className="chev" />
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

import { useState, type ReactNode } from 'react';
import { addMonths, daysInMonth, fromDateStr, humanDate, humanTime, today as todayStr, weekday, weekdayName } from '../../core/dates';
import type { RepeatRule } from '../../core/model';
import type { Draft } from '../draft';
import { REMIND_OPTIONS, remindText, ruleShort } from '../labels';
import { firstDue } from '../../smart/recurrence';
import { use24h, weekStart } from '../prefs';
import { usePrefs } from '../usePrefs';
import { withNotification } from '../compose';
import { Icon, type IconName } from '../ui/Icon';
import { IconButton, Switch, TextButton, GlyphButton } from '../ui/primitives';
import { G } from '../ui/glyphs';
import { useMouse } from '../ui/pointer';
import { Options } from './chips';
import { TimePicker } from './TimeEntry';
import { RepeatPanel } from './RepeatPanel';

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
                <GlyphButton icon={G.close} filled label="Any time" onClick={() => setTime(null)} />
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
                <GlyphButton icon={G.close} filled label="Any time" onClick={() => setTime(null)} />
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
          <TextButton onClick={() => setMonth(ref.slice(0, 7))} className="month__today">
            Today
          </TextButton>
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
          {trail ? null : <Icon name={G.fold} className="chev whenrow__chev icon--xs" />}
        </button>
        {trail}
      </div>
      {open ? <div className="whenrow__body">{children}</div> : null}
    </div>
  );
}

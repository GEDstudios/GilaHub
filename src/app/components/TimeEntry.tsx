import { useEffect, useRef, useState } from 'react';
import { use24h } from '../prefs';
import { usePrefs } from '../usePrefs';
import { useMouse } from '../ui/pointer';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The time on a computer, typed: an hour box and a minute box (type, or ↑ ↓), AM / PM on a
 * 12-hour clock. Two digits in the hour move on to the minutes. It's kept as soon as it reads as
 * a time; Enter (or leaving it) is done, Esc puts back what it was.
 */
export function TimePicker({
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

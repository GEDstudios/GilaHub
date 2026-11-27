import { useState } from 'react';
import { fromDateStr, today as todayStr } from '../../core/dates';
import type { Moment } from '../../core/model';
import { useHub } from '../context';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { lineVars } from '../ui/primitives';
import { FEELS, onThisDay } from '../moments';
import { G } from '../ui/glyphs';

const monthOf = (day: string) => fromDateStr(day).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const dayOf = (day: string) => fromDateStr(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * Moments: the good bits, kept so we can look back. Write one in a line with a feeling; they
 * gather by month, and the same day a year (or a month) ago comes back on top.
 */
export function MomentsSheet({ onClose }: { onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const [text, setText] = useState('');
  const [feel, setFeel] = useState(FEELS[0]);
  const all = hub.moments();
  const back = onThisDay(all, todayStr());
  const months = new Map<string, Moment[]>();
  for (const m of all) {
    const k = m.day.slice(0, 7);
    months.set(k, [...(months.get(k) ?? []), m]);
  }

  const save = () => {
    if (!text.trim()) return;
    hub.addMoment(text, feel);
    haptic('success');
    setText('');
  };

  return (
    <Sheet onClose={onClose} title="Moments">
      <form
        className="moment__new"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="moment__feels" role="radiogroup" aria-label="How it felt">
          {FEELS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={feel === f} className={`moment__feel ${feel === f ? 'is-on' : ''}`} onClick={() => setFeel(f)}>
              {f}
            </button>
          ))}
        </div>
        <div className="moment__write">
          <input value={text} dir="auto" onChange={(e) => setText(e.target.value)} placeholder="What happened?" aria-label="What happened?" enterKeyHint="done" />
          <button type="submit" className="btn btn--sm" disabled={!text.trim()}>
            Keep
          </button>
        </div>
      </form>

      {back ? (
        <div className="moment__back" style={lineVars('lilac')}>
          <span className="moment__ago">{back.ago}</span>
          <span className="moment__backtext" dir="auto">
            {back.moment.feel} {back.moment.text}
          </span>
        </div>
      ) : null}

      {all.length ? (
        [...months.entries()].map(([k, list]) => (
          <section key={k} className="moment__month">
            <h3 className="moment__monthname">{monthOf(`${k}-01`)}</h3>
            <ul className="moment__list">
              {list.map((m) => {
                const who = hub.member(m.by);
                return (
                  <li key={m.id} className="moment">
                    <span className="moment__e">{m.feel}</span>
                    <span className="moment__body">
                      <span className="moment__text" dir="auto">
                        {m.text}
                      </span>
                      <span className="moment__meta">
                        {who?.name ?? 'Someone'} · {dayOf(m.day)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="moment__x"
                      aria-label={`Forget: ${m.text}`}
                      onClick={() => {
                        const undo = hub.deleteMoment(m.id);
                        toast('Forgotten', { action: { label: 'Undo', run: undo } });
                      }}
                    >
                      <Icon name={G.close} className="icon--xs" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      ) : (
        <p className="moment__empty">The first one goes here. Something small counts.</p>
      )}
    </Sheet>
  );
}

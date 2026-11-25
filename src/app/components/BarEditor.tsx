import { useHub } from '../context';
import { MAX_PINS, pinOptions, pinsOf, setPins } from '../tabs';
import { Icon } from '../ui/Icon';
import { ProjectMark } from '../ui/ProjectMark';

/** Choose what sits in the bottom bar between Today and Projects. */
export function BarEditor() {
  const hub = useHub();
  const pins = pinsOf(hub);
  const opts = pinOptions(hub);
  const byKey = new Map(opts.map((o) => [o.key, o]));
  const full = pins.length >= MAX_PINS;
  const up = (i: number) => {
    if (i === 0) return;
    const next = [...pins];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setPins(hub, next);
  };

  return (
    <div className="bar">
      <div className="group">
        <div className="optrow optrow--fixed">
          <Icon name="sun" className="optrow__icon" />
          <span className="optrow__text">Today</span>
        </div>
        {pins.map((k, i) => {
          const o = byKey.get(k)!;
          return (
            <div key={k} className="optrow">
              <span className="bar__mark">{o.icon ? <Icon name={o.icon} className="optrow__icon" /> : <ProjectMark color={o.color} icon={o.glyph} size="sm" />}</span>
              <span className="optrow__text" dir="auto">
                {o.label}
              </span>
              {i > 0 ? (
                <button type="button" className="bar__btn" onClick={() => up(i)} aria-label={`Move ${o.label} up`}>
                  <Icon name="chevron-up" />
                </button>
              ) : null}
              <button type="button" className="bar__btn" onClick={() => setPins(hub, pins.filter((p) => p !== k))} aria-label={`Remove ${o.label}`}>
                <Icon name="x" />
              </button>
            </div>
          );
        })}
        <div className="optrow optrow--fixed">
          <Icon name="lines" className="optrow__icon" />
          <span className="optrow__text">Projects</span>
        </div>
      </div>
      {full ? null : (
        <div className="tokens">
          {opts
            .filter((o) => !pins.includes(o.key))
            .map((o) => (
              <button key={o.key} type="button" className="token" onClick={() => setPins(hub, [...pins, o.key])}>
                <Icon name="plus" />
                <span dir="auto">{o.label}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

import type { ReactNode } from 'react';
import { LINE_COLORS, type LineColor } from '../../core/model';
import { replay } from '../ui/flip';
import { haptic } from '../ui/haptics';
import { Switch } from '../ui/primitives';
import { Sheet } from '../ui/overlays';
import { Icon, type IconName } from '../ui/Icon';
import { lineVars } from '../ui/primitives';
import { G } from '../ui/glyphs';

/**
 * A quiet row inside a grouped card (settings, lists to pick from). `chev`: it opens something.
 * `danger`: it deletes or removes; it goes last in its group and is red.
 */
export function OptRow({
  icon,
  lead,
  title,
  sub,
  value,
  onClick,
  on,
  disabled,
  trail,
  chev,
  danger,
}: {
  icon?: IconName;
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  on?: boolean;
  disabled?: boolean;
  trail?: ReactNode;
  chev?: boolean;
  danger?: boolean;
}) {
  const body = (
    <>
      {lead ?? (icon ? <Icon name={icon} className="optrow__icon" /> : null)}
      <span className="optrow__text">
        <span dir="auto">{title}</span>
        {sub ? (
          <span className="optrow__sub" dir="auto">
            {sub}
          </span>
        ) : null}
      </span>
      {value !== undefined ? <span className="optrow__value">{value}</span> : null}
      {on ? <Icon name={G.done} /> : null}
      {trail}
      {chev ? <Icon name={G.go} className="optrow__chev" /> : null}
    </>
  );
  return onClick ? (
    <button type="button" className={`optrow optrow--tap ${danger ? 'optrow--danger' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={on}>
      {body}
    </button>
  ) : (
    <div className={`optrow ${danger ? 'optrow--danger' : ''}`}>{body}</div>
  );
}

/** One thing a "…" menu can do. It runs after the sheet closes. */
export type Action = { icon: IconName; title: string; sub?: ReactNode; danger?: boolean; hidden?: boolean; run: () => void };

/** A "…" menu: a sheet of actions, each one row; tapping one closes the sheet and does it. */
export function ActionSheet({ title, actions, onClose }: { title: string; actions: Action[]; onClose: () => void }) {
  return (
    <Sheet onClose={onClose} title={title}>
      <div className="group">
        {actions
          .filter((a) => !a.hidden)
          .map((a) => (
            <OptRow
              key={a.title}
              icon={a.icon}
              title={a.title}
              sub={a.sub}
              danger={a.danger}
              onClick={() => {
                onClose();
                a.run();
              }}
            />
          ))}
      </div>
    </Sheet>
  );
}

/**
 * A row that's on or off: a title (and a quieter line), a switch at the end. The whole row flips
 * it. `panel`: the quieter size, inside an editor's panel.
 */
export function SwitchRow({ icon, title, sub, on, onChange, label, panel }: { icon?: IconName; title: ReactNode; sub?: ReactNode; on: boolean; onChange: (on: boolean) => void; label?: string; panel?: boolean }) {
  return (
    <label className={`optrow optrow--switch ${panel ? 'optrow--panel' : ''}`}>
      {icon ? <Icon name={icon} className="optrow__icon" /> : null}
      <span className="optrow__text">
        <span dir="auto">{title}</span>
        {sub ? (
          <span className="optrow__sub" dir="auto">
            {sub}
          </span>
        ) : null}
      </span>
      <Switch on={on} onChange={onChange} label={label ?? (typeof title === 'string' ? title : '')} />
    </label>
  );
}

/**
 * Six colors, as round dots. A `taken` color (my person's) shows their initial and can't be
 * picked: a tap shakes it.
 */
export function Swatches({
  value,
  onChange,
  taken,
  big,
}: {
  value: LineColor;
  onChange: (c: LineColor) => void;
  taken?: Array<{ color: LineColor; name: string; initial: string }>;
  big?: boolean;
}) {
  return (
    <div className={`swatches ${big ? 'swatches--big' : ''}`} role="radiogroup" aria-label="Color">
      {LINE_COLORS.map((c) => {
        const owner = c !== value ? taken?.find((t) => t.color === c) : undefined;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === value}
            aria-label={owner ? `${c}, ${owner.name}’s` : c}
            aria-disabled={owner ? true : undefined}
            className={`swatch ${c === value ? 'is-on' : ''} ${owner ? 'is-taken' : ''}`}
            style={lineVars(c)}
            onClick={(e) => {
              if (!owner) return onChange(c);
              haptic('warn');
              replay(e.currentTarget);
            }}
          >
            {owner ? <span aria-hidden="true">{owner.initial}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

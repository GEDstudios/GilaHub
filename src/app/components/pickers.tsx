import type { ReactNode } from 'react';
import { LINE_COLORS, type LineColor } from '../../core/model';
import { replay } from '../ui/flip';
import { haptic } from '../ui/haptics';
import { Icon, type IconName } from '../ui/Icon';
import { lineVars } from '../ui/primitives';

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
      {on ? <Icon name="check" /> : null}
      {trail}
      {chev ? <Icon name="chevron-right" className="optrow__chev" /> : null}
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

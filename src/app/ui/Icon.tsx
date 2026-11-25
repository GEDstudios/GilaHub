import type { CSSProperties } from 'react';
import { GLYPHS, type IconName } from './icons.gen';

export type { IconName };

/** Glyphs whose light always says whose (or is always on), whatever the state. */
const FIXED_LIGHT: Partial<Record<IconName, string>> = {
  mine: 'var(--me-light)',
  theirs: 'var(--them)',
  'heart-fill': 'var(--pink)',
};

/**
 * Gila Duo: an ink line and a solid light layer (docs/03-DESIGN-SYSTEM.md, "Icons — Gila Duo").
 * The light rests at ink 7%, lights up in my color when the thing is on (`lit`, or a lit
 * parent such as `.tab.is-on`), takes a project's color for projects, and turns to ink 12%
 * on color. Controls (plus, x, chevrons…) are line only. Glyphs come from icons.gen.ts.
 */
export function Icon({ name, className, style, title, lit }: { name: IconName; className?: string; style?: CSSProperties; title?: string; lit?: boolean }) {
  const [light, line] = GLYPHS[name];
  const fixed = FIXED_LIGHT[name];
  return (
    <svg
      className={`icon${light ? '' : ' icon--control'}${lit ? ' is-lit' : ''}${className ? ` ${className}` : ''}`}
      style={fixed ? ({ '--light-fixed': fixed, ...style } as CSSProperties) : style}
      viewBox="0 0 256 256"
      focusable="false"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {light ? <path className="icon__light" d={light} /> : null}
      <path className="icon__line" d={line} />
    </svg>
  );
}

import type { CSSProperties } from 'react';
import { GLYPHS, type IconName as GlyphName } from './icons.gen';
import { useLibrary } from './library';

/** One of ours, or "x:<name>" from the library (ui/library.ts, loaded when first wanted). */
export type IconName = GlyphName | `x:${string}`;

/** Glyphs whose light always says whose (or is always on), whatever the state. */
const FIXED_LIGHT: Partial<Record<GlyphName, string>> = {
  mine: 'var(--me-light)',
  theirs: 'var(--them)',
  'heart-fill': 'var(--pink)',
};

/**
 * Gila Duo: an ink line and a solid light layer (docs/03-DESIGN-SYSTEM.md, "Icons — Gila Duo").
 * The light rests at ink 7%, lights up in my color when the thing is on (`lit`, or a lit
 * parent such as `.tab.is-on`), takes a folder's color for folders, and turns to ink 12%
 * on color. Controls (plus, x, chevrons…) are line only. Glyphs come from icons.gen.ts.
 */
export function Icon({ name, className, style, title, lit }: { name: IconName; className?: string; style?: CSSProperties; title?: string; lit?: boolean }) {
  if (name.startsWith('x:')) return <LibIcon name={name.slice(2)} className={className} style={style} title={title} lit={lit} />;
  const n = name as GlyphName;
  return <GlyphSvg glyph={GLYPHS[n]} fixed={FIXED_LIGHT[n]} className={className} style={style} title={title} lit={lit} />;
}

/** A library glyph by its Phosphor name; an empty icon-sized box until the library lands. */
function LibIcon({ name, ...rest }: { name: string; className?: string; style?: CSSProperties; title?: string; lit?: boolean }) {
  const lib = useLibrary();
  return <GlyphSvg glyph={lib?.LIBRARY[name]} {...rest} />;
}

/** Any [light, line] glyph drawn the Gila Duo way (Icon's, or one from the library). */
function GlyphSvg({
  glyph,
  fixed,
  className,
  style,
  title,
  lit,
}: {
  glyph: readonly [string | null, string] | undefined;
  fixed?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  lit?: boolean;
}) {
  const [light, line] = glyph ?? [null, ''];
  return (
    <svg
      className={`icon${light || !glyph ? '' : ' icon--control'}${lit ? ' is-lit' : ''}${className ? ` ${className}` : ''}`}
      style={fixed ? ({ '--light-fixed': fixed, ...style } as CSSProperties) : style}
      viewBox="0 0 256 256"
      focusable="false"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {light ? <path className="icon__light" d={light} /> : null}
      {line ? <path className="icon__line" d={line} /> : null}
    </svg>
  );
}

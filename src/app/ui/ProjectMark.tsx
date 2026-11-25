import type { CSSProperties } from 'react';
import type { LineColor } from '../../core/model';
import { Icon, type IconName } from './Icon';
import { lineVars } from './primitives';

/** Line icons offered for projects (stored as "i:<name>"); any emoji works too. */
export const PROJECT_ICONS: IconName[] = [
  'cart',
  'bag',
  'home',
  'sparkle',
  'lines',
  'calendar',
  'heart',
  'gift',
  'plane',
  'utensils',
  'cake',
  'book',
  'graduation',
  'briefcase',
  'wallet',
  'car',
  'paw',
  'baby',
  'plant',
  'leaf',
  'dumbbell',
  'film',
  'music',
  'star',
  'wrench',
  'bell',
];

export type Glyph = { kind: 'icon'; name: IconName } | { kind: 'emoji'; text: string } | null;

export function parseGlyph(icon: string | undefined | null): Glyph {
  const v = (icon ?? '').trim();
  if (!v) return null;
  if (v.startsWith('i:')) {
    const name = v.slice(2) as IconName;
    return PROJECT_ICONS.includes(name) ? { kind: 'icon', name } : null;
  }
  return { kind: 'emoji', text: v };
}

/** The glyph alone: a line icon or an emoji. */
export function Glyph({ icon, className }: { icon: string | undefined | null; className?: string }) {
  const g = parseGlyph(icon);
  if (!g) return null;
  return g.kind === 'icon' ? <Icon name={g.name} className={className} /> : <span className={`glyph-emoji ${className ?? ''}`}>{g.text}</span>;
}

/** A project's mark: a small tilted tile in its color, with its icon inside if it has one. */
export function ProjectMark({ color, icon, size = 'md', style }: { color: LineColor | undefined; icon?: string | null; size?: 'sm' | 'md'; style?: CSSProperties }) {
  return (
    <span className={`pmark pmark--${size}`} style={{ ...lineVars(color), ...style }} aria-hidden="true">
      <Glyph icon={icon} />
    </span>
  );
}

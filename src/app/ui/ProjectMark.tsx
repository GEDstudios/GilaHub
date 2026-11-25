import type { CSSProperties } from 'react';
import type { LineColor } from '../../core/model';
import { Icon, type IconName } from './Icon';
import { lineVars } from './primitives';

/** Icons offered for projects (stored as "i:<name>"); any emoji works too. Only ever add to this list. */
export const PROJECT_ICONS: IconName[] = [
  'cart',
  'basket',
  'bag',
  'home',
  'sparkle',
  'broom',
  'lines',
  'calendar',
  'heart',
  'gift',
  'plane',
  'suitcase',
  'utensils',
  'cooking-pot',
  'coffee',
  'cake',
  'book',
  'graduation',
  'briefcase',
  'wallet',
  'car',
  'paw',
  'baby',
  'first-aid',
  'plant',
  'leaf',
  'dumbbell',
  'film',
  'music',
  'star',
  'wrench',
  'bell',
  'folder',
];

/** "No icon", picked: the plain folder. (An empty icon is one not picked yet: Hub.fillIcons.) */
export const PLAIN_FOLDER = 'i:folder';

/** Does a folder card show this glyph? Not the plain folder: the card already is one. */
export const showsGlyph = (icon: string | undefined | null): boolean => !!parseGlyph(icon) && icon !== PLAIN_FOLDER;

export type Glyph = { kind: 'icon'; name: IconName } | { kind: 'emoji'; text: string } | null;

export function parseGlyph(icon: string | undefined | null): Glyph {
  const v = (icon ?? '').trim();
  if (!v) return null;
  if (v.startsWith('i:')) {
    const name = v.slice(2) as IconName;
    return PROJECT_ICONS.includes(name) ? { kind: 'icon', name } : null;
  }
  // From the library: the Icon draws it as "x:<name>".
  if (v.startsWith('x:')) return v.length > 2 ? { kind: 'icon', name: v as IconName } : null;
  return { kind: 'emoji', text: v };
}

/** The glyph alone: an icon or an emoji. */
export function Glyph({ icon, className }: { icon: string | undefined | null; className?: string }) {
  const g = parseGlyph(icon);
  if (!g) return null;
  return g.kind === 'icon' ? <Icon name={g.name} className={className} /> : <span className={`glyph-emoji ${className ?? ''}`}>{g.text}</span>;
}

/**
 * A project's mark: its icon (or a folder) with the light in the project's color. An emoji
 * keeps the small tilted tile in the project's color.
 */
export function ProjectMark({ color, icon, size = 'md', style }: { color: LineColor | undefined; icon?: string | null; size?: 'sm' | 'md'; style?: CSSProperties }) {
  const g = parseGlyph(icon);
  if (g?.kind === 'emoji')
    return (
      <span className={`pmark pmark--${size}`} style={{ ...lineVars(color), ...style }} aria-hidden="true">
        <span className="glyph-emoji">{g.text}</span>
      </span>
    );
  return <Icon name={g?.name ?? 'folder'} className={`icon--project${size === 'sm' ? ' icon--sm' : ''}`} style={{ ...lineVars(color), ...style }} />;
}

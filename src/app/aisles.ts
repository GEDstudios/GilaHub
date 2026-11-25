import type { Hub } from '../core/actions';
import type { Flavor } from '../smart/categorize';
import type { IconName } from './ui/Icon';

/** Aisles and departments drawn as icons (aisle card headers, the item sheet's Aisle chip). */
const GROCERY: Partial<Record<string, IconName>> = {
  produce: 'carrot',
  bakery: 'bread',
  dairy: 'cheese',
  meat: 'fish',
  deli: 'bowl',
  pantry: 'jar',
  spices: 'pepper',
  snacks: 'cookie',
  frozen: 'snowflake',
  drinks: 'drink',
  household: 'spray',
  personal: 'soap',
  baby: 'baby',
  pets: 'paw',
  other: 'cart',
};

/** Home shopping's departments; none reuses a grocery aisle's glyph, so "Both" never shows one twice. */
const HOME: Partial<Record<string, IconName>> = {
  kitchen: 'cooking-pot',
  bath: 'bath',
  bedroom: 'bed',
  furniture: 'armchair',
  cleaning: 'broom',
  tools: 'wrench',
  electrical: 'lightbulb',
  garden: 'plant',
  office: 'briefcase',
  other: 'package',
};

/** An aisle's glyph; only learned or custom categories (no glyph) keep their emoji. */
export const aisleIcon = (flavor: Flavor, category: string): IconName | undefined => (flavor === 'grocery' ? GROCERY : HOME)[category];

/**
 * How a category is drawn: our picked icon ("i:<glyph>" or an emoji) first, then the built-in
 * glyph, then its emoji.
 */
export function categoryMark(hub: Hub, flavor: Flavor, category: string): { icon?: IconName; emoji: string } {
  const meta = hub.aisleMeta(flavor, category);
  if (meta.icon?.startsWith('i:')) return { icon: meta.icon.slice(2) as IconName, emoji: meta.emoji };
  if (meta.icon) return { emoji: meta.icon };
  // Our own categories wear a tag until we pick something else.
  return { icon: aisleIcon(flavor, category) ?? (meta.custom ? 'tag' : undefined), emoji: meta.emoji };
}

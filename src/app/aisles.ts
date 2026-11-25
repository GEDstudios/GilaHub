import type { Flavor } from '../smart/categorize';
import type { IconName } from './ui/Icon';

/** Grocery aisles drawn as icons (aisle card headers, the item sheet's Aisle chip). */
const AISLE_ICON: Partial<Record<string, IconName>> = {
  produce: 'carrot',
  bakery: 'bread',
  dairy: 'cheese',
  meat: 'fish',
  deli: 'bowl',
  pantry: 'jar',
  snacks: 'cookie',
  frozen: 'snowflake',
  drinks: 'drink',
  household: 'spray',
  personal: 'soap',
  baby: 'baby',
  pets: 'paw',
  other: 'cart',
};

/** An aisle's glyph; home departments (and aisles without one) keep their emoji. */
export const aisleIcon = (flavor: Flavor, category: string): IconName | undefined => (flavor === 'grocery' ? AISLE_ICON[category] : undefined);

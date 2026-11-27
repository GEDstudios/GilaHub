import type { Hub } from './hub';
import { LINE_COLORS, type LineColor, type ShoppingFlavor, type Visibility } from './model';

/**
 * Where a household starts: the folders offered at onboarding (and their colours). Nothing is
 * made unless it's picked.
 */

interface ProjectTemplate {
  key: string;
  name: string;
  icon: string;
  /** A shopping list (made inside Shopping): groceries or things for the home. */
  flavor?: ShoppingFlavor;
  visibility?: Visibility;
  blurb: string;
}

/** Starting points offered at onboarding and in "New project". Nothing is created unless picked. */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  { key: 'groceries', name: 'Groceries', icon: 'i:cart', flavor: 'grocery', blurb: 'Sorted by aisle, for both of you' },
  { key: 'home', name: 'Home shopping', icon: 'i:bag', flavor: 'home', blurb: 'Bulbs, towels, a new pan' },
  { key: 'chores', name: 'Chores', icon: 'i:broom', blurb: 'Things that repeat, shared fairly' },
  { key: 'todo', name: 'To do', icon: 'i:lines', blurb: 'Everything else, with dates and steps' },
  { key: 'trip', name: 'Next trip', icon: 'i:suitcase', blurb: 'Plans and packing' },
  { key: 'gifts', name: 'Gift ideas', icon: 'i:gift', visibility: 'private', blurb: 'Only you can see it' },
];

/** A starting project; a shopping one goes inside Shopping (made if needed), with its aisles as tags. */
function createFromTemplate(hub: Hub, t: ProjectTemplate, color?: LineColor): string {
  return hub.store.batch(() => {
    const parentId = t.flavor ? hub.ensureShopRoot() : null;
    if (t.flavor) hub.ensureBuiltinTags(t.flavor);
    return hub.createList({ name: t.name, flavor: t.flavor, color, icon: t.icon, visibility: t.visibility ?? 'shared', parentId, view: t.flavor ? 'tags' : undefined });
  });
}

/** A random color from the palette, preferring ones no project uses yet, then ones not in `avoid`. */
export function pickColor(used: LineColor[], rand: () => number = Math.random, avoid: LineColor[] = []): LineColor {
  const free = LINE_COLORS.filter((c) => !used.includes(c));
  const apart = LINE_COLORS.filter((c) => !avoid.includes(c));
  const pool = free.length ? free : apart.length ? apart : LINE_COLORS;
  return pool[Math.floor(rand() * pool.length)];
}

/** Distinct random colors for several new projects at once. */
export function pickColors(keys: string[], used: LineColor[] = [], rand: () => number = Math.random): Record<string, LineColor> {
  const out: Record<string, LineColor> = {};
  const taken = [...used];
  for (const k of keys) {
    out[k] = pickColor(taken, rand);
    taken.push(out[k]);
  }
  return out;
}

/** A brand-new household: only the projects the person picked. */
export function seedHousehold(hub: Hub, templateKeys: string[], colors: Record<string, LineColor> = {}): void {
  hub.store.batch(() => {
    for (const key of templateKeys) {
      const t = PROJECT_TEMPLATES.find((x) => x.key === key);
      if (t) createFromTemplate(hub, t, colors[key]);
    }
  });
}

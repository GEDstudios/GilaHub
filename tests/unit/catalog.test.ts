import { describe, expect, it } from 'vitest';
import { GLYPHS } from '../../src/app/ui/icons.gen';
import { aisleGlyph as aisleIcon, categorize, GROCERY_ORDER, HOME_ORDER, routeFlavor, suggestFromCatalog } from '../../src/smart/categorize';
import { GROCERY_CATALOG } from '../../src/smart/dictionary/grocery';
import { HOME_CATALOG } from '../../src/smart/dictionary/home';
import type { CatalogEntry } from '../../src/smart/dictionary/types';
import { fold } from '../../src/smart/normalize';

/** Exact (folded) spellings claimed by more than one entry of the same catalog. */
function clashes(catalog: Record<string, CatalogEntry[]>) {
  const owners = new Map<string, Set<string>>();
  for (const [cat, entries] of Object.entries(catalog)) {
    for (const e of entries) {
      for (const term of [e.en, ...e.he, ...(e.alt ?? [])]) {
        const k = fold(term);
        if (!owners.has(k)) owners.set(k, new Set());
        owners.get(k)!.add(`${cat}/${e.en}`);
      }
    }
  }
  return [...owners].filter(([, o]) => o.size > 1).map(([k, o]) => `${k} → ${[...o].join(' / ')}`);
}

describe('catalog', () => {
  it('has a healthy size', () => {
    const g = Object.values(GROCERY_CATALOG).flat().length;
    const h = Object.values(HOME_CATALOG).flat().length;
    expect(g).toBeGreaterThan(330);
    expect(h).toBeGreaterThan(120);
  });

  it('never gives one spelling to two entries of the same catalog', () => {
    expect(clashes(GROCERY_CATALOG as Record<string, CatalogEntry[]>)).toEqual([]);
    expect(clashes(HOME_CATALOG as Record<string, CatalogEntry[]>)).toEqual([]);
  });

  it('tells near-identical Hebrew words apart and prefers the list’s own catalog', () => {
    expect(categorize('חלב', 'grocery').entry?.en).toBe('Milk');
    expect(categorize('חלבה', 'grocery').entry?.en).toBe('Halva');
    expect(categorize('שמן', 'grocery').entry?.en).toBe('Cooking oil');
    expect(categorize('שמנת', 'grocery').entry?.en).toBe('Sweet cream');
    expect(categorize('כריות', 'grocery').entry?.en).toBe('Breakfast cereal');
    expect(categorize('כריות', 'home').entry?.en).toBe('Pillows');
  });

  it.each([
    ['2 milk', 'grocery', 'dairy'],
    ['עגבנייה', 'grocery', 'produce'],
    ['עגבניות שרי', 'grocery', 'produce'],
    ["קוטג' 5%", 'grocery', 'dairy'],
    ['חזה עוף', 'grocery', 'meat'],
    ['במבה', 'grocery', 'snacks'],
    ['Bamba', 'grocery', 'snacks'],
    ['פיתות', 'grocery', 'bakery'],
    ['ice cream', 'grocery', 'frozen'],
    ['נייר טואלט', 'grocery', 'household'],
    ['shampoo', 'grocery', 'personal'],
    ['טחינה', 'grocery', 'pantry'],
    ['חומוס', 'grocery', 'deli'],
    ['organic baby spinach', 'grocery', 'produce'],
    ['חלב שקדים', 'grocery', 'dairy'],
    ['light bulbs', 'home', 'electrical'],
    ['סוללות AA', 'home', 'electrical'],
    ['מגבות', 'home', 'bath'],
    ['דיבלים', 'home', 'tools'],
  ])('%s → %s/%s', (name, flavor, category) => {
    expect(categorize(name, flavor as 'grocery' | 'home')).toMatchObject({ category });
  });

  it('routes mixed adds to the right list', () => {
    expect(routeFlavor('light bulbs')).toBe('home');
    expect(routeFlavor('נורות')).toBe('home');
    expect(routeFlavor('milk')).toBe('grocery');
    expect(routeFlavor('something unknown')).toBe('grocery');
  });

  it('autocompletes in the language being typed', () => {
    expect(suggestFromCatalog('עגב').some((s) => s.label.startsWith('עגבני'))).toBe(true);
    expect(suggestFromCatalog('toma').some((s) => s.label === 'Tomatoes')).toBe(true);
    expect(suggestFromCatalog('עגב').every((s) => /[֐-׿]/.test(s.label))).toBe(true);
  });

  it('uses learned corrections first', () => {
    const learned = (k: string) => (k === 'grocery:zaatar cracker' ? { category: 'snacks' } : undefined);
    expect(categorize('Zaatar crackers', 'grocery', learned).category).toBe('snacks');
  });
});

describe('spices aisle', () => {
  it('files spices under Spices, not Pantry, in both languages', async () => {
    const { categorize } = await import('../../src/smart/categorize');
    const none = () => undefined;
    for (const n of ['salt', 'כמון', 'paprika', 'זעתר', 'black pepper', 'cinnamon', 'garlic powder', 'chili flakes', 'hawaij', 'פפריקה'])
      expect([n, categorize(n, 'grocery', none).category]).toEqual([n, 'spices']);
    for (const n of ['pasta', 'אורז', 'olive oil']) expect([n, categorize(n, 'grocery', none).category]).toEqual([n, 'pantry']);
    expect(categorize('rosemary', 'grocery', none).category).toBe('produce');
  });
});

describe('aisle icons', () => {
  it('draw every aisle and department as an icon, none shared between the two, and leave custom ones to their emoji', () => {
    expect(aisleIcon('grocery', 'dairy')).toBe('cheese');
    expect(aisleIcon('grocery', 'nope')).toBeUndefined();
    expect(aisleIcon('home', 'dairy')).toBeUndefined();
    const home = HOME_ORDER.filter((c) => c !== 'other').map((c) => aisleIcon('home', c));
    expect(home.every(Boolean)).toBe(true);
    expect(new Set(home).size).toBe(home.length);
    const grocery = new Set(GROCERY_ORDER.filter((c) => c !== 'other').map((c) => aisleIcon('grocery', c)));
    expect(home.filter((i) => grocery.has(i))).toEqual([]);
    // Each is an icon the app draws.
    for (const g of [...home, ...grocery]) expect(GLYPHS).toHaveProperty(g!);
  });
});

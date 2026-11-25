import { GROCERY_CATALOG, GROCERY_CATEGORIES } from './dictionary/grocery';
import { HOME_CATALOG, HOME_CATEGORIES } from './dictionary/home';
import type { CatalogEntry, CategoryMeta, GroceryCategory, HomeCategory } from './dictionary/types';
import { fold, hasHebrew, itemKey, stem, stripArticle } from './normalize';

export type Flavor = 'grocery' | 'home';

/** Aisle walking order (Israeli supermarket) — independent of object key order. */
export const GROCERY_ORDER: GroceryCategory[] = [
  'produce',
  'bakery',
  'dairy',
  'meat',
  'deli',
  'pantry',
  'spices',
  'snacks',
  'frozen',
  'drinks',
  'household',
  'personal',
  'baby',
  'pets',
  'other',
];

export const HOME_ORDER: HomeCategory[] = [
  'kitchen',
  'bath',
  'bedroom',
  'furniture',
  'cleaning',
  'tools',
  'electrical',
  'garden',
  'office',
  'other',
];

export interface CategoryHit {
  flavor: Flavor;
  category: string;
  emoji: string;
  entry?: CatalogEntry;
}

interface IndexHit {
  flavor: Flavor;
  category: string;
  entry: CatalogEntry;
}

interface Suggestion {
  label: string;
  folded: string;
  he: boolean;
  hit: IndexHit;
}

/** Exact spelling (folded) → entries, and stemmed key → entries. Exact wins; stems catch plurals. */
const exact = new Map<string, IndexHit[]>();
const index = new Map<string, IndexHit[]>();
const suggestions: Suggestion[] = [];

function push(map: Map<string, IndexHit[]>, k: string, hit: IndexHit) {
  if (!k) return;
  const arr = map.get(k);
  if (!arr) map.set(k, [hit]);
  else if (!arr.includes(hit)) arr.push(hit);
}

function build(flavor: Flavor, catalog: Record<string, CatalogEntry[]>) {
  for (const [category, entries] of Object.entries(catalog)) {
    for (const entry of entries) {
      const hit: IndexHit = { flavor, category, entry };
      for (const term of [entry.en, ...entry.he, ...(entry.alt ?? [])]) {
        push(exact, fold(term), hit);
        push(index, itemKey(term), hit);
      }
      suggestions.push({ label: entry.en, folded: fold(entry.en), he: false, hit });
      for (const he of entry.he) suggestions.push({ label: he, folded: fold(he), he: true, hit });
    }
  }
}

build('grocery', GROCERY_CATALOG as Record<string, CatalogEntry[]>);
build('home', HOME_CATALOG as Record<string, CatalogEntry[]>);

/**
 * Find the catalog entry for a free-form item name ("2 ליטר חלב 3%", "Organic baby spinach").
 * Exact spelling beats stemmed forms; the longest phrase wins; for single words English
 * prefers the last word (head noun), Hebrew the first ("חלב שקדים" → חלב…).
 * With `prefer`, an entry from that catalog wins over the other (כריות: cereal vs pillows).
 */
export function lookup(name: string, prefer?: Flavor): IndexHit | undefined {
  const words = fold(name).split(' ').filter(Boolean);
  if (!words.length) return undefined;
  const he = hasHebrew(name);
  const variants = [words, words.map((w) => stripArticle(w) ?? w)];
  const hitsFor = (ws: string[]) => [...(exact.get(ws.join(' ')) ?? []), ...(index.get(ws.map(stem).join(' ')) ?? [])];
  const pick = (hits: IndexHit[]) => (prefer && hits.find((h) => h.flavor === prefer)) || hits[0];
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    const found: IndexHit[] = [];
    for (const ws of variants) {
      const starts = [...Array(ws.length - n + 1).keys()];
      if (!he) starts.reverse();
      for (const st of starts) found.push(...hitsFor(ws.slice(st, st + n)));
    }
    if (found.length) return pick(found);
  }
  return undefined;
}

/** Category + emoji for an item, honouring learned corrections first. */
export function categorize(
  name: string,
  flavor: Flavor,
  learned?: (key: string) => { category: string; emoji?: string } | undefined,
): CategoryHit {
  const key = `${flavor}:${itemKey(name)}`;
  const mem = learned?.(key);
  const hit = lookup(name, flavor);
  if (mem) return { flavor, category: mem.category, emoji: mem.emoji ?? hit?.entry.e ?? '', entry: hit?.entry };
  if (hit && hit.flavor === flavor) return { flavor, category: hit.category, emoji: hit.entry.e, entry: hit.entry };
  return { flavor, category: 'other', emoji: hit?.entry.e ?? '' };
}

/** Which shopping list should a new item go to, when adding from the combined view? */
export function routeFlavor(name: string): Flavor {
  return lookup(name)?.flavor ?? 'grocery';
}

export function emojiFor(name: string): string {
  return lookup(name)?.entry.e ?? '';
}

export function categoryMeta(flavor: Flavor, category: string): CategoryMeta {
  const table = (flavor === 'grocery' ? GROCERY_CATEGORIES : HOME_CATEGORIES) as Record<string, CategoryMeta>;
  return table[category] ?? table.other ?? { en: 'Other', he: 'אחר', e: '🛒' };
}

export function categoryOrder(flavor: Flavor): string[] {
  return flavor === 'grocery' ? GROCERY_ORDER : HOME_ORDER;
}

export interface CatalogSuggestion {
  label: string;
  emoji: string;
  flavor: Flavor;
  category: string;
}

/** Autocomplete from the built-in catalog, in the language being typed. */
export function suggestFromCatalog(query: string, flavor?: Flavor, limit = 6): CatalogSuggestion[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const he = hasHebrew(query);
  const ranked: Array<{ s: Suggestion; rank: number }> = [];
  for (const s of suggestions) {
    if (s.he !== he) continue;
    if (flavor && s.hit.flavor !== flavor) continue;
    let rank = -1;
    if (s.folded.startsWith(q)) rank = 0;
    else if (s.folded.split(' ').some((w) => w.startsWith(q))) rank = 1;
    else if (q.length >= 3 && s.folded.includes(q)) rank = 2;
    if (rank >= 0) ranked.push({ s, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.s.label.length - b.s.label.length);
  const seen = new Set<string>();
  const out: CatalogSuggestion[] = [];
  for (const { s } of ranked) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    out.push({ label: s.label, emoji: s.hit.entry.e, flavor: s.hit.flavor, category: s.hit.category });
    if (out.length >= limit) break;
  }
  return out;
}

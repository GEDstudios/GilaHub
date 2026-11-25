/**
 * Shared contract for the built-in bilingual (English + Hebrew) item catalog.
 *
 * The catalog powers three "smart" behaviours without any network access:
 *  1. Auto-sorting a shopping item into an aisle category.
 *  2. A friendly emoji next to known items.
 *  3. Autocomplete suggestions while typing (in the language being typed).
 *
 * Matching is done by `src/smart/categorize.ts`, which normalizes input
 * (lowercase, strips quantities/units/punctuation, light singularization,
 * Hebrew definite-article prefix "ה"), so entries only need natural forms.
 */

/** Supermarket aisles, in a typical walking order of an Israeli supermarket. */
export type GroceryCategory =
  | 'produce'
  | 'bakery'
  | 'dairy'
  | 'meat'
  | 'deli'
  | 'pantry'
  | 'snacks'
  | 'frozen'
  | 'drinks'
  | 'household'
  | 'personal'
  | 'baby'
  | 'pets'
  | 'other';

/** Departments for the "house stuff" shopping list (durable goods). */
export type HomeCategory =
  | 'kitchen'
  | 'bath'
  | 'bedroom'
  | 'furniture'
  | 'cleaning'
  | 'tools'
  | 'electrical'
  | 'garden'
  | 'office'
  | 'other';

export interface CatalogEntry {
  /** Canonical English display name, Title Case, e.g. "Cherry tomatoes". */
  en: string;
  /** Hebrew names without niqqud; the first one is the canonical display name. */
  he: string[];
  /**
   * Extra lowercase match terms in any language: singular/plural forms,
   * synonyms, common brand names used generically, transliterations
   * (e.g. "cottage", "bamba", "labane"), common misspellings.
   */
  alt?: string[];
  /** Exactly one emoji that best represents the item. */
  e: string;
}

export interface CategoryMeta {
  /** English label for the aisle header, short (<= 18 chars). */
  en: string;
  /** Hebrew label for the aisle header. */
  he: string;
  /** Representative emoji for the aisle. */
  e: string;
}

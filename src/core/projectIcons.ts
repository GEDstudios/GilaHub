import { fold } from '../smart/normalize';
import type { ListKind, ShoppingFlavor } from './model';

/**
 * A new project's icon, from its name, so a bar full of projects isn't a row of identical
 * folders. Stored like a picked one ("i:<name>", a PROJECT_ICONS name), so the person can change
 * it. Each idea lists alternatives: a second trip next to the first gets the other one.
 */
const BY_WORD: Array<[RegExp, string[]]> = [
  [/grocer|supermarket|food|סופר|מכולת/, ['cart', 'basket']],
  [/shopping|buy|קניות/, ['bag', 'cart']],
  [/chore|clean|house ?work|ניקיון|מטלות/, ['broom', 'sparkle']],
  [/to ?do|tasks?$|משימות/, ['lines', 'calendar']],
  [/trip|travel|vacation|holiday|flight|abroad|rome|paris|london|berlin|tokyo|טיול|חופשה/, ['suitcase', 'plane']],
  [/gift|present|birthday|מתנ|יום הולדת/, ['gift', 'cake']],
  [/garden|plant|balcony|גינה|צמח/, ['plant', 'leaf']],
  [/wedding|love|anniversary|date night|honeymoon|חתונה/, ['heart', 'gift']],
  [/\bcar\b|vehicle|garage|רכב|אוטו/, ['car', 'wrench']],
  [/book|read|library|ספר/, ['book', 'graduation']],
  [/recipe|cook|meal|dinner|baking|מתכונ|ארוח/, ['cooking-pot', 'utensils']],
  [/restaurant|eat out|cafe|מסעד/, ['utensils', 'coffee']],
  [/apartment|home|house|move|moving|renovat|furniture|דירה|בית|שיפוץ/, ['home', 'wrench']],
  [/baby|kid|child|school|תינוק|ילד/, ['baby', 'graduation']],
  [/pet|\bdog|\bcat\b|vet|כלב|חתול/, ['paw']],
  [/work|office|job|business|עבודה/, ['briefcase']],
  [/money|budget|bill|finance|tax|bank|כסף|תקציב|חשבונ/, ['wallet']],
  [/gym|fitness|workout|sport|run|יוגה|כושר/, ['dumbbell']],
  [/movie|film|series|watch|show|סרט/, ['film']],
  [/music|song|concert|playlist|מוזיקה/, ['music']],
  [/coffee|קפה/, ['coffee']],
  [/party|celebrat|מסיב/, ['cake', 'music']],
  [/study|course|learn|class|לימוד/, ['graduation', 'book']],
  [/health|doctor|medical|dentist|בריאות|רופא/, ['first-aid']],
  [/fix|repair|diy|tool|תיקונ/, ['wrench']],
];

/** By kind, when the name says nothing. */
const BY_KIND: Partial<Record<ListKind | 'home', string[]>> = {
  shopping: ['cart', 'basket'],
  home: ['bag', 'basket'],
};

/** Neither says anything: plain marks, so a bar of such projects isn't a row of folders. */
const PLAIN = ['sparkle', 'leaf', 'bell', 'music', 'book', 'coffee', 'heart', 'calendar', 'plant', 'film'];

const hash = (s: string): number => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return h;
};

/**
 * "i:<name>" for a project called `name`: from its words, else its kind, else a plain mark
 * that no project in `taken` has, starting from one picked by the name (so every phone picks
 * the same one). Avoids the icon its neighbour has.
 */
export function suggestIcon(name: string, kind: ListKind, flavor?: ShoppingFlavor, neighbour?: string, taken: ReadonlySet<string> = new Set()): string {
  const n = fold(name);
  const ideas = BY_WORD.find(([re]) => re.test(n))?.[1] ?? BY_KIND[kind === 'shopping' && flavor === 'home' ? 'home' : kind];
  if (ideas) return `i:${ideas.find((i) => `i:${i}` !== neighbour) ?? ideas[0]}`;
  const start = hash(n);
  const free = PLAIN.map((_, k) => `i:${PLAIN[(start + k) % PLAIN.length]}`).find((i) => i !== neighbour && !taken.has(i));
  return free ?? `i:${PLAIN[start % PLAIN.length]}`;
}

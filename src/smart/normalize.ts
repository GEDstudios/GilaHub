/**
 * Text normalization for matching items in Hebrew and English.
 * "עגבנייה", "עגבניות", "Tomatoes" and "tomato" all reduce to stable keys.
 */

const NIQQUD = /[֑-ׇ]/g;
const QUOTES = /[׳״'"`‘’“”´]/g;
const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
const HEBREW = /[֐-׿]/;

export function hasHebrew(s: string): boolean {
  return HEBREW.test(s);
}

/** Lowercase, strip niqqud/quotes/punctuation, unify final letters and ײ/וו spelling. */
export function fold(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(NIQQUD, '')
    .replace(QUOTES, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/יי/g, 'י')
    .replace(/וו/g, 'ו')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemEnglish(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('oes') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ves') && w.length > 4) return w.slice(0, -3) + 'f';
  if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

function stemHebrew(w: string): string {
  if (w.length <= 3) return w;
  // Words are already folded, so the plural "ים" arrives as "ימ".
  if (/(ות|ימ)$/.test(w) && w.length > 4) return w.slice(0, -2);
  if (/[הת]$/.test(w) && w.length > 3) return w.slice(0, -1);
  return w;
}

/** Per-word stem (after `fold`). */
export function stem(word: string): string {
  return hasHebrew(word) ? stemHebrew(word) : stemEnglish(word);
}

/** Canonical key for an item name: folded, stemmed words joined by spaces. */
export function itemKey(name: string): string {
  return fold(name)
    .split(' ')
    .filter(Boolean)
    .map(stem)
    .join(' ');
}

/** Hebrew definite article: "החלב" → "חלב" (only used as a fallback lookup). */
export function stripArticle(word: string): string | null {
  return word.length > 3 && word.startsWith('ה') ? word.slice(1) : null;
}

/** Split pasted text (WhatsApp, notes) into separate entries. */
export function splitPasted(text: string): string[] {
  return text
    .split(/\r?\n|[,،;•·]|\s-\s/)
    .map((l) => l.replace(/^\s*(?:[-*•·–—]|\d+[.)]|\[\s?[xX ]?\s?\])\s*/, '').trim())
    .filter((l) => l.length > 0 && l.length < 120);
}

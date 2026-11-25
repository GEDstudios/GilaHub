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

// ---------- quantities ----------

const UNIT_ALIASES: Array<[RegExp, string]> = [
  [/^(kg|kgs|kilo|kilos|kilogram|kilograms|ק"?ג|קילו|קילוגרם)$/i, 'kg'],
  [/^(g|gr|grams?|גר?'?|גרם)$/i, 'g'],
  [/^(l|lt|ltr|liters?|litres?|ל'?|ליטר|ליטרים)$/i, 'L'],
  [/^(ml|מ"?ל)$/i, 'ml'],
  [/^(packs?|pk|pkt|packets?|חבילה|חבילות|מארז|מארזים)$/i, 'pack'],
  [/^(box|boxes|קופסה|קופסא|קופסאות)$/i, 'box'],
  [/^(bottles?|בקבוק|בקבוקים)$/i, 'bottle'],
  [/^(cans?|tins?|פחית|פחיות)$/i, 'can'],
  [/^(bags?|שקית|שקיות)$/i, 'bag'],
  [/^(dozen|תריסר)$/i, 'dozen'],
  [/^(units?|pcs?|pieces?|יח'?|יחידה|יחידות)$/i, ''],
];

function unitOf(token: string): string | null {
  const t = token.replace(/[.,]$/, '');
  for (const [re, unit] of UNIT_ALIASES) if (re.test(t)) return unit;
  return null;
}

const NUM = String.raw`(\d+(?:[.,]\d+)?|½|חצי)`;

export interface QtyParse {
  name: string;
  qty: string | null;
}

function num(s: string): string {
  if (s === '½' || s === 'חצי') return '½';
  return s.replace(',', '.');
}

function fmtQty(n: string, unit: string | null): string {
  if (!unit) return n;
  if (unit === 'kg' || unit === 'g' || unit === 'ml' || unit === 'L') return `${n} ${unit}`;
  if (unit === 'dozen') return n === '1' ? '1 dozen' : `${n} dozen`;
  return `${n} ${unit}${n === '1' || n === '½' ? '' : unit === 'box' ? 'es' : 's'}`;
}

/**
 * Pull an optional quantity out of a shopping entry:
 *   "2 milk", "milk x2", "500g cheese", "1 ק"ג עגבניות", "חצי קילו גבינה", "eggs (12)".
 * Never required; returns the cleaned name.
 */
export function parseQuantity(raw: string): QtyParse {
  let s = raw.trim().replace(/\s+/g, ' ');
  // Trailing multiplier: "milk x2", "milk ×2", "milk *2", "milk (2)"
  let m = s.match(new RegExp(String.raw`^(.*?)\s*(?:[x×*]\s*${NUM}|\(\s*${NUM}\s*\))$`, 'i'));
  if (m && m[1]) return { name: m[1].trim(), qty: num(m[2] ?? m[3]) };
  // Leading multiplier: "2x milk", "x2 milk"
  m = s.match(new RegExp(String.raw`^(?:${NUM}\s*[x×]|[x×]\s*${NUM})\s+(.+)$`, 'i'));
  if (m) return { name: m[3].trim(), qty: num(m[1] ?? m[2]) };
  // Leading number with optional unit: "500g cheese", "2 milk", "1 ק"ג עגבניות"
  m = s.match(new RegExp(String.raw`^${NUM}\s*([^\s\d]+)?\s+(.+)$`));
  if (m) {
    const unit = m[2] ? unitOf(m[2]) : null;
    if (m[2] && unit === null) {
      // "2 milk" — second token is part of the name
      return { name: `${m[2]} ${m[3]}`.trim(), qty: num(m[1]) };
    }
    return { name: m[3].trim(), qty: fmtQty(num(m[1]), unit) };
  }
  // Glued unit at the start: "500g cheese"
  m = s.match(/^(\d+(?:[.,]\d+)?)(kg|g|gr|l|ml)\s+(.+)$/i);
  if (m) return { name: m[3].trim(), qty: fmtQty(num(m[1]), unitOf(m[2])) };
  // Trailing number with optional unit: "milk 2", "cheese 500g", "עגבניות 1 ק"ג"
  m = s.match(new RegExp(String.raw`^(.+?)\s+${NUM}\s*([^\s\d]+)?$`));
  if (m && (!m[3] || unitOf(m[3]) !== null)) {
    return { name: m[1].trim(), qty: fmtQty(num(m[2]), m[3] ? unitOf(m[3]) : null) };
  }
  s = s.trim();
  return { name: s, qty: null };
}

/** Split pasted text (WhatsApp, notes) into separate entries. */
export function splitPasted(text: string): string[] {
  return text
    .split(/\r?\n|[,،;•·]|\s-\s/)
    .map((l) => l.replace(/^\s*(?:[-*•·–—]|\d+[.)]|\[\s?[xX ]?\s?\])\s*/, '').trim())
    .filter((l) => l.length > 0 && l.length < 120);
}

import type { LogEntry } from '../core/model';
import { fold } from './normalize';

const DAY = 86_400_000;

export interface PurchaseStats {
  key: string;
  name: string;
  listId?: string;
  count: number;
  firstAt: number;
  lastAt: number;
  /** Average days between purchases (distinct days), or null with a single purchase. */
  avgDays: number | null;
}

/** Collapse purchase logs into one row per normalized item name. */
export function purchaseStats(logs: LogEntry[]): Map<string, PurchaseStats> {
  const byKey = new Map<string, LogEntry[]>();
  for (const l of logs) {
    if (l.kind !== 'bought' || !l.key) continue;
    let arr = byKey.get(l.key);
    if (!arr) byKey.set(l.key, (arr = []));
    arr.push(l);
  }
  const out = new Map<string, PurchaseStats>();
  for (const [key, arr] of byKey) {
    arr.sort((a, b) => a.at - b.at);
    const days: number[] = [];
    for (const l of arr) {
      const d = Math.floor(l.at / DAY);
      if (days[days.length - 1] !== d) days.push(d);
    }
    const last = arr[arr.length - 1];
    out.set(key, {
      key,
      name: last.name ?? key,
      listId: last.listId,
      count: days.length,
      firstAt: arr[0].at,
      lastAt: last.at,
      avgDays: days.length > 1 ? (days[days.length - 1] - days[0]) / (days.length - 1) : null,
    });
  }
  return out;
}

export interface BuyAgainOptions {
  now?: number;
  minCount?: number;
  /** Suggest once this fraction of the usual interval has passed. */
  threshold?: number;
  limit?: number;
  isDismissed?: (key: string, lastAt: number) => boolean;
}

export interface BuyAgainSuggestion extends PurchaseStats {
  /** How far through its usual cycle the item is (1 = right on time). */
  due: number;
}

/**
 * Calm "buy again": at most `limit` items you buy regularly, that are not on the list,
 * and whose usual interval has (nearly) passed. Requires a few trips of history.
 */
export function buyAgain(stats: Map<string, PurchaseStats>, onList: Set<string>, opts: BuyAgainOptions = {}): BuyAgainSuggestion[] {
  const now = opts.now ?? Date.now();
  const minCount = opts.minCount ?? 2;
  const threshold = opts.threshold ?? 0.85;
  const out: BuyAgainSuggestion[] = [];
  for (const s of stats.values()) {
    if (s.count < minCount || !s.avgDays || onList.has(s.key)) continue;
    if (opts.isDismissed?.(s.key, s.lastAt)) continue;
    const interval = Math.max(1, s.avgDays);
    const due = (now - s.lastAt) / DAY / interval;
    if (due >= threshold && due < 6) out.push({ ...s, due });
  }
  out.sort((a, b) => b.due - a.due || b.count - a.count);
  return out.slice(0, opts.limit ?? 6);
}

/** Autocomplete from the household's own purchase history (most frequent first). */
export function historyMatches(stats: Map<string, PurchaseStats>, query: string, limit = 5): PurchaseStats[] {
  const q = fold(query);
  if (!q) return [];
  const hits: Array<{ s: PurchaseStats; rank: number }> = [];
  for (const s of stats.values()) {
    const f = fold(s.name);
    let rank = -1;
    if (f.startsWith(q)) rank = 0;
    else if (f.split(' ').some((w) => w.startsWith(q))) rank = 1;
    else if (q.length >= 3 && f.includes(q)) rank = 2;
    if (rank >= 0) hits.push({ s, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || b.s.count - a.s.count || b.s.lastAt - a.s.lastAt);
  return hits.slice(0, limit).map((h) => h.s);
}

/** "usually every 5 days" */
export function cadenceLabel(avgDays: number | null): string {
  if (!avgDays) return '';
  const d = Math.round(avgDays);
  if (d <= 1) return 'usually daily';
  if (d < 13) return `usually every ${d} days`;
  const w = Math.round(d / 7);
  if (w < 8) return `usually every ${w} weeks`;
  return `usually every ${Math.round(d / 30)} months`;
}

import { addDays, addMonths, diffDays, fromDateStr, humanDate, humanTime, today as todayOf, toDateStr, weekday, weekdayName, type DateStr } from '../core/dates';
import type { RepeatRule } from '../core/model';
import { fold } from './normalize';
import { describeRule, firstDue } from './recurrence';

/**
 * Quick add: "Call the plumber tomorrow 6pm @hila !" → title + structured fields.
 * Every recognized part becomes a token the UI shows as a chip; tapping a chip adds its
 * key to `ignore`, and re-parsing leaves that text in the title. Parsing is conservative:
 * ambiguous words ("morning run", "sat down") stay in the title.
 */

export type TokenKind = 'date' | 'time' | 'repeat' | 'assignee' | 'list' | 'tag' | 'urgent';

interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  text: string;
  key: string;
  label: string;
}

export interface ParseContext {
  now?: Date;
  members?: Array<{ id: string; name: string }>;
  meId?: string;
  lists?: Array<{ id: string; name: string }>;
  /** Tags there are: "#name" that isn't a folder is one of these, or a new one. */
  tags?: Array<{ id: string; name: string }>;
  /** 13/12 (day first) vs 12/13. */
  dayFirst?: boolean;
  /** 0 = week starts Sunday (Israel), 1 = Monday. */
  weekStart?: 0 | 1;
  /** Working days for "every weekday" (Israel: Sun–Thu). */
  workdays?: number[];
  mode?: 'task' | 'shopping';
  /** Default anchor for interval repeats ("after it's done" for chores). */
  repeatFrom?: 'done' | 'schedule';
  ignore?: Set<string>;
  h24?: boolean;
}

export interface ParseResult {
  title: string;
  due?: DateStr;
  dueTime?: string;
  repeat?: RepeatRule;
  assignee?: string;
  listId?: string;
  /** "#name" tags: ones there are, and new names to make. */
  tagIds?: string[];
  newTags?: string[];
  urgent?: boolean;
  tokens: Token[];
}

const B = String.raw`(?<![\p{L}\p{N}_])`;
const E = String.raw`(?![\p{L}\p{N}_])`;
const rx = (src: string) => new RegExp(`${B}(?:${src})${E}`, 'giu');

const WD_EN = String.raw`sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?`;
const WD_EN_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const WD_HE = 'ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת';
const WD_HE_INDEX: Record<string, number> = { ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, שבת: 6 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RX = String.raw`jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?`;
const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };

const wdEn = (s: string) => WD_EN_INDEX[s.slice(0, 3).toLowerCase()];
const pad = (n: number) => String(n).padStart(2, '0');

type Unit = 'day' | 'week' | 'month' | 'year';
const unitOf = (s: string): Unit => {
  const t = s.toLowerCase();
  if (t.startsWith('d') || t.startsWith('י')) return 'day';
  if (t.startsWith('w') || t.startsWith('שב')) return 'week';
  if (t.startsWith('m') || t.startsWith('ח')) return 'month';
  return 'year';
};

export function parseQuickAdd(input: string, ctx: ParseContext = {}): ParseResult {
  const now = ctx.now ?? new Date();
  const today = todayOf(now);
  const weekStart = ctx.weekStart ?? 0;
  const ignore = ctx.ignore ?? new Set<string>();
  const workdays = ctx.workdays ?? [1, 2, 3, 4, 5];
  const repeatFrom = ctx.repeatFrom ?? 'schedule';
  const text = input;
  const tokens: Token[] = [];
  const out: ParseResult = { title: '', tokens };
  let tonightHint: string | null = null;

  const overlaps = (s: number, e: number) => tokens.some((t) => s < t.end && e > t.start);

  /** Run a regex over the text; handler returns a label (accept) or null (reject). */
  const scan = (kind: TokenKind, re: RegExp, handle: (m: RegExpExecArray) => string | null, once = true) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!m[0].trim() || overlaps(start, end)) continue;
      const key = `${kind}:${fold(m[0])}`;
      if (ignore.has(key)) continue;
      const label = handle(m);
      if (label === null) continue;
      tokens.push({ kind, start, end, text: m[0], key, label });
      if (once) return true;
    }
    return false;
  };

  const nextWeekStart = (from: DateStr) => {
    let d = addDays(from, 1);
    while (weekday(d) !== weekStart) d = addDays(d, 1);
    return d;
  };
  const onOrAfter = (from: DateStr, wd: number) => {
    let d = from;
    while (weekday(d) !== wd) d = addDays(d, 1);
    return d;
  };
  const resolveWeekday = (wd: number, mod?: string) => {
    if (mod && /^(next|הבא)$/i.test(mod)) return onOrAfter(nextWeekStart(today), wd);
    return onOrAfter(today, wd);
  };
  const weekendDay = weekStart === 0 ? 5 : 6;

  const setDue = (d: DateStr) => {
    out.due = d;
    return humanDate(d, today);
  };

  {
    // ---------- repeat ----------
    const fromDone = String.raw`(?:\s+(?:after\s+(?:it'?s\s+)?done|from\s+(?:when\s+)?done|אחרי\s+שנעשה))?`;
    const mkInterval = (every: number, unit: Unit, done: boolean): RepeatRule => ({
      type: 'interval',
      every,
      unit,
      from: done ? 'done' : repeatFrom,
    });
    const acceptRule = (rule: RepeatRule) => {
      out.repeat = rule;
      return describeRule(rule, (n) => weekdayName(n));
    };
    const isDone = (s: string) => /after|from|אחרי/i.test(s);

    // Days of the month: "every month on the 1st and 15th", "on the 10th of every month",
    // "every 1st & 15th", "last day of the month", "כל 1 ו-15 לחודש".
    const DAY = String.raw`(?:\d{1,2}(?:st|nd|rd|th)?|last(?:\s+day)?)`;
    const DAY_ORD = String.raw`(?:\d{1,2}(?:st|nd|rd|th)|last\s+day)`;
    const list = (d: string) => String.raw`${d}(?:\s*(?:,|and|&)\s*(?:the\s+)?${d})*`;
    const monthdays = (s: string): RepeatRule | null => {
      const days = [...s.matchAll(/(\d{1,2})|last/gi)].map((m) => (m[1] ? +m[1] : -1)).filter((n) => n === -1 || (n >= 1 && n <= 31));
      return days.length ? { type: 'monthdays', days: [...new Set(days)].sort((a, b) => a - b) } : null;
    };
    const acceptDays = (m: RegExpExecArray) => {
      const r = monthdays(m[1] ?? m[0]);
      return r ? acceptRule(r) : null;
    };
    scan('repeat', rx(String.raw`(?:(?:every|each)\s+month|monthly)\s+on\s+(?:the\s+)?(${list(DAY)})`), acceptDays) ||
      scan('repeat', rx(String.raw`(?:on\s+)?(?:the\s+)?(${list(DAY)})\s+(?:day\s+)?of\s+(?:every|each|the)\s+month`), acceptDays) ||
      scan('repeat', rx(String.raw`(?:every|each)\s+(?:the\s+)?(${list(DAY_ORD)})`), acceptDays) ||
      scan('repeat', rx(String.raw`כל\s+(\d{1,2}(?:\s*(?:,|ו-?)\s*\d{1,2})*)\s+(?:ל|ב)חודש`), acceptDays) ||
      scan('repeat', rx(String.raw`(?:כל\s+)?סוף\s+(?:כל\s+)?(?:ה)?חודש`), () => acceptRule({ type: 'monthdays', days: [-1] })) ||
    scan('repeat', rx(String.raw`every\s+(${WD_EN})((?:\s*(?:,|and|&)\s*(?:${WD_EN}))*)`), (m) => {
      const days = [m[1], ...(m[2].match(new RegExp(WD_EN, 'gi')) ?? [])].map(wdEn);
      return acceptRule({ type: 'weekdays', days: [...new Set(days)].sort() });
    }) ||
      scan('repeat', rx(String.raw`every\s+weekdays?|on\s+weekdays|weekdays`), () => acceptRule({ type: 'weekdays', days: workdays })) ||
      scan('repeat', rx(String.raw`every\s+weekend`), () => acceptRule({ type: 'weekdays', days: weekStart === 0 ? [5, 6] : [0, 6] })) ||
      scan('repeat', rx(String.raw`every\s+other\s+(day|week|month|year)` + fromDone), (m) => acceptRule(mkInterval(2, unitOf(m[1]), isDone(m[0])))) ||
      scan('repeat', rx(String.raw`every\s+(\d{1,3})\s+(days?|weeks?|months?|years?)` + fromDone), (m) =>
        acceptRule(mkInterval(Math.max(1, +m[1]), unitOf(m[2]), isDone(m[0]))),
      ) ||
      scan('repeat', rx(String.raw`every\s+(day|week|month|year)` + fromDone), (m) => acceptRule(mkInterval(1, unitOf(m[1]), isDone(m[0])))) ||
      scan('repeat', rx(String.raw`daily|weekly|monthly|yearly|annually`), (m) => {
        const w = m[0].toLowerCase();
        const unit: Unit = w.startsWith('d') ? 'day' : w.startsWith('w') ? 'week' : w.startsWith('m') ? 'month' : 'year';
        return acceptRule(mkInterval(1, unit, false));
      }) ||
      // Hebrew
      scan('repeat', rx(String.raw`כל\s+(?:יום\s+)?(${WD_HE})((?:\s*(?:,|ו)\s*(?:${WD_HE}))*)`), (m) => {
        const rest = m[2].match(new RegExp(WD_HE, 'g')) ?? [];
        const days = [m[1], ...rest].map((d) => WD_HE_INDEX[d]);
        return acceptRule({ type: 'weekdays', days: [...new Set(days)].sort() });
      }) ||
      scan('repeat', rx('כל\\s+(יומיים|שבועיים|חודשיים)' + fromDone), (m) =>
        acceptRule(mkInterval(2, m[1].startsWith('יו') ? 'day' : m[1].startsWith('ש') ? 'week' : 'month', isDone(m[0]))),
      ) ||
      scan('repeat', rx(String.raw`כל\s+(\d{1,3})\s+(ימים|שבועות|חודשים|שנים)` + fromDone), (m) =>
        acceptRule(mkInterval(Math.max(1, +m[1]), unitOf(m[2]), isDone(m[0]))),
      ) ||
      scan('repeat', rx('כל\\s+(יום|שבוע|חודש|שנה)' + fromDone), (m) => acceptRule(mkInterval(1, unitOf(m[1]), isDone(m[0]))));

    // ---------- dates ----------
    const pre = String.raw`(?:(?:on|by|due|for)\s+)?`;
    scan('date', rx(pre + String.raw`(?:the\s+)?day\s+after\s+tomorrow|מחרתיים`), () => setDue(addDays(today, 2))) ||
      scan('date', rx(pre + String.raw`today|tod|tonight|היום|הערב|הלילה`), (m) => {
        if (/tonight|הערב/i.test(m[0])) tonightHint = '20:00';
        if (/הלילה/.test(m[0])) tonightHint = '21:00';
        return setDue(today);
      }) ||
      scan('date', rx(pre + String.raw`tomorrow|tmrw|tmr|tmw|מחר`), () => setDue(addDays(today, 1))) ||
      scan('date', rx(pre + String.raw`(?:(this|next)\s+)?(${WD_EN})`), (m) => setDue(resolveWeekday(wdEn(m[2]), m[1]))) ||
      scan('date', rx(String.raw`(?:ב)?יום\s+(${WD_HE})(?:\s+(הבא))?|ב(${WD_HE})(?:\s+(הבא))?`), (m) => {
        const day = m[1] ?? m[3];
        return setDue(resolveWeekday(WD_HE_INDEX[day], m[2] ?? m[4]));
      }) ||
      scan('date', rx(pre + String.raw`(?:this\s+)?weekend|בסופ"?ש|בסוף\s+השבוע`), () => setDue(onOrAfter(today, weekendDay))) ||
      scan('date', rx(pre + String.raw`next\s+week|בשבוע\s+הבא|שבוע\s+הבא`), () => setDue(nextWeekStart(today))) ||
      scan('date', rx(pre + String.raw`next\s+month|בחודש\s+הבא`), () => {
        const d = fromDateStr(today);
        return setDue(toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 1)));
      }) ||
      scan('date', rx(String.raw`in\s+(\d{1,3}|a|an|one|two|three|four|five|six|seven|ten)\s+(days?|weeks?|months?|years?)`), (m) => {
        const n = /^\d+$/.test(m[1]) ? +m[1] : NUM_WORDS[m[1].toLowerCase()];
        const u = unitOf(m[2]);
        if (u === 'day') return setDue(addDays(today, n));
        if (u === 'week') return setDue(addDays(today, 7 * n));
        return setDue(addMonths(today, u === 'month' ? n : 12 * n));
      }) ||
      scan('date', rx(String.raw`(?:ב)?עוד\s+(\d{1,3})\s+(ימים|שבועות|חודשים)|(?:ב)?עוד\s+(יומיים|שבוע|שבועיים|חודש)`), (m) => {
        if (m[1]) {
          const u = unitOf(m[2]);
          const n = +m[1];
          return setDue(u === 'day' ? addDays(today, n) : u === 'week' ? addDays(today, 7 * n) : addMonths(today, n));
        }
        const w = m[3];
        return setDue(w === 'יומיים' ? addDays(today, 2) : w === 'שבוע' ? addDays(today, 7) : w === 'שבועיים' ? addDays(today, 14) : addMonths(today, 1));
      }) ||
      scan('date', rx(pre + String.raw`(\d{4})-(\d{2})-(\d{2})`), (m) => {
        const d = `${m[1]}-${m[2]}-${m[3]}`;
        return Number.isNaN(fromDateStr(d).getTime()) ? null : setDue(d);
      }) ||
      scan('date', rx(pre + String.raw`(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH_RX})\.?(?:,?\s+(\d{4}))?`), (m) =>
        explicitDate(+m[1], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), m[3] ? +m[3] : undefined),
      ) ||
      scan('date', rx(pre + String.raw`(${MONTH_RX})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?`), (m) =>
        explicitDate(+m[2], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), m[3] ? +m[3] : undefined),
      ) ||
      // 5/12, 5/12/27, 5.12.27 (a lone "1.5" is a number, not a date), ב-5.12
      scan('date', rx(pre + String.raw`(?:ב-?)?(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?|(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})|ב-?(\d{1,2})\.(\d{1,2})`), (m) => {
        const a = +(m[1] ?? m[4] ?? m[7]);
        const b = +(m[2] ?? m[5] ?? m[8]);
        const yy = m[3] ?? m[6];
        const [day, month] = ctx.dayFirst === false ? [b, a] : [a, b];
        const year = yy ? (yy.length === 2 ? 2000 + +yy : +yy) : undefined;
        return explicitDate(day, month - 1, year);
      });

    // ---------- times ----------
    const setTime = (h: number, min: number) => {
      if (h > 23 || min > 59) return null;
      out.dueTime = `${pad(h)}:${pad(min)}`;
      return humanTime(out.dueTime, ctx.h24);
    };
    scan('time', rx(String.raw`(?:at\s+|@\s*)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)`), (m) => {
      let h = +m[1];
      if (h < 1 || h > 12) return null;
      const pm = /p/i.test(m[3]);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
      return setTime(h, m[2] ? +m[2] : 0);
    }) ||
      scan('time', rx(String.raw`(?:at\s+|(?:ב-?|בשעה\s+))?([01]?\d|2[0-3]):([0-5]\d)`), (m) => {
        let h = +m[1];
        // "at 5:30" means evening; "05:30" with a leading zero means what it says.
        if (m[1].length === 1 && h >= 1 && h <= 7 && /^at\s/i.test(m[0])) h += 12;
        return setTime(h, +m[2]);
      }) ||
      scan('time', rx(String.raw`at\s+(\d{1,2})|בשעה\s+(\d{1,2})`), (m) => {
        let h = +(m[1] ?? m[2]);
        if (h > 23) return null;
        if (h >= 1 && h <= 7) h += 12;
        return setTime(h, 0);
      }) ||
      scan('time', rx(String.raw`(?:at\s+)?(?:noon|midday)|בצהריים`), () => setTime(12, 0)) ||
      scan('time', rx(String.raw`(?:this|in\s+the)\s+(morning|afternoon|evening)|בבוקר|אחה"?צ|אחר\s+הצהריים|בערב|בלילה`), (m) => {
        const w = (m[1] ?? m[0]).toLowerCase();
        if (/morning|בבוקר/.test(w)) return setTime(9, 0);
        if (/afternoon|אחה|אחר/.test(w)) return setTime(15, 0);
        if (/לילה/.test(w)) return setTime(21, 0);
        return setTime(19, 0);
      });
  }

  // ---------- urgent ----------
  scan('urgent', /(?<=^|\s)!{1,3}(?=\s|$)|!{2,3}(?=\s|$)/gu, () => {
    out.urgent = true;
    return 'Urgent';
  }) ||
    // Said in words too: urgent(ly), asap, דחוף (however many ף), דחופה, בדחיפות, מהר.
    scan('urgent', rx(String.raw`urgent(?:ly)?|asap|דחו+ף+|דחופה|בדחיפות|מהר`), () => {
      out.urgent = true;
      return 'Urgent';
    });

  // ---------- @assignee ----------
  scan('assignee', /(?<![\p{L}\p{N}])@([\p{L}\p{N}_-]+)/gu, (m) => {
    const q = fold(m[1]);
    if (/^(me|i|אני)$/.test(q) && ctx.meId) {
      out.assignee = ctx.meId;
      return ctx.members?.find((x) => x.id === ctx.meId)?.name ?? 'Me';
    }
    if (/^(both|us|we|שנינו|ביחד)$/.test(q)) {
      out.assignee = 'both';
      return 'Both';
    }
    const who = ctx.members?.find((x) => fold(x.name).startsWith(q));
    if (!who) return null;
    out.assignee = who.id;
    return who.name;
  });

  // ---------- #folder, #tag ----------
  // A name said exactly wins (a folder, then a tag); then a folder it starts; then a tag it starts,
  // or a new tag.
  const HASH = /(?<![\p{L}\p{N}])#([\p{L}\p{N}_-]+)/gu;
  const same = (name: string, q: string) => fold(name) === q || fold(name).replace(/\s+/g, '') === q;
  const pickList = (l: { id: string; name: string } | undefined) => {
    if (!l) return null;
    out.listId = l.id;
    return l.name;
  };
  const pickTag = (t: { id: string; name: string } | undefined) => {
    if (!t) return null;
    if (!out.tagIds?.includes(t.id)) out.tagIds = [...(out.tagIds ?? []), t.id];
    return t.name;
  };
  scan('list', HASH, (m) => pickList(ctx.lists?.find((l) => same(l.name, fold(m[1])))));
  scan('tag', HASH, (m) => pickTag(ctx.tags?.find((t) => same(t.name, fold(m[1])))), false);
  scan('list', HASH, (m) => {
    const q = fold(m[1]);
    return pickList(ctx.lists?.find((l) => fold(l.name).startsWith(q)) ?? ctx.lists?.find((l) => fold(l.name).split(' ').some((w) => w.startsWith(q))));
  });
  scan(
    'tag',
    HASH,
    (m) => {
      const tag = pickTag(ctx.tags?.find((t) => fold(t.name).startsWith(fold(m[1]))));
      if (tag) return tag;
      if (!/^\p{L}/u.test(m[1])) return null;
      out.newTags = [...(out.newTags ?? []), m[1]];
      return m[1];
    },
    false,
  );

  // ---------- title ----------
  // A little word left in front of what was taken out ("at" 5pm, "ב" 5/12) goes with it; the
  // same word anywhere else is the title's own ("Call Dana ב", "Put it on").
  let title = '';
  let cursor = 0;
  const sorted = [...tokens].sort((a, b) => a.start - b.start);
  for (const t of sorted) {
    title += text.slice(cursor, t.start).replace(/(^|\s)(?:at|on|by|due|for|ב)\s*$/i, '$1') + ' ';
    cursor = t.end;
  }
  title += text.slice(cursor);
  const ledByToken = sorted.length > 0 && !text.slice(0, sorted[0].start).trim();
  title = title.replace(/\s+/g, ' ');
  if (ledByToken) title = title.trimStart().replace(/^(?:at|on|by|due)\s+/i, '');
  title = title
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[,.;:\s]+|[,;:\s]+$/g, '')
    .trim();

  out.title = title;

  // ---------- derived defaults ----------
  if (tonightHint && !out.dueTime) out.dueTime = tonightHint;
  if (out.repeat && !out.due) out.due = firstDue(out.repeat, today);
  if (out.dueTime && !out.due) {
    const [h, m] = out.dueTime.split(':').map(Number);
    const later = h * 60 + m > now.getHours() * 60 + now.getMinutes();
    out.due = later ? today : addDays(today, 1);
  }
  // Chip label for date includes the time when both exist.
  const dateTok = tokens.find((t) => t.kind === 'date');
  if (dateTok && out.due) dateTok.label = humanDate(out.due, today);
  return out;

  function explicitDate(day: number, month0: number, year?: number): string | null {
    if (month0 < 0 || month0 > 11 || day < 1 || day > 31) return null;
    const base = fromDateStr(today);
    let y = year ?? base.getFullYear();
    let d = new Date(y, month0, day);
    if (d.getMonth() !== month0) return null;
    if (!year && diffDays(today, toDateStr(d)) < 0) {
      y += 1;
      d = new Date(y, month0, day);
    }
    return setDue(toDateStr(d));
  }
}

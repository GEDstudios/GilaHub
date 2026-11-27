import type { Hub } from '../core/hub';
import { humanDate, humanTime, weekdayName } from '../core/dates';
import type { Assignee, RepeatRule } from '../core/model';
import { describeRule } from '../smart/recurrence';

/**
 * How things are said, in one place: a person's name, who does a task, when it's due, how it
 * repeats, when it notifies. Every screen and notification words these the same way.
 */

/** A member's name, or how to refer to them when we can't see it. */
export function nameOf(hub: Hub, id: string | null | undefined, fallback = 'Your person'): string {
  return (id && hub.member(id)?.name) || fallback;
}

/** "Every week", "Sun & Wed", "Every month on the 1st" (without "after it's done"). */
export const ruleShort = (r: RepeatRule): string => describeRule(r, (n) => weekdayName(n)).replace(" after it's done", '');

/** When a notification can come, before the due time. */
export const REMIND_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'When due' },
  { value: 15, label: '15 min before' },
  { value: 60, label: '1 hour before' },
  { value: 24 * 60, label: '1 day before' },
];

/** "10 min before", "At the time"… or null for no notification. */
export function remindText(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return REMIND_OPTIONS.find((o) => o.value === v)?.label ?? `${v} min before`;
}

/** Who does it, as a chip says it: "Me", "Hila", "Together", "Turns · you next". */
export function whoText(hub: Hub, a: Assignee | undefined, turn?: string | null): string {
  if (!a) return 'Either of us';
  if (a === 'both') return 'Together';
  if (a === 'turns') return turn ? `Turns · ${turn === hub.meId ? 'you' : nameOf(hub, turn, '')} next` : 'Taking turns';
  return a === hub.meId ? 'Me' : nameOf(hub, a, 'Someone');
}

/** Who does it, inside a sentence: "for you", "for Hila", "together", "taking turns". */
export function whoInSentence(hub: Hub, a: Assignee): string {
  if (a === 'both') return 'together';
  if (a === 'turns') return 'taking turns';
  return a === hub.meId ? 'for you' : `for ${nameOf(hub, a, 'them')}`;
}

/**
 * A day and maybe a time. Compact (rows, chips, notifications): "Fri 4 Dec · 17:00". In a
 * sentence: "Fri 4 Dec at 17:00".
 */
export function whenText(due: string, time: string | null | undefined, ref: string, h24: boolean, style: 'compact' | 'sentence' = 'compact'): string {
  const day = humanDate(due, ref);
  if (!time) return day;
  return `${day}${style === 'sentence' ? ' at ' : ' · '}${humanTime(time, h24)}`;
}

/** "for you" → "For you". */
export const capital = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

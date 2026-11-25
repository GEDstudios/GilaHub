/**
 * Adding, as pure rules shared by the in-place AddRow and the New composer
 * (docs/03-DESIGN-SYSTEM.md, "Adding"): what the typed words mean, what a chip
 * overrides, and which mode a project puts the add in.
 */
import type { ListKind, RepeatRule } from '../core/model';
import type { ParseResult, TokenKind } from '../smart/parse';
import type { Draft } from './components/editors';
import type { VisChoice } from './privacy';

export type AddMode = 'task' | 'chore' | 'shopping';

export const modeOf = (kind: ListKind | undefined): AddMode => (kind === 'shopping' ? 'shopping' : kind === 'chores' ? 'chore' : 'task');

/** A new chore comes back every week, counted from when it's done, unless the words say otherwise. */
export const CHORE_REPEAT: RepeatRule = { type: 'interval', every: 1, unit: 'week', from: 'done' };

/** What the words say before any chip is touched: parsed fields over the screen's defaults. */
export function parsedDraft(p: ParseResult, d: { mode: AddMode; defaultDue?: string | null; visibility: VisChoice }): Draft {
  return {
    due: p.due ?? d.defaultDue ?? null,
    dueTime: p.dueTime ?? null,
    repeat: p.repeat ?? (d.mode === 'chore' ? CHORE_REPEAT : null),
    remind: null,
    assignee: p.assignee ?? null,
    urgent: !!p.urgent,
    visibility: d.visibility,
    needsOk: false,
  };
}

/** Chips win over words. A privacy the project doesn't allow falls back to its default. */
export function composeDraft(base: Draft, over: Partial<Draft>, allowed: VisChoice[]): Draft {
  const d = { ...base, ...over };
  if (!allowed.includes(d.visibility)) d.visibility = base.visibility;
  return d;
}

const KIND_OF: Partial<Record<keyof Draft, TokenKind>> = { due: 'date', dueTime: 'time', repeat: 'repeat', assignee: 'assignee', urgent: 'urgent' };
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The parsed tokens a chip change overrides. Their keys go into the parser's `ignore`,
 * so the typed words stay as plain text instead of fighting the chip.
 */
export function overriddenTokens(p: ParseResult, draft: Draft, patch: Partial<Draft>): string[] {
  const kinds = new Set<TokenKind>();
  for (const k of Object.keys(patch) as Array<keyof Draft>) {
    const kind = KIND_OF[k];
    if (kind && !same(patch[k], draft[k])) kinds.add(kind);
  }
  return p.tokens.filter((t) => kinds.has(t.kind)).map((t) => t.key);
}

/** A sentence to type, as the composer's placeholder: one at random per open. */
export function composerPlaceholder(mode: AddMode, partnerName: string | null | undefined, rand = Math.random()): string {
  if (mode === 'shopping') return 'milk x2';
  if (mode === 'chore') return 'Water plants every 3 days';
  const all = ['Call mom tomorrow 6pm', 'Pay rent every 1st', ...(partnerName ? [`Fix the tap @${partnerName}`] : [])];
  return all[Math.min(all.length - 1, Math.floor(rand * all.length))];
}

/** What an add row says when nothing is typed. */
export function addRowPlaceholder(mode: AddMode, listName: string | undefined, isStep: boolean): string {
  if (isStep) return 'Add a step';
  if (mode === 'chore') return 'Add a chore';
  if (mode === 'shopping') return 'Add an item';
  return `Add to ${listName ?? 'list'}`;
}

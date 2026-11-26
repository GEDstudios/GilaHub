import type { Hub } from '../core/actions';
import type { List, TaskTemplate } from '../core/model';
import type { Draft } from './components/editors';
import { getPrefs, use24h } from './prefs';
import { firstDue } from '../smart/recurrence';
import { addDays, humanTime, today } from '../core/dates';
import { remindText, ruleShort } from './components/editors';
import { allowedVis, itemVisChoice, setItemVis } from './privacy';

/** Whether a folder's template sets anything at all. */
export function hasTemplate(list: List | undefined | null): list is List & { template: TaskTemplate } {
  const t = list?.template;
  return !!t && Object.values(t).some((v) => v !== null && v !== undefined && v !== false && !(Array.isArray(v) && !v.length));
}

/** What it sets, in a line: "Urgent · Errands · Every week". */
export function templateSummary(hub: Hub, t: TaskTemplate): string {
  const bits: string[] = [];
  if (t.urgent) bits.push('Urgent');
  if (t.assignee) bits.push(t.assignee === 'both' ? 'Both of you' : t.assignee === hub.meId ? 'For you' : `For ${hub.member(t.assignee)?.name ?? 'them'}`);
  if (t.needsOk) bits.push('Needs your OK');
  const tags = (t.tags ?? []).map((x) => hub.tag(x)?.name).filter(Boolean);
  if (tags.length) bits.push(tags.join(', '));
  if (t.repeat) bits.push(ruleShort(t.repeat));
  if (t.remind != null) bits.push(`Notify ${(remindText(t.remind) ?? '').toLowerCase()}`);
  if (t.dueIn != null) bits.push(dayIn(t.dueIn) + (t.dueTime ? `, ${humanTime(t.dueTime, use24h(getPrefs()))}` : ''));
  else if (t.dueTime) bits.push(humanTime(t.dueTime, use24h(getPrefs())));
  if (t.nag) bits.push(`Again ${ruleShort(t.nag).toLowerCase()} until done`);
  if (t.steps?.length) bits.push(`${t.steps.length} ${t.steps.length === 1 ? 'subtask' : 'subtasks'}`);
  if (t.notes) bits.push('A note');
    if (t.visibility) bits.push(t.visibility === 'ours' ? 'Ours' : t.visibility === 'mine' ? 'Mine' : t.visibility === 'private' ? 'Private' : 'Theirs');
  return bits.join(' · ');
}

/** "Same day", "Next day", "In 3 days", "In a week". */
export function dayIn(n: number): string {
  if (n === 0) return 'Same day';
  if (n === 1) return 'Next day';
  if (n === 7) return 'In a week';
  if (n === 14) return 'In two weeks';
  return `In ${n} days`;
}

/** The day (and time) a template gives a new task, when the words and chips gave none. */
export function templateDay(t: TaskTemplate, d: Pick<Draft, 'due' | 'dueTime'>): Pick<Draft, 'due' | 'dueTime'> {
  const due = d.due ?? (t.dueIn != null ? addDays(today(), t.dueIn) : null);
  return { due, dueTime: d.dueTime ?? (due && t.dueTime ? t.dueTime : null) };
}

/** What a template adds once a task exists: its note, and its subtasks (ones it has already aren't added twice). */
export function startFromTemplate(hub: Hub, id: string, t: TaskTemplate): void {
  const item = hub.item(id);
  if (!item) return;
  if (t.notes && !item.notes) hub.updateItem(id, { notes: t.notes });
  const have = new Set(hub.childrenOf(id).map((c) => c.title.trim().toLowerCase()));
  for (const step of t.steps ?? []) {
    const title = step.trim();
    if (title && !have.has(title.toLowerCase())) hub.addItem(item.listId, { title, parentId: id });
  }
}

/**
 * Give a task that's already there what its folder's template sets (what a new task there would
 * start with): it adds the template's tags to its own, and sets the rest. Returns the undo.
 */
export function applyTemplate(hub: Hub, id: string, listId: string): () => void {
  const item = hub.item(id);
  const list = hub.list(listId);
  if (!item || !hasTemplate(list)) return () => undefined;
  const t = list.template;
  const was = {
    assignee: item.assignee ?? null,
    needsOk: !!item.needsOk,
    urgent: !!item.urgent,
    remind: item.remind ?? null,
    repeat: item.repeat ?? null,
    due: item.due ?? null,
    vis: itemVisChoice(hub, item),
  };
  const undoTags = t.tags?.length ? hub.setTags(id, [...new Set([...hub.tagsOf(item), ...t.tags.filter((x) => !!hub.tag(x))])]) : null;
  if (t.visibility && t.visibility !== was.vis && allowedVis(hub, list).includes(t.visibility) && hub.canSetPrivacy(item)) setItemVis(hub, id, t.visibility);
  if (t.assignee !== undefined && t.assignee !== null && t.assignee !== was.assignee) hub.assign(id, t.assignee, { needsOk: t.needsOk ?? undefined });
  const patch: Record<string, unknown> = {};
  if (t.urgent && !was.urgent) patch.urgent = true;
  if (t.remind != null && was.remind == null) patch.remind = t.remind;
  if (t.repeat && !was.repeat) {
    patch.repeat = t.repeat;
    if (!was.due) patch.due = firstDue(t.repeat, today());
  }
  if (!was.due && !patch.due && t.dueIn != null) patch.due = addDays(today(), t.dueIn);
  if (!item.dueTime && t.dueTime && (was.due || patch.due)) patch.dueTime = t.dueTime;
  if (t.nag && !item.nag && (t.remind != null || was.remind != null)) patch.nag = t.nag;
  if (Object.keys(patch).length) hub.updateItem(id, patch);
  const kidsBefore = new Set(hub.childrenOf(id).map((c) => c.id));
  const notesBefore = item.notes ?? null;
  startFromTemplate(hub, id, t);
  return () => {
    hub.updateItem(id, { urgent: was.urgent, remind: was.remind, repeat: was.repeat, due: was.due, dueTime: item.dueTime ?? null, nag: item.nag ?? null, notes: notesBefore });
    for (const c of hub.childrenOf(id)) if (!kidsBefore.has(c.id)) hub.delete(c.id);
    if ((hub.item(id)?.assignee ?? null) !== was.assignee) hub.assign(id, was.assignee, { needsOk: was.needsOk });
    const now = hub.item(id);
    if (now && itemVisChoice(hub, now) !== was.vis) setItemVis(hub, id, was.vis);
    undoTags?.();
  };
}

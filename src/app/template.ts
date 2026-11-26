import type { Hub } from '../core/actions';
import type { List, TaskTemplate } from '../core/model';
import { firstDue } from '../smart/recurrence';
import { today } from '../core/dates';
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
  if (t.visibility) bits.push(t.visibility === 'ours' ? 'Ours' : t.visibility === 'mine' ? 'Mine' : t.visibility === 'private' ? 'Private' : 'Theirs');
  return bits.join(' · ');
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
  if (Object.keys(patch).length) hub.updateItem(id, patch);
  return () => {
    hub.updateItem(id, { urgent: was.urgent, remind: was.remind, repeat: was.repeat, due: was.due });
    if ((hub.item(id)?.assignee ?? null) !== was.assignee) hub.assign(id, was.assignee, { needsOk: was.needsOk });
    const now = hub.item(id);
    if (now && itemVisChoice(hub, now) !== was.vis) setItemVis(hub, id, was.vis);
    undoTags?.();
  };
}

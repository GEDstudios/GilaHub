/**
 * Who sees a thing, whose it is, and who asked whom: the one place the app
 * decides how privacy and requests read (docs/04-FEATURES.md, "Ours, Mine and Only me").
 * Pure functions over the Hub, so rows, chips, sheets and tests all agree.
 */
import type { Hub, ItemVisibility } from '../core/hub';
import type { Item, List, Member } from '../core/model';
import type { IconName } from './ui/icons.gen';
import { G } from './ui/glyphs';

/** "theirs" = Mine, but my partner's. */
export type VisChoice = 'ours' | 'mine' | 'theirs' | 'private';

export const VIS_ICON: Record<VisChoice, IconName> = { ours: G.ours, mine: G.mine, theirs: G.theirs, private: G.private };

/** What a new thing in this project is, unless someone says otherwise. */
export function listDefaultVis(hub: Hub, list: Pick<List, 'visibility' | 'owner'> | undefined): VisChoice {
  if (!list || list.visibility === 'shared') return 'ours';
  if (list.visibility === 'private') return 'private';
  return !list.owner || list.owner === hub.meId ? 'mine' : 'theirs';
}

/** "Ours", "Mine", "Hila’s" or "Private", for a project. */
export function listVisLabel(hub: Hub, list: Pick<List, 'visibility' | 'owner'>): string {
  return visLabel(listDefaultVis(hub, list), hub.member(list.owner)?.name);
}

/** The choices an item in this project (under this parent) can take, the project's default first. */
export function allowedVis(hub: Hub, list: Pick<List, 'visibility' | 'owner'> | undefined, parent?: Item | null): VisChoice[] {
  if (list?.visibility === 'private' || (parent && hub.visibilityOf(parent) === 'private')) return ['private'];
  const paired = !!hub.partner();
  const def = listDefaultVis(hub, list);
  // In my partner's "Mine" project: theirs, ours or mine, but hiding things there isn't mine to do.
  if (def === 'theirs') return ['theirs', 'ours', 'mine'];
  const all: VisChoice[] = def === 'mine' ? ['mine', 'ours', 'theirs', 'private'] : ['ours', 'mine', 'theirs', 'private'];
  return paired ? all : all.filter((v) => v !== 'theirs');
}

/** The item's privacy as a choice: "Mine" that isn't mine reads as theirs. */
export function itemVisChoice(hub: Hub, item: Item): VisChoice {
  const v = hub.visibilityOf(item);
  if (v !== 'mine') return v;
  const owner = hub.ownerOf(item);
  return owner && owner !== hub.meId ? 'theirs' : 'mine';
}

/** Is it on my side: my own (Mine) or only mine to see (Private), not the house's or my person's. */
export function isMineSide(hub: Hub, item: Item): boolean {
  const c = itemVisChoice(hub, item);
  return c === 'mine' || c === 'private';
}

/** What a row's privacy tag says, or null when it matches its project (or its parent, for steps). */
export function visTagFor(hub: Hub, item: Item): VisChoice | null {
  const v = itemVisChoice(hub, item);
  const parent = hub.item(item.parentId);
  const context = parent ? itemVisChoice(hub, parent) : listDefaultVis(hub, hub.list(item.listId));
  return v === context ? null : v;
}

/** A choice as the Hub's item fields: "theirs" is Mine with my partner as the owner. */
export function visFields(hub: Hub, v: VisChoice): { visibility: ItemVisibility; owner?: string } {
  if (v === 'theirs') return { visibility: 'mine', owner: hub.partner()?.id };
  if (v === 'mine') return { visibility: 'mine', owner: hub.meId };
  return { visibility: v };
}

/** Change an existing item's privacy to a choice. */
export function setItemVis(hub: Hub, id: string, v: VisChoice): void {
  const f = visFields(hub, v);
  hub.setItemVisibility(id, f.visibility, f.owner);
}

export function visLabel(v: VisChoice, partnerName?: string | null): string {
  if (v === 'ours') return 'Ours';
  if (v === 'mine') return 'Mine';
  if (v === 'private') return 'Private';
  return partnerName ? `${partnerName}’s` : 'Theirs';
}

/** One calm line under the choice. `partnerName` null = still on my own. */
export function visHint(v: VisChoice, partnerName: string | null): string {
  if (partnerName === null) {
    if (v === 'ours') return 'Shared with your person once they join.';
    if (v === 'mine') return 'Yours. Your person will see it and can help.';
    if (v === 'private') return 'Never shared, even after your person joins.';
    return '';
  }
  const p = partnerName;
  if (v === 'ours') return 'For both of you. Either can tick it.';
  if (v === 'mine') return `Yours. ${p} can see it and help.`;
  if (v === 'theirs') return `${p}’s to own. To have ${p} do it, use Who → Ask ${p}.`;
  return `Hidden from ${p}. Encrypted.`;
}

/**
 * asked-them  I asked my partner; still open.
 * they-asked  My partner asked me; still open.
 * ok-needed   My partner says my ask is done; my OK is next.
 * waiting-ok  I did my partner's ask; waiting for their OK.
 * sent-back   I did my partner's ask and they said "Not yet"; it's mine again.
 */
export type ReqKind = 'asked-them' | 'they-asked' | 'ok-needed' | 'waiting-ok' | 'sent-back';
export interface ReqState {
  kind: ReqKind;
  other: Member | undefined;
  needsOk: boolean;
}

/**
 * Where a request stands, from my side. Repeating things given to someone are a
 * standing assignment rather than an ask, so they carry no request state.
 */
export function requestState(hub: Hub, item: Item): ReqState | null {
  if (!item.requestedBy || item.done || item.repeat) return null;
  const needsOk = !!item.needsOk;
  if (item.requestedBy === hub.meId) {
    if (item.submittedAt) return { kind: 'ok-needed', other: hub.member(item.submittedBy), needsOk };
    const asked = typeof item.assignee === 'string' ? hub.member(item.assignee) : undefined;
    return { kind: 'asked-them', other: asked, needsOk };
  }
  const asker = hub.member(item.requestedBy);
  return { kind: item.submittedAt ? 'waiting-ok' : item.sentBackAt ? 'sent-back' : 'they-asked', other: asker, needsOk };
}

export function reqLabel(s: ReqState): string {
  const p = s.other?.name;
  if (s.kind === 'asked-them') return `Asked ${p ?? 'them'}${s.needsOk ? ' · needs OK' : ''}`;
  if (s.kind === 'they-asked') return `${p ?? 'They'} asked`;
  if (s.kind === 'ok-needed') return `${p ?? 'They'} did it · OK?`;
  if (s.kind === 'sent-back') return `${p ?? 'They'} said not yet`;
  return `Waiting for ${p ? `${p}’s` : 'their'} OK`;
}

/**
 * Who does it, as a row's avatar: the turn holder when taking turns, or the person it's
 * given to when it isn't an ask (the request tag says that). Never the owner: the privacy tag does.
 */
export function doerOf(hub: Hub, item: Item): Member | undefined {
  if (item.assignee === 'turns') return hub.member(item.turn);
  if (!item.assignee || item.assignee === 'both' || requestState(hub, item)) return undefined;
  return hub.member(item.assignee);
}

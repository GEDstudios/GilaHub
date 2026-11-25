import type { Hub } from '../core/actions';
import type { Item } from '../core/model';
import { notifyMembers, type Runtime } from './runtime';

/** Tell my partner about a request — never for "Only me" things. */
export function notifyAbout(rt: Runtime, hub: Hub, item: Item, to: string | null | undefined, title: string, body: string): void {
  if (!to || to === hub.meId || hub.visibilityOf(item) === 'private') return;
  void notifyMembers(rt, [to], { title, body, url: `/i/${item.id}`, tag: `req-${item.id}` });
}

/** After a tick: if it became a request waiting for an OK, ping the asker. */
export function afterTick(rt: Runtime, hub: Hub, id: string): string | null {
  const it = hub.item(id);
  if (!it) return null;
  if (it.submittedAt && it.submittedBy === hub.meId && it.requestedBy) {
    const asker = hub.member(it.requestedBy);
    notifyAbout(rt, hub, it, it.requestedBy, `${hub.me()?.name ?? 'Your partner'} did it`, `“${it.title}” is waiting for your OK`);
    return `Sent to ${asker?.name ?? 'them'} for an OK`;
  }
  if (it.done && it.requestedBy && it.requestedBy !== hub.meId) {
    notifyAbout(rt, hub, it, it.requestedBy, `${hub.me()?.name ?? 'Your partner'} did it`, `“${it.title}” is done`);
  }
  return null;
}

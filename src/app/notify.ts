import type { Hub } from '../core/actions';
import type { Item } from '../core/model';
import { enablePush, notifyMembers, type Runtime } from './runtime';

/**
 * Should `to` hear about this request? Not me, never for "Only me" things, and not when they
 * turned request alerts off in Settings (Member.requestAlerts, read here by the sender).
 */
export function wantsRequestAlert(hub: Hub, item: Item, to: string | null | undefined): to is string {
  if (!to || to === hub.meId || hub.visibilityOf(item) === 'private') return false;
  return hub.member(to)?.requestAlerts !== false;
}

/** Tell my partner about a request. */
export function notifyAbout(rt: Runtime, hub: Hub, item: Item, to: string | null | undefined, title: string, body: string): void {
  if (!wantsRequestAlert(hub, item, to)) return;
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

/** A reminder was just set: make sure it can reach this phone, and say so when it can't. */
export function setUpReminders(rt: Runtime, toast: (msg: string) => void): void {
  void enablePush(rt).then((s) => {
    if (s === 'install') toast('Add Gila Hub to your Home Screen to get reminders on iPhone.');
    else if (s === 'denied') toast('Notifications are blocked in your settings. Reminders will show in the app.');
    else if (s === 'no-relay') toast('Reminder set. It pops up while Gila Hub is open.');
  });
}

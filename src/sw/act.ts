/**
 * A notification's Done / Tomorrow, without opening the app: the service worker loads our
 * data from this phone (IndexedDB), makes the change the way the app would (Hub.toggle,
 * Hub.snooze), saves it, sends it (a short sync), and puts the task's reminders on the relay
 * right (no more "again until done" for a done thing). Bundled into the worker as
 * `self.GilaAct` (vite.config.ts); used only when no window of the app is open to do it.
 */
import { Hub } from '../core/hub';
import { addDays, today } from '../core/dates';
import { IdbPersistence } from '../core/db';
import { authToken, keyring, loadSession, readableScopes } from '../core/session';
import { Store } from '../core/store';
import { SyncClient } from '../core/sync';
import { afterTick } from '../app/notify';
import { ReminderSync } from '../app/reminders';
import type { Runtime } from '../app/runtime';

export type Act = 'done' | 'later';

/** Returns the thing's title (for the "✓ Done" note), or null when there was nothing to do. */
export async function act(kind: Act, itemId: string, opts: { send?: boolean; factory?: IDBFactory } = {}): Promise<{ title: string; did: boolean } | null> {
  const persistence = await IdbPersistence.open(opts.factory);
  const session = await loadSession(persistence);
  if (!session) return null;
  const store = await Store.load(persistence, session.deviceId, readableScopes(session));
  const hub = new Hub(store, session.memberId);
  const item = hub.item(itemId);
  if (!item) return null;
  let did = false;
  if (kind === 'done' && !item.done && hub.canEdit(item)) {
    hub.toggle(itemId);
    did = true;
  } else if (kind === 'later') {
    hub.snooze(itemId, addDays(today(), 1));
    did = true;
  }
  await store.settled();
  if (!did || opts.send === false) return { title: item.title, did };

  // Send it now, if the relay is there; if not, the app sends it next time it opens.
  const rt: Runtime = { persistence, session, store, hub, sync: null, relay: true, ensureSync: async () => {}, onRelay: () => () => {} };
  try {
    const sync = new SyncClient(store, persistence, {
      apiBase: session.apiBase,
      householdId: session.householdId,
      token: await authToken(session),
      deviceId: session.deviceId,
      memberId: session.memberId,
      keyring: keyring(session),
    });
    rt.sync = sync;
    await sync.start();
    await until(() => store.outboxSize() === 0, 8000);
    // Done something they asked for: they hear about it, as from the app.
    if (kind === 'done') afterTick(rt, hub, itemId);
    await new ReminderSync(rt).run();
    sync.stop();
  } catch {
    /* offline: it waits in the outbox */
  }
  return { title: item.title, did };
}

function until(ok: () => boolean, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => (ok() || Date.now() - t0 > ms ? resolve() : setTimeout(tick, 120));
    tick();
  });
}

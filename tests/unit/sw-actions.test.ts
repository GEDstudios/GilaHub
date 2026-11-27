import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { Hub } from '../../src/core/hub';
import { addDays, today } from '../../src/core/dates';
import { IdbPersistence } from '../../src/core/db';
import { newSession, readableScopes, saveSession } from '../../src/core/session';
import { Store } from '../../src/core/store';
import { act } from '../../src/sw/act';

/** The app writes a task to this phone's database, as it does. */
async function phone() {
  const factory = new IDBFactory();
  const p = await IdbPersistence.open(factory);
  const session = newSession();
  await saveSession(p, session);
  const store = await Store.load(p, session.deviceId, readableScopes(session));
  const hub = new Hub(store, session.memberId);
  const list = hub.createList({ name: 'Home', kind: 'tasks' });
  const id = hub.addItem(list, { title: 'Call the bank', due: today(), remind: 0 });
  await store.settled();
  const reopen = async () => {
    const q = await IdbPersistence.open(factory);
    const s = await Store.load(q, session.deviceId, readableScopes(session));
    return { hub: new Hub(s, session.memberId), store: s };
  };
  return { factory, id, reopen };
}

describe('a notification’s buttons, without the app', () => {
  it('Done ticks it off on this phone, waiting to be sent', async () => {
    const { factory, id, reopen } = await phone();
    const r = await act('done', id, { factory, send: false });
    expect(r).toEqual({ title: 'Call the bank', did: true });
    const { hub, store } = await reopen();
    expect(hub.item(id)?.done).toBe(true);
    expect(store.outboxSize()).toBeGreaterThan(0);
    // Twice is still once.
    expect((await act('done', id, { factory, send: false }))?.did).toBe(false);
  });

  it('Tomorrow moves it to tomorrow', async () => {
    const { factory, id, reopen } = await phone();
    await act('later', id, { factory, send: false });
    const { hub } = await reopen();
    expect(hub.item(id)?.due).toBe(addDays(today(), 1));
    expect(hub.item(id)?.done).toBeFalsy();
  });
});

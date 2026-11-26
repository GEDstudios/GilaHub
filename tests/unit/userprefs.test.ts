import { beforeEach, describe, expect, it } from 'vitest';
import { Hub } from '../../src/core/actions';
import { MemoryPersistence } from '../../src/core/db';
import { Store } from '../../src/core/store';
import { applyPrefs, getPrefs, setPrefs } from '../../src/app/prefs';
import { bindUserPrefs } from '../../src/app/userPrefs';

async function device(member: string, dev: string, scopes: string[]) {
  const store = await Store.load(new MemoryPersistence(), dev, scopes as never);
  return new Hub(store, member);
}

function sync(...hubs: Hub[]) {
  for (let round = 0; round < 3; round++) {
    for (const from of hubs) {
      const entries = from.store.pendingOutbox();
      for (const to of hubs) {
        if (to === from) continue;
        to.store.applyRemoteBatch(entries.filter((e) => to.store.canRead(e.s)).map((e) => e.op));
      }
      from.store.ack(entries.map((e) => e.cid));
    }
  }
}

describe('My preferences follow me, not the phone', () => {
  beforeEach(() => applyPrefs({ todayScope: 'all', todayNew: 'mine', filters: {} }));

  it('what I set on one device is there on my other one; my person can’t read it', async () => {
    const phone = await device('guy', 'phone', ['h', 'p:guy']);
    const laptop = await device('guy', 'laptop', ['h', 'p:guy']);
    const hila = await device('hila', 'hila', ['h', 'p:hila']);
    const off = bindUserPrefs(phone);
    setPrefs({ todayScope: 'ours', filters: { today: { tags: [], who: 'me', urgent: true } } });
    off();
    sync(phone, laptop, hila);
    expect(laptop.store.get('settings', 'prefs:guy')).toMatchObject({ todayScope: 'ours' });
    expect(hila.store.get('settings', 'prefs:guy')).toBeUndefined();
    // The laptop takes them when it binds.
    applyPrefs({ todayScope: 'all', filters: {} });
    const off2 = bindUserPrefs(laptop);
    expect(getPrefs().todayScope).toBe('ours');
    expect(getPrefs().filters.today?.urgent).toBe(true);
    off2();
  });
});

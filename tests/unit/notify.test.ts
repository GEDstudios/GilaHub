import { beforeEach, describe, expect, it, vi } from 'vitest';

// notify.ts sends through runtime.notifyMembers; record the calls instead of reaching a relay.
const sent: Array<{ to: string[]; title: string }> = [];
vi.mock('../../src/app/runtime', () => ({
  notifyMembers: async (_rt: unknown, to: string[], note: { title: string }) => {
    sent.push({ to, title: note.title });
  },
  enablePush: async () => 'on',
}));

import { afterTick, notifyAbout, wantsRequestAlert } from '../../src/app/notify';
import type { Runtime } from '../../src/app/runtime';
import { listNamed, pairedPhone } from './_helpers';

/** Guy and Hila on one store: enough for who-hears-what. */
async function couple() {
  const hub = await pairedPhone({ color: 'lemon', seed: ['todo'] });
  return { hub, todo: listNamed(hub, 'To do') };
}

const rt = {} as Runtime;

describe('request alerts (Member.requestAlerts, read by the sender)', () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it('asks reach my person by default', async () => {
    const { hub, todo } = await couple();
    const it = hub.item(hub.addItem(todo.id, { title: 'Fix the kettle', assignee: 'hila' }))!;
    expect(it.requestedBy).toBe('guy');
    expect(wantsRequestAlert(hub, it, 'hila')).toBe(true);
    notifyAbout(rt, hub, it, 'hila', 'Guy asked you', it.title);
    await Promise.resolve();
    expect(sent).toEqual([{ to: ['hila'], title: 'Guy asked you' }]);
  });

  it('sends nothing to someone who turned request alerts off', async () => {
    const { hub, todo } = await couple();
    hub.upsertMember('hila', { requestAlerts: false });
    const it = hub.item(hub.addItem(todo.id, { title: 'Fix the kettle', assignee: 'hila' }))!;
    expect(wantsRequestAlert(hub, it, 'hila')).toBe(false);
    notifyAbout(rt, hub, it, 'hila', 'Guy asked you', it.title);
    await Promise.resolve();
    expect(sent).toEqual([]);
  });

  it('keeps "did it" quiet too for an asker who turned them off; never pings me or "Only me" things', async () => {
    const { hub, todo } = await couple();
    hub.upsertMember('hila', { requestAlerts: false });
    // Hila asked Guy; Guy does it: Hila would hear "Guy did it".
    const id = hub.addItem(todo.id, { title: 'Water the plants', assignee: 'guy' });
    hub.store.mutate('item', id, { requestedBy: 'hila' });
    hub.toggle(id);
    afterTick(rt, hub, id);
    await Promise.resolve();
    expect(sent).toEqual([]);
    hub.upsertMember('hila', { requestAlerts: true });
    afterTick(rt, hub, id);
    await Promise.resolve();
    expect(sent.map((x) => x.to)).toEqual([['hila']]);
    const mine = hub.item(hub.addItem(todo.id, { title: 'Note to self' }))!;
    expect(wantsRequestAlert(hub, mine, 'guy')).toBe(false);
    const secret = hub.item(hub.addItem(todo.id, { title: 'Ring', visibility: 'private' }))!;
    expect(wantsRequestAlert(hub, secret, 'hila')).toBe(false);
  });
});

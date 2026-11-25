import { beforeEach, describe, expect, it, vi } from 'vitest';

// notify.ts sends through runtime.notifyMembers; record the calls instead of reaching a relay.
const sent: Array<{ to: string[]; title: string }> = [];
vi.mock('../../src/app/runtime', () => ({
  notifyMembers: async (_rt: unknown, to: string[], note: { title: string }) => {
    sent.push({ to, title: note.title });
  },
  enablePush: async () => 'on',
}));

import { Hub, seedHousehold } from '../../src/core/actions';
import { MemoryPersistence } from '../../src/core/db';
import { Store } from '../../src/core/store';
import { afterTick, notifyAbout, wantsRequestAlert } from '../../src/app/notify';
import type { Runtime } from '../../src/app/runtime';
import { awaySub, backupSub, needsBackup, syncLabel, togetherSince, usSentence, welcomeBack } from '../../src/app/settingsCopy';
import { DEFAULT_PINS, isDefaultPins } from '../../src/app/tabs';
import { checkForUpdate, type RegistrationLike, type WorkerLike } from '../../src/app/update';

async function person(member: string) {
  const store = await Store.load(new MemoryPersistence(), `dev-${member}`, ['h', `p:${member}`]);
  return new Hub(store, member);
}

/** Guy and Hila on one store: enough for who-hears-what. */
async function couple() {
  const hub = await person('guy');
  hub.upsertMember('guy', { name: 'Guy', color: 'lemon', createdAt: 1 });
  hub.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
  seedHousehold(hub, ['todo']);
  const todo = hub.lists().find((l) => l.name === 'To do')!;
  return { hub, todo };
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

/** A fake new worker that moves through the states it's given, one tick apart. */
function worker(states: string[]): WorkerLike {
  const fns = new Set<() => void>();
  const w: WorkerLike = {
    state: 'installing',
    addEventListener: (_t, fn) => fns.add(fn),
    removeEventListener: (_t, fn) => fns.delete(fn),
  };
  let i = 0;
  const next = () => {
    if (i >= states.length) return;
    w.state = states[i++];
    fns.forEach((fn) => fn());
    setTimeout(next, 1);
  };
  setTimeout(next, 1);
  return w;
}

const reg = (over: Partial<RegistrationLike> = {}): RegistrationLike => ({ update: async () => undefined, installing: null, waiting: null, ...over });

describe('Check for updates says what it found, and never reloads', () => {
  const env = (r: RegistrationLike | null, more: Partial<Parameters<typeof checkForUpdate>[0]> = {}) => ({
    online: true,
    alreadyReady: false,
    registration: async () => r,
    waitMs: 200,
    ...more,
  });

  it('up to date when the worker finds nothing new', async () => {
    let asked = 0;
    expect(await checkForUpdate(env(reg({ update: async () => void asked++ })))).toBe('current');
    expect(asked).toBe(1);
  });

  it('up to date when no worker controls the page (it came from the network)', async () => {
    expect(await checkForUpdate(env(null))).toBe('current');
  });

  it('ready once a found update activates', async () => {
    expect(await checkForUpdate(env(reg({ installing: worker(['installed', 'activating', 'activated']) })))).toBe('ready');
  });

  it('ready when one already took over this session, without asking again', async () => {
    let asked = 0;
    expect(await checkForUpdate(env(reg({ update: async () => void asked++ }), { alreadyReady: true }))).toBe('ready');
    expect(asked).toBe(0);
  });

  it('ready if the new one is still on its way when time runs out', async () => {
    expect(await checkForUpdate(env(reg({ waiting: worker([]) }), { waitMs: 20 }))).toBe('ready');
  });

  it('offline, failed, and a broken update', async () => {
    expect(await checkForUpdate(env(reg(), { online: false }))).toBe('offline');
    expect(await checkForUpdate(env(reg({ update: () => Promise.reject(new Error('net')) })))).toBe('failed');
    expect(await checkForUpdate(env(reg({ installing: worker(['redundant']) })))).toBe('failed');
  });
});

describe('Settings copy', () => {
  const now = new Date(2026, 10, 25, 12).getTime();

  it('the card says who we are and since when', () => {
    expect(usSentence(null, now)).toBe('Just you for now.');
    expect(usSentence({ name: 'Hila', createdAt: new Date(2026, 10, 2).getTime() }, now)).toBe('You and Hila · together since November');
    expect(togetherSince(new Date(2025, 2, 9).getTime(), now)).toBe('March 2025');
  });

  it('the sync pill', () => {
    expect(syncLabel('synced')).toBe('Synced');
    expect(syncLabel('connecting')).toBe('Syncing…');
    expect(syncLabel('local')).toBe('This phone');
    expect(syncLabel('local', true)).toBe('This device');
    expect(syncLabel('offline')).toBe('Offline');
  });

  it('backups: when the last one was, and when to nudge', () => {
    expect(backupSub(null, now)).toBe('Not yet');
    expect(backupSub(now - 12 * 86_400_000, now)).toBe('Last one: 2 wk ago');
    expect(backupSub(now - 3 * 86_400_000, now)).toBe('Last one: 3 days ago');
    expect(needsBackup(null, now)).toBe(true);
    expect(needsBackup(now - 3 * 86_400_000, now)).toBe(false);
    expect(needsBackup(now - 8 * 86_400_000, now)).toBe(true);
  });

  it('away mode: what it does, since when, who, and how far the chores moved', () => {
    expect(awaySub(null, 'guy', 'Hila', '2026-11-25')).toBe('Pause chore clocks while you’re both away');
    expect(awaySub({ since: '2026-11-25', by: 'guy' }, 'guy', 'Hila', '2026-11-25')).toBe('Since today · chores are paused');
    expect(awaySub({ since: '2026-11-24', by: 'hila' }, 'guy', 'Hila', '2026-11-25')).toBe('Since Tue · chores are paused · Hila turned it on');
    expect(welcomeBack('2026-11-25', '2026-11-25')).toBe('Welcome back.');
    expect(welcomeBack('2026-11-24', '2026-11-25')).toBe('Welcome back. Chores moved by 1 day.');
    expect(welcomeBack('2026-11-20', '2026-11-25')).toBe('Welcome back. Chores moved by 5 days.');
  });

  it('the bar offers "Back to the default" only once it changed', () => {
    expect(isDefaultPins(DEFAULT_PINS)).toBe(true);
    expect(isDefaultPins(['chores', 'shop'])).toBe(false);
    expect(isDefaultPins([...DEFAULT_PINS, 'search'])).toBe(false);
  });
});

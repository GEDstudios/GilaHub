import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPrefs, getPrefs, setPrefs, setPrefsWriter, type Prefs } from '../../src/app/prefs';
import { startRuntime, type Runtime } from '../../src/app/runtime';
import { pinsOf } from '../../src/app/tabs';
import { bindUserPrefs } from '../../src/app/userPrefs';
import { newKeyMaterial } from '../../src/core/crypto';
import { MemoryPersistence, type Persistence } from '../../src/core/db';
import type { Hub } from '../../src/core/hub';
import { listKey } from '../../src/core/keys';
import { saveSession, type Session } from '../../src/core/session';
import { person } from './_helpers';
import { quiet, Relay, until } from './_relay';

/**
 * A device opening the app (startRuntime) against a relay that already holds what I have: the
 * first thing it does must be to take that, never to write its own "firsts" over it.
 */

const HH = 'hh';
/** A device's own preferences before it has taken mine: the app's defaults. */
const DEFAULTS: Partial<Prefs> = { todayScope: 'all', todayNew: 'mine', quick: [], filters: {}, savedLists: {}, unfolded: [], dismissed: {} };
const MINE: Partial<Prefs> = { todayScope: 'mine', quick: ['t1', 't2'], savedLists: { a1: { name: 'Work, next week', query: { due: 'nextweek' } } } };

let relay: Relay;
let householdKey: string;
let personalKeys: Record<string, string>;
let open: Runtime[];

const sessionOf = (member: string, device: string): Session => ({
  v: 1,
  householdId: HH,
  householdKey,
  memberId: member,
  personalKey: personalKeys[member],
  deviceId: device,
  apiBase: 'http://relay',
  createdAt: 1,
});

/**
 * Open the app on a device. `joining`: it has just come into the household by an invite or a
 * recovery code (as completeOnboarding saves it); left out, it opens with what's on its disk.
 */
async function start(session: Session, persistence: Persistence = new MemoryPersistence(), joining = false): Promise<Runtime> {
  if (joining) await saveSession(persistence, session, true);
  const rt = await startRuntime(persistence, session);
  open.push(rt);
  return rt;
}

/** The app closed on that device (its disk stays). */
async function close(rt: Runtime): Promise<void> {
  rt.sync?.stop();
  setPrefsWriter(null);
  await quiet();
  await rt.store.settled();
}

/** Everything it had to take and to send has gone through. */
async function synced(rt: Runtime): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await until(() => rt.sync?.status === 'synced' && rt.store.outboxSize() === 0, 2000, 'synced');
    await quiet();
  }
}

/**
 * Guy's phone, in use for a while: the household (from before he had a To-Do of his own), then
 * his private To-Do, renamed and recoloured, his pins, and his preferences. All on the relay.
 */
async function guysPhone(): Promise<Hub> {
  const phone = await person('guy', { device: 'phone' });
  phone.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
  phone.ensureShopRoot();
  const trip = phone.createList({ name: 'Trip' });
  for (const title of ['Passport', 'Tickets', 'Charger']) phone.addItem(trip, { title });
  const todo = phone.ensurePersonalFolder()!;
  phone.updateList(todo, { name: 'Just me', color: 'pink', icon: 'i:heart' });
  phone.upsertMember('guy', { tabs: [listKey(trip), listKey(todo)] });
  const off = bindUserPrefs(phone);
  setPrefs(MINE);
  off();
  await relay.sync(phone);
  // Another device, later: its clock is ahead of everything the phone wrote.
  applyPrefs(DEFAULTS);
  await quiet(5);
  return phone;
}

const prefsOn = (hub: Hub) => hub.store.get('settings', `prefs:${hub.meId}`) as Record<string, unknown> | undefined;
const look = (hub: Hub) => {
  const l = hub.list(hub.personalFolderId());
  return l && { name: l.name, color: l.color, icon: l.icon, order: l.order, tabs: hub.me()?.tabs };
};

beforeEach(() => {
  householdKey = newKeyMaterial();
  personalKeys = { guy: newKeyMaterial(), hila: newKeyMaterial() };
  // Small pages: what I have comes in several, as it does once there is a lot of it.
  relay = new Relay(HH, { h: householdKey, 'p:guy': personalKeys.guy, 'p:hila': personalKeys.hila }, 3);
  relay.install();
  open = [];
  setPrefsWriter(null);
  applyPrefs(DEFAULTS);
});

afterEach(() => {
  for (const rt of open) rt.sync?.stop();
  setPrefsWriter(null);
  vi.unstubAllGlobals();
});

describe('A new device of mine (Add a device, or my recovery code)', () => {
  it('takes my preferences; it never puts its defaults over them', async () => {
    const phone = await guysPhone();
    const laptop = await start(sessionOf('guy', 'laptop'), undefined, true);
    await synced(laptop);
    await relay.sync(phone);
    expect(prefsOn(phone)).toMatchObject(MINE);
    expect(prefsOn(laptop.hub)).toMatchObject(MINE);
    // …and they're how the laptop looks now.
    expect(getPrefs()).toMatchObject(MINE);
    // From here on they follow me both ways.
    setPrefs({ todayScope: 'all' });
    await synced(laptop);
    await relay.sync(phone);
    expect(prefsOn(phone)).toMatchObject({ ...MINE, todayScope: 'all' });
  });

  it('finds the To-Do I already have: its name, colour, icon, place and my pins stay', async () => {
    const phone = await guysPhone();
    const mine = look(phone);
    expect(mine).toMatchObject({ name: 'Just me', color: 'pink', icon: 'i:heart' });
    const laptop = await start(sessionOf('guy', 'laptop'), undefined, true);
    await synced(laptop);
    await relay.sync(phone);
    expect(look(phone)).toEqual(mine);
    expect(look(laptop.hub)).toEqual(mine);
  });

  it('writes nothing of its own while what I have is still arriving', async () => {
    await guysPhone();
    relay.budget = 1;
    const laptop = await start(sessionOf('guy', 'laptop'), undefined, true);
    await until(() => relay.served === 1 && laptop.hub.me(), 2000, 'the first page');
    await quiet();
    // The member row is here, the rest isn't.
    expect(laptop.hub.me()).toMatchObject({ name: 'Guy' });
    expect(laptop.hub.me()?.personalFolder).toBeUndefined();
    expect(laptop.store.outboxSize()).toBe(0);
  });

  it('closed before it had everything, it still waits when it is opened again', async () => {
    const phone = await guysPhone();
    const mine = look(phone);
    const disk = new MemoryPersistence();
    relay.budget = 1;
    const first = await start(sessionOf('guy', 'laptop'), disk, true);
    await until(() => relay.served === 1, 2000, 'the first page');
    await close(first);
    relay.budget = Infinity;
    const again = await start(sessionOf('guy', 'laptop'), disk);
    await synced(again);
    await relay.sync(phone);
    expect(prefsOn(phone)).toMatchObject(MINE);
    expect(look(phone)).toEqual(mine);
    expect(getPrefs()).toMatchObject(MINE);
    // Once it has everything it's a device like any other: opened again, with no hub to reach, it binds at once.
    await close(again);
    relay.up = false;
    const third = await start(sessionOf('guy', 'laptop'), disk);
    await quiet();
    setPrefs({ todayNew: 'ours' });
    expect(prefsOn(third.hub)).toMatchObject({ ...MINE, todayNew: 'ours' });
  });

  it('the hub out of reach right after joining: nothing is written until it has synced', async () => {
    const phone = await guysPhone();
    const mine = look(phone);
    relay.up = false;
    const laptop = await start(sessionOf('guy', 'laptop'), undefined, true);
    await quiet();
    expect(laptop.sync).toBeNull();
    expect(laptop.store.outboxSize()).toBe(0);
    // Back in reach (the app asks again each minute, and when it's back online).
    relay.up = true;
    await laptop.ensureSync();
    await synced(laptop);
    await relay.sync(phone);
    expect(prefsOn(phone)).toMatchObject(MINE);
    expect(look(phone)).toEqual(mine);
    expect(getPrefs()).toMatchObject(MINE);
  });
});

describe('My person joins (an invite)', () => {
  it('her To-Do is made once the household is here: first among the folders, pinned in front of Shopping', async () => {
    const phone = await guysPhone();
    const hila = await start(sessionOf('hila', 'hila-phone'), undefined, true);
    // As completeOnboarding does: she is written at once, before anything has arrived.
    hila.hub.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    await synced(hila);
    expect(hila.hub.list('todohila')).toMatchObject({ name: 'To-Do', visibility: 'private', personal: true });
    expect(hila.hub.topLists()[0].id).toBe('todohila');
    expect(pinsOf(hila.hub)).toEqual([listKey('todohila'), listKey(hila.hub.shopRoot()!.id)]);
    // Her preferences are hers from here on (and Guy's phone can't read them).
    setPrefs({ todayScope: 'mine' });
    await synced(hila);
    await relay.sync(phone);
    expect(prefsOn(hila.hub)).toMatchObject({ todayScope: 'mine' });
    expect(phone.store.get('settings', 'prefs:hila')).toBeUndefined();
    expect(phone.list('todohila')).toBeUndefined();
  });
});

describe('Opening with nothing to wait for', () => {
  /** Guy starts a household on this device (completeOnboarding, kind 'new'). */
  async function founder(disk: Persistence): Promise<Runtime> {
    const rt = await start(sessionOf('guy', 'phone'), disk);
    rt.hub.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    rt.hub.createList({ name: 'Trip' });
    return rt;
  }

  it('on this device only (no hub): my To-Do is made and my preferences are bound at once', async () => {
    relay.up = false;
    const rt = await founder(new MemoryPersistence());
    await quiet();
    expect(rt.sync).toBeNull();
    expect(rt.hub.topLists()[0]).toMatchObject({ id: 'todoguy', name: 'To-Do' });
    expect(pinsOf(rt.hub)[0]).toBe(listKey('todoguy'));
    setPrefs({ quick: ['t9'] });
    expect(prefsOn(rt.hub)).toMatchObject({ quick: ['t9'] });
  });

  it('a household I start with a hub: the same, without waiting for the hub', async () => {
    relay.budget = 0;
    const rt = await founder(new MemoryPersistence());
    await until(() => rt.sync, 2000, 'the sync client');
    await quiet();
    expect(rt.hub.topLists()[0]).toMatchObject({ id: 'todoguy', name: 'To-Do' });
    setPrefs({ quick: ['t9'] });
    expect(prefsOn(rt.hub)).toMatchObject({ quick: ['t9'] });
  });

  it.each([
    ['offline', false],
    ['online, the hub out of reach', true],
  ])('a device that has synced before, opened %s: my preferences are bound', async (_, online) => {
    const disk = new MemoryPersistence();
    const before = await founder(disk);
    await synced(before);
    setPrefs({ todayScope: 'mine' });
    await synced(before);
    await close(before);
    // Opened again, and the hub can't be reached.
    relay.up = false;
    vi.stubGlobal('navigator', { onLine: online });
    const rt = await start(sessionOf('guy', 'phone'), disk);
    await quiet();
    setPrefs({ quick: ['t9'] });
    expect(prefsOn(rt.hub)).toMatchObject({ todayScope: 'mine', quick: ['t9'] });
    // Nothing of mine was made twice.
    expect(rt.hub.lists().filter((l) => l.personal)).toHaveLength(1);
  });
});

/**
 * Shared setup for the unit tests: phones (a Hub on its own in-memory store), the relay between
 * them, and the households most tests start from. Every helper is plain and synchronous where it
 * can be, so a test still reads top to bottom.
 */
import { Hub } from '../../src/core/hub';
import { seedHousehold } from '../../src/core/seed';
import { MemoryPersistence } from '../../src/core/db';
import type { LineColor, Scope } from '../../src/core/model';
import { Store } from '../../src/core/store';

/**
 * One person's phone: a fresh in-memory store that reads the household and their own private scope.
 * `device` and `scopes` are for a second device of the same person, or a phone that can't read
 * everything yet.
 */
export async function person(member: string, opts: { device?: string; scopes?: Scope[] } = {}): Promise<Hub> {
  const store = await Store.load(new MemoryPersistence(), opts.device ?? `dev-${member}`, opts.scopes ?? ['h', `p:${member}`]);
  return new Hub(store, member);
}

/** Relay everything each hub may read, both ways, until quiet. */
export function sync(...hubs: Hub[]): void {
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

export type ListInput = Parameters<Hub['createList']>[0];

/** How one side of a household starts: their color, the starter projects picked, and projects of their own. */
export interface Side {
  color?: LineColor;
  /** Starter projects (seedHousehold keys), picked by whoever starts the household. */
  seed?: string[];
  /** Projects this person makes once they are in. */
  lists?: ListInput[];
}

/** Guy, on his own: member (sky unless said), the starter projects picked, then his own projects. */
export async function solo(guy: Side = {}): Promise<Hub> {
  const hub = await person('guy');
  hub.upsertMember('guy', { name: 'Guy', color: guy.color ?? 'sky', createdAt: 1 });
  if (guy.seed) seedHousehold(hub, guy.seed);
  for (const l of guy.lists ?? []) hub.createList(l);
  return hub;
}

/**
 * Guy starts the household (as `solo`), Hila joins on her own phone (pink unless said) and makes her
 * own projects; everything is synced both ways.
 */
export async function couple(guySide: Side = {}, hilaSide: Omit<Side, 'seed'> = {}): Promise<{ guy: Hub; hila: Hub }> {
  const guy = await solo(guySide);
  const hila = await person('hila');
  sync(guy, hila);
  hila.upsertMember('hila', { name: 'Hila', color: hilaSide.color ?? 'pink', createdAt: 2 });
  for (const l of hilaSide.lists ?? []) hila.createList(l);
  sync(guy, hila);
  return { guy, hila };
}

/** Guy's phone that already knows Hila: both members on one store (enough for who-hears-what). */
export async function pairedPhone(guy: Omit<Side, 'lists'> = {}): Promise<Hub> {
  const hub = await person('guy');
  hub.upsertMember('guy', { name: 'Guy', color: guy.color ?? 'sky', createdAt: 1 });
  hub.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
  if (guy.seed) seedHousehold(hub, guy.seed);
  return hub;
}

/** The project by that name (it must be there). */
export const listNamed = (hub: Hub, name: string) => hub.lists().find((l) => l.name === name)!;

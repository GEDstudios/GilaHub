import { describe, expect, it } from 'vitest';
import { MemoryPersistence } from '../../src/core/db';
import { Store } from '../../src/core/store';
import type { Scope } from '../../src/core/model';
import { keyBetween } from '../../src/core/order';
import { Clock } from '../../src/core/hlc';

async function replica(device: string, member: string) {
  const scopes: Scope[] = ['h', `p:${member}`];
  return Store.load(new MemoryPersistence(), device, scopes);
}

/** A perfect relay: deliver everything `from` has queued that `to` is entitled to receive. */
function deliver(from: Store, ...targets: Store[]) {
  const entries = from.pendingOutbox();
  for (const to of targets) {
    to.applyRemoteBatch(entries.filter((e) => to.canRead(e.s)).map((e) => e.op));
  }
  from.ack(entries.map((e) => e.cid));
}

describe('Store convergence', () => {
  it('merges concurrent edits to different fields', async () => {
    const guy = await replica('dev-guy', 'guy');
    const hila = await replica('dev-hila', 'hila');
    const id = guy.create('item', { title: 'Milk', listId: 'L', done: false });
    deliver(guy, hila);
    guy.mutate('item', id, { qty: '2' });
    hila.mutate('item', id, { urgent: true });
    deliver(guy, hila);
    deliver(hila, guy);
    expect(guy.get('item', id)).toMatchObject({ title: 'Milk', qty: '2', urgent: true });
    expect(hila.get('item', id)).toEqual(guy.get('item', id));
  });

  it('picks the same winner for concurrent writes to one field', async () => {
    const guy = await replica('dev-guy', 'guy');
    const hila = await replica('dev-hila', 'hila');
    const id = guy.create('item', { title: 'Eggs' });
    deliver(guy, hila);
    guy.mutate('item', id, { title: 'Eggs (12)' });
    hila.mutate('item', id, { title: 'Free-range eggs' });
    deliver(guy, hila);
    deliver(hila, guy);
    expect(guy.get('item', id)?.title).toBe(hila.get('item', id)?.title);
  });

  it('is idempotent and order-independent', async () => {
    const a = await replica('a', 'guy');
    const b = await replica('b', 'hila');
    const id = a.create('item', { title: 'One' });
    a.mutate('item', id, { title: 'Two' });
    a.mutate('item', id, { done: true });
    const ops = a.pendingOutbox().map((e) => e.op);
    b.applyRemoteBatch([...ops].reverse());
    b.applyRemoteBatch(ops); // duplicates
    expect(b.get('item', id)).toMatchObject({ title: 'Two', done: true });
  });

  it('a repair dated by a clock in the data is the same write everywhere, and anything newer wins', async () => {
    const guy = await replica('dev-guy', 'guy');
    const hila = await replica('dev-hila', 'hila');
    const id = guy.create('item', { title: 'Eggs', parentId: 'P' });
    guy.mutate('item', id, { title: 'Eggs (12)' });
    deliver(guy, hila);
    const h = guy.record('item', id)!.c.title;
    // Each works it out alone: the same value under the same clock, before a word is exchanged.
    expect(guy.amend('item', id, { parentId: null }, h)).toBe(true);
    expect(hila.amend('item', id, { parentId: null }, h)).toBe(true);
    expect(hila.record('item', id)).toEqual(guy.record('item', id));
    // Again changes nothing; a field already written at or after that clock is left alone.
    expect(guy.amend('item', id, { parentId: null, title: 'Eggs?' }, h)).toBe(false);
    expect(guy.get('item', id)?.title).toBe('Eggs (12)');
    // It travels like any write, and hearing it back changes nothing.
    hila.mutate('item', id, { parentId: 'Q' });
    deliver(guy, hila);
    deliver(hila, guy);
    expect(guy.get('item', id)?.parentId).toBe('Q');
    expect(hila.record('item', id)).toEqual(guy.record('item', id));
    expect(guy.amend('item', 'nobody', { parentId: null }, h)).toBe(false);
  });

  it('hides deleted entities but keeps the tombstone', async () => {
    const a = await replica('a', 'guy');
    const id = a.create('item', { title: 'Temp' });
    a.mutate('item', id, { deleted: true });
    expect(a.get('item', id)).toBeUndefined();
    expect(a.record('item', id)?.v.title).toBe('Temp');
  });

  it('persists and reloads', async () => {
    const p = new MemoryPersistence();
    const a = await Store.load(p, 'a', ['h']);
    const id = a.create('list', { name: 'Groceries' });
    await a.settled();
    const again = await Store.load(p, 'a', ['h']);
    expect(again.get('list', id)?.name).toBe('Groceries');
    expect(again.outboxSize()).toBe(1);
  });
});

describe('Privacy scopes', () => {
  it('never sends private content to the partner', async () => {
    const guy = await replica('dev-guy', 'guy');
    const hila = await replica('dev-hila', 'hila');
    const id = guy.create('item', { title: 'placeholder' });
    guy.setScope('item', id, 'p:guy');
    guy.mutate('item', id, { title: 'Ring for Hila 💍' });
    deliver(guy, hila);
    expect(hila.get('item', id)).toBeUndefined();
    expect(JSON.stringify(hila.record('item', id) ?? {})).not.toContain('Ring');
    expect(guy.get('item', id)?.title).toBe('Ring for Hila 💍');
  });

  it('purges an item from the partner when it becomes private', async () => {
    const guy = await replica('dev-guy', 'guy');
    const hila = await replica('dev-hila', 'hila');
    const id = guy.create('item', { title: 'Shared thing' });
    deliver(guy, hila);
    expect(hila.get('item', id)?.title).toBe('Shared thing');
    guy.setScope('item', id, 'p:guy');
    deliver(guy, hila);
    expect(hila.get('item', id)).toBeUndefined();
    expect(hila.record('item', id)?.v.title).toBeUndefined();
  });

  it('does not let stale shared ops resurrect a private item', async () => {
    const guy = await replica('dev-guy', 'guy');
    const hila = await replica('dev-hila', 'hila');
    const id = guy.create('item', { title: 'Plan' });
    deliver(guy, hila);
    // Hila edits while offline…
    hila.mutate('item', id, { notes: 'stale edit' });
    // …meanwhile Guy makes it private.
    guy.setScope('item', id, 'p:guy');
    deliver(guy, hila);
    deliver(hila, guy);
    expect(hila.get('item', id)).toBeUndefined();
    // Guy still receives Hila's (shared-era) edit — last writer wins on his copy.
    expect(guy.get('item', id)?.notes).toBe('stale edit');
  });

  it('reveals full state when a private item becomes shared', async () => {
    const guy = await replica('dev-guy', 'guy');
    const hila = await replica('dev-hila', 'hila');
    const id = guy.create('item', { title: 'x' });
    guy.setScope('item', id, 'p:guy');
    guy.mutate('item', id, { title: 'Surprise trip', notes: 'Paris' });
    deliver(guy, hila);
    expect(hila.get('item', id)).toBeUndefined();
    guy.setScope('item', id, 'h');
    deliver(guy, hila);
    expect(hila.get('item', id)).toMatchObject({ title: 'Surprise trip', notes: 'Paris' });
  });

  it("syncs private items across the owner's own devices", async () => {
    const phone = await replica('guy-phone', 'guy');
    const laptop = await replica('guy-laptop', 'guy');
    const id = phone.create('item', { title: 'x' });
    phone.setScope('item', id, 'p:guy');
    phone.mutate('item', id, { title: 'Therapy notes' });
    deliver(phone, laptop);
    expect(laptop.get('item', id)?.title).toBe('Therapy notes');
  });
});

describe('Fractional order keys', () => {
  it('generates keys between neighbours, forever', () => {
    let lo = keyBetween(null, null);
    let hi = keyBetween(lo, null);
    for (let i = 0; i < 200; i++) {
      const mid = keyBetween(lo, hi);
      expect(lo < mid && mid < hi).toBe(true);
      if (i % 2) lo = mid;
      else hi = mid;
    }
  });

  it('keeps appended keys short', () => {
    let k = keyBetween(null, null);
    for (let i = 0; i < 1000; i++) k = keyBetween(k, null);
    expect(k.length).toBeLessThan(6);
  });

  it('prepends below', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(null, a);
    expect(b < a).toBe(true);
  });

  it('tolerates equal neighbours from concurrent inserts', () => {
    const a = keyBetween(null, null);
    expect(keyBetween(a, a) > a).toBe(true);
  });
});

describe('Hybrid logical clock', () => {
  it('is monotonic even when the wall clock stalls', () => {
    const c = new Clock('n', undefined, () => 1000);
    const a = c.now();
    const b = c.now();
    expect(b > a).toBe(true);
  });

  it('moves past observed remote timestamps', () => {
    let wall = 1000;
    const c = new Clock('a', undefined, () => wall);
    const remote = new Clock('b', undefined, () => 5000).now();
    c.observe(remote);
    wall = 1001;
    expect(c.now() > remote).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { newKeyMaterial, sealJSON } from '../../src/core/crypto';
import { MemoryPersistence, type Commit } from '../../src/core/db';
import { Store } from '../../src/core/store';
import { SyncClient } from '../../src/core/sync';

/** Records commits in the order they start, which is the order IndexedDB runs them in. */
class RecordingPersistence extends MemoryPersistence {
  log: string[] = [];
  /** Hold entity writes until released, like a busy disk. */
  slow = false;
  private waiting: Array<() => void> = [];
  async commit(c: Commit) {
    const isCursor = c.meta && 'cursor' in c.meta;
    this.log.push(isCursor ? 'cursor' : (c.entities ?? []).map((e) => e.id).join(',') || 'other');
    if (this.slow && !isCursor) await new Promise<void>((r) => this.waiting.push(r));
    return super.commit(c);
  }
  release() {
    this.slow = false;
    for (const r of this.waiting.splice(0)) r();
  }
}

class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static last: FakeWS;
  readyState = 1;
  sent: Array<{ type: string }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeWS.last = this;
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.readyState = 3;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function setup() {
  const key = newKeyMaterial();
  const persistence = new RecordingPersistence();
  const store = await Store.load(persistence, 'dev-guy', ['h']);
  const client = new SyncClient(store, persistence, { apiBase: 'http://relay', householdId: 'hh', token: 't'.repeat(30), deviceId: 'dev-guy', memberId: 'guy', keyring: { h: key } }, FakeWS as unknown as typeof WebSocket);
  await client.start();
  FakeWS.last.onopen?.();
  // Hila writes something on her phone; the relay forwards it.
  const hila = await Store.load(new MemoryPersistence(), 'dev-hila', ['h']);
  hila.mutate('item', 'req1', { title: 'Water the balcony plants', listId: 'L', requestedBy: 'hila', assignee: 'guy' });
  const op = hila.pendingOutbox()[0].op;
  const c = await sealJSON(key, op, 'hh|h');
  return { persistence, store, client, deliver: (seq: number) => FakeWS.last.onmessage?.({ data: JSON.stringify({ type: 'ops', ops: [{ seq, k: 'h', c }], cursor: seq }) }) };
}

describe('sync: the cursor never runs ahead of the data', () => {
  it('saves the ops it received before it saves the cursor past them', async () => {
    const { persistence, store, deliver } = await setup();
    persistence.log = [];
    deliver(5);
    for (let i = 0; i < 20 && !persistence.meta.has('cursor'); i++) await tick();
    expect(store.get('item', 'req1')?.title).toBe('Water the balcony plants');
    expect(persistence.log.indexOf('req1')).toBeGreaterThanOrEqual(0);
    expect(persistence.log.indexOf('req1')).toBeLessThan(persistence.log.indexOf('cursor'));
  });

  it('waits for a slow disk: a reload in between would find neither, never just the cursor', async () => {
    const { persistence, deliver } = await setup();
    persistence.slow = true;
    deliver(7);
    for (let i = 0; i < 10; i++) await tick();
    // The app could be closed right now: the cursor must not be on disk yet.
    expect(persistence.meta.get('cursor')).toBeUndefined();
    persistence.release();
    for (let i = 0; i < 20 && !persistence.meta.has('cursor'); i++) await tick();
    expect(persistence.meta.get('cursor')).toBe(7);
    expect(persistence.entities.has('item/req1')).toBe(true);
  });
});

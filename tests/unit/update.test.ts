import { describe, expect, it } from 'vitest';
import { checkForUpdate, type RegistrationLike, type WorkerLike } from '../../src/app/update';

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

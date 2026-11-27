import { describe, expect, it } from 'vitest';
import { person, sync } from './_helpers';

describe('Ongoing (swiped right)', () => {
  it('puts an open top-level task in and takes it out; Undo puts it back', async () => {
    const guy = await person('guy');
    const l = guy.createList({ name: 'To do' });
    const id = guy.addItem(l, { title: 'Paint the hall' });
    const step = guy.addItem(l, { title: 'Buy paint', parentId: id });
    const undo = guy.setOngoing(id, true);
    expect(guy.item(id)).toMatchObject({ ongoingBy: 'guy' });
    expect(guy.item(id)?.ongoingAt).toBeGreaterThan(0);
    undo();
    expect(guy.item(id)?.ongoingAt).toBeNull();
    // A subtask doesn't go in by itself.
    guy.setOngoing(step, true);
    expect(guy.item(step)?.ongoingAt ?? null).toBeNull();
  });

  it('a ticked one stays in until cleared; Clear files it away', async () => {
    const guy = await person('guy');
    const l = guy.createList({ name: 'To do' });
    const id = guy.addItem(l, { title: 'Call the bank' });
    guy.setOngoing(id, true);
    guy.toggle(id);
    expect(guy.item(id)).toMatchObject({ done: true });
    expect(guy.item(id)?.ongoingAt).toBeGreaterThan(0);
    guy.clearDone([l], [id]);
    expect(guy.item(id)?.archived).toBe(true);
  });

  it('a repeating one done this time leaves Ongoing (it is back for next time)', async () => {
    const guy = await person('guy');
    const l = guy.createList({ name: 'Chores' });
    const id = guy.addItem(l, { title: 'Water the plants', due: '2026-11-26', repeat: { type: 'interval', every: 3, unit: 'day', from: 'done' } as never });
    guy.setOngoing(id, true);
    const undo = guy.toggle(id);
    expect(guy.item(id)?.ongoingAt ?? null).toBeNull();
    undo();
    expect(guy.item(id)?.ongoingAt).toBeGreaterThan(0);
  });

  it('my person sees what I am on, and who is on it', async () => {
    const guy = await person('guy');
    const hila = await person('hila');
    const l = guy.createList({ name: 'Home' });
    const id = guy.addItem(l, { title: 'Fix the shelf' });
    sync(guy, hila);
    guy.setOngoing(id, true);
    sync(guy, hila);
    expect(hila.item(id)).toMatchObject({ ongoingBy: 'guy' });
    hila.setOngoing(id, false);
    sync(guy, hila);
    expect(guy.item(id)?.ongoingAt ?? null).toBeNull();
  });
});

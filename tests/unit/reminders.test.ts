import { describe, expect, it } from 'vitest';
import { person } from './_helpers';

describe('notify again until done', () => {
  it('keeps notifying on its rhythm while it is open, and stops when it is done', async () => {
    const { desiredReminders } = await import('../../src/app/reminders');
    const { atLocal } = await import('../../src/core/dates');
    const hub = await person('guy');
    hub.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    const l = hub.createList({ name: 'Home', kind: 'tasks' });
    // Due Mon 23 Nov at 18:00, nagging every day; now is Thu 26 Nov, noon.
    const now = atLocal('2026-11-26', '12:00');
    const id = hub.addItem(l, { title: 'Call the bank', due: '2026-11-23', dueTime: '18:00', remind: 0, nag: { type: 'interval', every: 1, unit: 'day', from: 'schedule' } });
    const days = desiredReminders(hub, now)
      .filter((r) => r.id.startsWith(`${id}.n`))
      .map((r) => r.id.slice(-10));
    expect(days).toEqual(['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01']);
    expect(desiredReminders(hub, now).find((r) => r.id === `${id}.n2026-11-26`)?.note.body).toMatch(/^Still to do · was due/);
    // On set days only (Mon, Thu).
    hub.updateItem(id, { nag: { type: 'weekdays', days: [1, 4] } });
    expect(desiredReminders(hub, now).filter((r) => r.id.startsWith(`${id}.n`)).map((r) => r.id.slice(-10)).slice(0, 3)).toEqual(['2026-11-26', '2026-11-30', '2026-12-03']);
    hub.toggle(id);
    expect(desiredReminders(hub, now).filter((r) => r.id.startsWith(id))).toEqual([]);
  });

  it('on a repeating task: every day until this time is done, never twice on a day it is due anyway', async () => {
    const { desiredReminders } = await import('../../src/app/reminders');
    const { atLocal } = await import('../../src/core/dates');
    const hub = await person('guy');
    const l = hub.createList({ name: 'Home', kind: 'tasks' });
    // Rent: monthly on the 1st; a nudge every day until it's paid.
    const id = hub.addItem(l, { title: 'Pay rent', due: '2026-11-01', remind: 0, repeat: { type: 'monthdays', days: [1] }, nag: { type: 'interval', every: 1, unit: 'day', from: 'schedule' } });
    expect(hub.item(id)?.nag).toMatchObject({ unit: 'day' });
    const now = atLocal('2026-11-26', '12:00');
    const ids = desiredReminders(hub, now).filter((r) => r.id.startsWith(id)).map((r) => r.id);
    expect(ids.filter((x) => x.includes('.n'))).toEqual(['27', '28', '29', '30'].map((d) => `${id}.n2026-11-${d}`).concat([`${id}.n2026-12-02`, `${id}.n2026-12-03`]));
    expect(ids).toContain(`${id}.1`);
    hub.toggle(id);
    // Paid: this month's nagging stops; next month's starts after the 1st.
    expect(hub.item(id)?.due).toBe('2026-12-01');
    expect(desiredReminders(hub, now).filter((r) => r.id.includes('.n'))[0].id).toBe(`${id}.n2026-12-02`);
  });
});

describe('the time a day-only task notifies', () => {
  it('is each person’s own: one reminder each when our times differ, one for both when they match', async () => {
    const { desiredReminders } = await import('../../src/app/reminders');
    const { atLocal } = await import('../../src/core/dates');
    const hub = await person('guy');
    hub.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    hub.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    const l = hub.createList({ name: 'Home', kind: 'tasks' });
    const id = hub.addItem(l, { title: 'Bins out', due: '2026-12-01', remind: 0 });
    const now = atLocal('2026-11-26', '12:00');
    const mine = () => desiredReminders(hub, now).filter((r) => r.id.startsWith(id));
    expect(mine().map((r) => [r.at, r.members])).toEqual([[atLocal('2026-12-01', '09:00'), ['guy', 'hila']]]);
    hub.upsertMember('guy', { remindAt: '07:30' });
    expect(mine().map((r) => [r.at, r.members]).sort()).toEqual([
      [atLocal('2026-12-01', '07:30'), ['guy']],
      [atLocal('2026-12-01', '09:00'), ['hila']],
    ]);
    // A time of its own: that time, for both.
    hub.updateItem(id, { dueTime: '18:00' });
    expect(mine().map((r) => [r.at, r.members])).toEqual([[atLocal('2026-12-01', '18:00'), ['guy', 'hila']]]);
  });
});

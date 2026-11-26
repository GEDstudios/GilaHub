import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hub } from '../../src/core/actions';
import { shortAgo, shortDay } from '../../src/core/dates';
import { MemoryPersistence } from '../../src/core/db';
import { encodeHlc } from '../../src/core/hlc';
import { Store } from '../../src/core/store';
import { ideasMarkdown, ideasUnseen, ideasView } from '../../src/app/views';
import { couple, person, sync } from './_helpers';

const texts = (hub: Hub) => ideasView(hub).open.map((i) => i.text);

let now = 1_000_000;
beforeEach(() => {
  now = Date.UTC(2026, 10, 25, 9);
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
});
afterEach(() => vi.restoreAllMocks());

describe('Ideas: writing', () => {
  it('adds trimmed ideas in household scope, ignoring empty ones', async () => {
    const { guy } = await couple();
    expect(guy.addIdea('   ')).toBeNull();
    const id = guy.addIdea('  Dark-mode toggle for the bar  ')!;
    const idea = guy.idea(id)!;
    expect(idea).toMatchObject({ text: 'Dark-mode toggle for the bar', by: 'guy' });
    expect(idea.order).toBeUndefined();
    expect(guy.store.scopeOf('idea', id)).toBe('h');
  });

  it('both partners read, edit and resolve the same idea', async () => {
    const { guy, hila } = await couple();
    const id = guy.addIdea('Swipe to snooze')!;
    sync(guy, hila);
    expect(texts(hila)).toEqual(['Swipe to snooze']);

    hila.editIdea(id, '  Swipe a row to snooze it ');
    hila.resolveIdea(id);
    sync(guy, hila);
    const seen = guy.idea(id)!;
    expect(seen).toMatchObject({ text: 'Swipe a row to snooze it', editedBy: 'hila', resolvedBy: 'hila' });
    expect(seen.resolvedAt).toBeGreaterThan(seen.createdAt);
    expect(ideasView(guy).open).toEqual([]);
    expect(ideasView(guy).resolved.map((i) => i.id)).toEqual([id]);
  });

  it('marks an edit only when the text changes, and ignores empty edits', async () => {
    const { guy } = await couple();
    const id = guy.addIdea('Bigger checks')!;
    guy.editIdea(id, ' Bigger checks ');
    expect(guy.idea(id)!.editedBy).toBeUndefined();
    guy.editIdea(id, '   ');
    expect(guy.idea(id)!.text).toBe('Bigger checks');
    guy.editIdea(id, 'Bigger check rings');
    expect(guy.idea(id)).toMatchObject({ text: 'Bigger check rings', editedBy: 'guy' });
  });

  it('reopens a resolved idea', async () => {
    const { guy } = await couple();
    const id = guy.addIdea('Widgets')!;
    guy.resolveIdea(id);
    guy.reopenIdea(id);
    expect(guy.idea(id)).toMatchObject({ resolvedAt: null, resolvedBy: null });
    expect(texts(guy)).toEqual(['Widgets']);
  });

  it('deletes softly, with an undo that reaches the partner too', async () => {
    const { guy, hila } = await couple();
    const id = guy.addIdea('Recipes')!;
    sync(guy, hila);
    const undo = hila.deleteIdea(id);
    sync(guy, hila);
    expect(guy.idea(id)).toBeUndefined();
    expect(guy.store.record('idea', id)?.v.deleted).toBe(true);
    undo();
    sync(guy, hila);
    expect(guy.idea(id)?.text).toBe('Recipes');
  });
});

describe('Ideas: order', () => {
  it('shows the newest first until arranged, then keeps our order with new ones on top', async () => {
    const { guy, hila } = await couple();
    const a = guy.addIdea('A')!;
    const b = guy.addIdea('B')!;
    const c = guy.addIdea('C')!;
    expect(texts(guy)).toEqual(['C', 'B', 'A']);

    guy.reorderIdeas([a, c, b]);
    sync(guy, hila);
    expect(texts(hila)).toEqual(['A', 'C', 'B']);

    hila.addIdea('D');
    sync(guy, hila);
    expect(texts(guy)).toEqual(['D', 'A', 'C', 'B']);
  });

  it('writes only the ideas that moved', async () => {
    const { guy } = await couple();
    const a = guy.addIdea('A')!;
    const b = guy.addIdea('B')!;
    guy.reorderIdeas([b, a]);
    guy.store.ack(guy.store.pendingOutbox().map((e) => e.cid));
    guy.reorderIdeas([b, a]);
    expect(guy.store.outboxSize()).toBe(0);
  });

  it('sorts resolved ideas by when they were resolved, latest first', async () => {
    const { guy } = await couple();
    const a = guy.addIdea('A')!;
    const b = guy.addIdea('B')!;
    guy.resolveIdea(b);
    guy.resolveIdea(a);
    expect(ideasView(guy).resolved.map((i) => i.text)).toEqual(['A', 'B']);
  });
});

describe('Ideas: unseen and copy', () => {
  it('flags what my partner added or edited after I last looked, never my own', async () => {
    const { guy, hila } = await couple();
    const mine = guy.addIdea('Mine')!;
    const seen = Date.now();
    expect(ideasUnseen(guy, 0)).toBeNull();
    hila.addIdea('Hers');
    sync(guy, hila);
    expect(ideasUnseen(guy, seen)).toBe('new');
    const later = Date.now();
    expect(ideasUnseen(guy, later)).toBeNull();
    hila.editIdea(mine, 'Mine, better');
    sync(guy, hila);
    expect(ideasUnseen(guy, later)).toBe('new');
    expect(ideasUnseen(hila, later)).toBeNull();
  });

  it('tells me when my partner resolves or reopens one of mine, not one of theirs', async () => {
    const { guy, hila } = await couple();
    const mine = guy.addIdea('Mine')!;
    const hers = hila.addIdea('Hers')!;
    sync(guy, hila);
    const seen = Date.now() + 1;
    await new Promise((r) => setTimeout(r, 5));
    hila.resolveIdea(hers);
    sync(guy, hila);
    expect(ideasUnseen(guy, seen)).toBeNull();
    hila.resolveIdea(mine);
    sync(guy, hila);
    expect(ideasUnseen(guy, seen)).toBe('resolved');
    const later = Date.now() + 1;
    await new Promise((r) => setTimeout(r, 5));
    hila.reopenIdea(mine);
    sync(guy, hila);
    expect(ideasUnseen(guy, later)).toBe('reopened');
    expect(guy.idea(mine)?.reopenedBy).toBe('hila');
    expect(ideasUnseen(hila, later)).toBeNull();
  });

  it('copies the open ideas as a Markdown list with who wrote each', async () => {
    const { guy, hila } = await couple();
    guy.addIdea('Haptics on\nAndroid');
    hila.addIdea('Bigger fonts');
    const done = guy.addIdea('Done already')!;
    guy.resolveIdea(done);
    sync(guy, hila);
    expect(ideasMarkdown(guy)).toBe('- Bigger fonts (Hila)\n- Haptics on Android (Guy)');
  });
});

describe('Ideas: backup', () => {
  it('round-trips through export and import', async () => {
    const { guy } = await couple();
    const a = guy.addIdea('Export me')!;
    const b = guy.addIdea('And me')!;
    guy.resolveIdea(b);
    const backup = Object.fromEntries((['member', 'list', 'item', 'log', 'memory', 'store', 'settings', 'idea'] as const).map((t) => [t, guy.store.all(t)]));

    const phone = await person('guy');
    phone.importBackup(JSON.parse(JSON.stringify(backup)));
    expect(phone.idea(a)).toEqual(guy.idea(a));
    expect(phone.idea(b)).toEqual(guy.idea(b));
    expect(phone.store.scopeOf('idea', a)).toBe('h');
  });

  it('loads data from before ideas, and keeps a table it doesn’t know yet', async () => {
    const p = new MemoryPersistence();
    const store = await Store.load(p, 'dev', ['h']);
    expect(store.all('idea')).toEqual([]);
    // An op for a table from a newer app version must not break the merge.
    expect(() => store.applyRemote({ t: 'future' as never, id: 'x', f: { a: 1 }, h: encodeHlc({ ms: Date.now(), c: 0 }, 'zz') })).not.toThrow();
    expect(store.record('future' as never, 'x')?.v.a).toBe(1);
  });
});

describe('shortAgo / shortDay', () => {
  it('is compact', () => {
    const t = new Date(2026, 10, 25, 12).getTime();
    expect(shortAgo(t - 20_000, t)).toBe('now');
    expect(shortAgo(t - 5 * 60_000, t)).toBe('5m');
    expect(shortAgo(t - 3 * 3600_000, t)).toBe('3h');
    expect(shortAgo(t - 3 * 86400_000, t)).toBe('3d');
    expect(shortAgo(t - 15 * 86400_000, t)).toBe('2w');
    expect(shortAgo(new Date(2026, 9, 2).getTime(), t)).toBe('2 Oct');
    expect(shortDay(new Date(2026, 10, 20).getTime(), t)).toBe('20 Nov');
    expect(shortDay(new Date(2025, 10, 20).getTime(), t)).toBe('20 Nov 2025');
  });
});

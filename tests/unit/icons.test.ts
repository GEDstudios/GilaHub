import { describe, expect, it } from 'vitest';
import { GLYPHS, type IconName } from '../../src/app/ui/icons.gen';
import { parseGlyph, PROJECT_ICONS } from '../../src/app/ui/ProjectMark';
import { lightVar } from '../../src/app/ui/primitives';
import { Hub, PROJECT_TEMPLATES } from '../../src/core/actions';
import { MemoryPersistence } from '../../src/core/db';
import { suggestIcon } from '../../src/core/projectIcons';
import { Store } from '../../src/core/store';

const CONTROLS: IconName[] = ['plus', 'minus', 'check', 'x', 'chevron-right', 'chevron-left', 'chevron-down', 'chevron-up', 'arrow', 'arrow-back', 'more', 'grip', 'undo', 'refresh', 'swap'];

/** Icons a project could store as "i:<name>" before Gila Duo: they must keep parsing. */
const OLD_PROJECT_ICONS = [
  'cart', 'bag', 'home', 'sparkle', 'lines', 'calendar', 'heart', 'gift', 'plane', 'utensils', 'cake', 'book', 'graduation',
  'briefcase', 'wallet', 'car', 'paw', 'baby', 'plant', 'leaf', 'dumbbell', 'film', 'music', 'star', 'wrench', 'bell',
];

describe('Gila Duo glyphs', () => {
  it('has a line for every glyph and a light for everything but controls', () => {
    for (const [name, [light, line]] of Object.entries(GLYPHS) as Array<[IconName, readonly [string | null, string]]>) {
      expect(line, name).toMatch(/^M/);
      if (CONTROLS.includes(name)) expect(light, name).toBeNull();
      else expect(light, name).toMatch(/^M/);
    }
  });

  it('keeps the privacy family on one geometry', () => {
    expect(GLYPHS.mine[1]).toBe(GLYPHS.ours[1]);
    expect(GLYPHS.theirs[1]).toBe(GLYPHS.ours[1]);
    expect(new Set([GLYPHS.ours[0], GLYPHS.mine[0], GLYPHS.theirs[0]]).size).toBe(3);
  });
});

describe('project icons', () => {
  it('offers 33 distinct icons that all exist (the last, the folder, is "No icon")', () => {
    expect(PROJECT_ICONS).toHaveLength(33);
    expect(new Set(PROJECT_ICONS).size).toBe(33);
    for (const n of PROJECT_ICONS) expect(GLYPHS[n as keyof typeof GLYPHS], n).toBeDefined();
  });

  it('still reads every icon stored before', () => {
    for (const n of OLD_PROJECT_ICONS) expect(parseGlyph(`i:${n}`)).toEqual({ kind: 'icon', name: n });
  });

  it('parses emoji, empty and unknown values', () => {
    expect(parseGlyph('')).toBeNull();
    expect(parseGlyph(undefined)).toBeNull();
    expect(parseGlyph('i:nope')).toBeNull();
    expect(parseGlyph(' 🏝️ ')).toEqual({ kind: 'emoji', text: '🏝️' });
  });
});

describe('lightVar', () => {
  it('lights in my color, lemon standing in for ink', () => {
    expect(lightVar('pink')).toBe('var(--pink)');
    expect(lightVar('ink')).toBe('var(--lemon)');
  });
});

describe('new project icons', () => {
  it('come from the name, then the kind, never twice in a row, and always exist', () => {
    expect(suggestIcon('Rome', 'tasks')).toBe('i:suitcase');
    expect(suggestIcon('Rome', 'tasks', undefined, 'i:suitcase')).toBe('i:plane');
    expect(suggestIcon('Garden', 'tasks')).toBe('i:plant');
    expect(suggestIcon('Wedding', 'tasks')).toBe('i:heart');
    expect(suggestIcon('Car', 'tasks')).toBe('i:car');
    expect(suggestIcon('Books', 'tasks')).toBe('i:book');
    expect(suggestIcon('Recipes', 'tasks')).toBe('i:cooking-pot');
    expect(suggestIcon('Apartment', 'tasks')).toBe('i:home');
    expect(suggestIcon('Stuff', 'shopping', 'home')).toBe('i:bag');
    // Nothing to go on: a plain mark, the same every time, and one nobody else has.
    expect(parseGlyph(suggestIcon('Misc', 'tasks'))?.kind).toBe('icon');
    expect(suggestIcon('Misc', 'tasks')).toBe(suggestIcon('misc', 'tasks'));
    expect(suggestIcon('Misc', 'tasks', undefined, undefined, new Set([suggestIcon('Misc', 'tasks')]))).not.toBe(suggestIcon('Misc', 'tasks'));
    const all = ['Groceries', 'Home shopping', 'Chores', 'To do', 'Next trip', 'Gift ideas', 'Garden', 'Wedding', 'Car', 'Books', 'Recipes', 'Gym', 'Movies', 'Work', 'Budget', 'Baby', 'Dog', 'Party', 'Course', 'Doctor', 'Fix it', 'Coffee', 'Music'];
    for (const n of all) {
      const g = parseGlyph(suggestIcon(n, 'tasks'));
      expect(g?.kind, n).toBe('icon');
    }
    for (const t of PROJECT_TEMPLATES) expect(parseGlyph(t.icon)?.kind, t.name).toBe('icon');
  });

  it('a new project gets one, and a color its neighbours don’t have once all are taken', async () => {
    const hub = new Hub(await Store.load(new MemoryPersistence(), 'dev', ['h', 'p:guy']), 'guy');
    expect(hub.list(hub.createList({ name: 'Rome', kind: 'tasks' }))?.icon).toBe('i:suitcase');
    expect(hub.list(hub.createList({ name: 'Paris', kind: 'tasks' }))?.icon).toBe('i:plane');
    for (let i = 0; i < 6; i++) hub.createList({ name: `P${i}`, kind: 'tasks' });
    for (let i = 0; i < 20; i++) {
      const near = hub.lists().slice(-2).map((l) => l.color);
      expect(near).not.toContain(hub.freshColor());
    }
  });

  it('projects from before icons came get one, the same on both phones; a picked one stays', async () => {
    const make = async () => {
      const hub = new Hub(await Store.load(new MemoryPersistence(), 'dev', ['h', 'p:guy']), 'guy');
      const ids = ['Groceries', 'Errands', 'Weekend', 'Admin', 'Dana', 'Misc', 'Summer'].map((name, i) => hub.createList({ name, kind: i ? 'tasks' : 'shopping', icon: '', id: `l${i}` }));
      hub.createList({ name: 'Plain', kind: 'tasks', icon: 'i:folder', id: 'lp' });
      hub.fillIcons();
      return { hub, ids };
    };
    const a = await make();
    const b = await make();
    const icons = a.ids.map((id) => a.hub.list(id)?.icon);
    expect(icons[0]).toBe('i:cart');
    expect(icons).toEqual(b.ids.map((id) => b.hub.list(id)?.icon));
    // Six names that say nothing: six different marks, no folders.
    expect(new Set(icons.slice(1)).size).toBe(6);
    for (const i of icons) expect(parseGlyph(i)?.kind).toBe('icon');
    expect(a.hub.list('lp')?.icon).toBe('i:folder');
  });
});

describe('the icon library', () => {
  it('finds icons by name and tag, name hits first, and narrows by group', async () => {
    const { searchLibrary } = await import('../../src/app/ui/library');
    const lib = await import('../../src/app/ui/iconLibrary.gen');
    expect(lib.LIBRARY_INFO.length).toBeGreaterThan(1000);
    for (const [name] of lib.LIBRARY_INFO) expect(lib.LIBRARY[name], name).toBeDefined();
    expect(searchLibrary(lib, 'dog', null)[0]).toBe('dog');
    expect(searchLibrary(lib, 'tooth', null)).toContain('tooth');
    expect(searchLibrary(lib, 'zzzz', null)).toEqual([]);
    const nature = searchLibrary(lib, '', 'nature');
    expect(nature.length).toBeGreaterThan(20);
    expect(nature.every((n) => lib.LIBRARY_INFO.find((x) => x[0] === n)?.[1] === 'nature')).toBe(true);
  });

  it('keeps a library icon as "x:<name>"', () => {
    expect(parseGlyph('x:dog')).toEqual({ kind: 'icon', name: 'x:dog' });
    expect(parseGlyph('x:')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { GLYPHS, type IconName } from '../../src/app/ui/icons.gen';
import { parseGlyph, PROJECT_ICONS } from '../../src/app/ui/ProjectMark';
import { lightVar } from '../../src/app/ui/primitives';
import { Hub, PROJECT_TEMPLATES } from '../../src/core/actions';
import { MemoryPersistence } from '../../src/core/db';
import { suggestIcon } from '../../src/core/projectIcons';
import { Store } from '../../src/core/store';

const CONTROLS: IconName[] = ['plus', 'check', 'x', 'chevron-right', 'chevron-left', 'chevron-down', 'chevron-up', 'arrow', 'arrow-back', 'more', 'grip', 'undo', 'refresh', 'swap'];

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
  it('offers 32 distinct icons that all exist', () => {
    expect(PROJECT_ICONS).toHaveLength(32);
    expect(new Set(PROJECT_ICONS).size).toBe(32);
    for (const n of PROJECT_ICONS) expect(GLYPHS[n], n).toBeDefined();
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
    expect(suggestIcon('Stuff', 'chores')).toBe('i:broom');
    // Nothing to go on: the folder.
    expect(suggestIcon('Misc', 'tasks')).toBe('');
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

  it('projects from a template before icons came get the template icon', async () => {
    const hub = new Hub(await Store.load(new MemoryPersistence(), 'dev', ['h', 'p:guy']), 'guy');
    const a = hub.createList({ name: 'Groceries', kind: 'shopping', icon: '' });
    const b = hub.createList({ name: 'Groceries', kind: 'tasks', icon: '' });
    hub.fillTemplateIcons();
    expect(hub.list(a)?.icon).toBe('i:cart');
    expect(hub.list(b)?.icon).toBe('');
  });
});

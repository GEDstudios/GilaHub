import { describe, expect, it } from 'vitest';
import { GLYPHS, type IconName } from '../../src/app/ui/icons.gen';
import { parseGlyph, PROJECT_ICONS } from '../../src/app/ui/ProjectMark';
import { lightVar } from '../../src/app/ui/primitives';

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

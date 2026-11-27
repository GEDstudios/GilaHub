import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DUR, EASE, HOLD, Z } from '../../src/app/ui/tokens';
import { G } from '../../src/app/ui/glyphs';
import { GLYPHS } from '../../src/app/ui/icons.gen';

const css = readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf8');
const prop = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
const squash = (s?: string) => s?.replace(/\s+/g, '');

describe('the feel, the same in TS and CSS', () => {
  it('holds, durations, springs and stacking agree', () => {
    expect(prop('hold')).toBe(`${HOLD.press}ms`);
    expect(prop('dur-quick')).toBe(`${DUR.quick}ms`);
    expect(prop('dur-base')).toBe(`${DUR.base}ms`);
    expect(prop('dur-move')).toBe(`${DUR.move}ms`);
    expect(prop('dur-slow')).toBe(`${DUR.slow}ms`);
    expect(squash(prop('ease'))).toBe(squash(EASE.out));
    expect(squash(prop('spring'))).toBe(squash(EASE.spring));
    expect(squash(prop('spring-soft'))).toBe(squash(EASE.springSoft));
    expect(prop('z-drag')).toBe(String(Z.drag));
  });

  it('every meaning has a glyph that exists', () => {
    for (const [meaning, glyph] of Object.entries(G)) expect(GLYPHS, meaning).toHaveProperty(glyph);
  });
});

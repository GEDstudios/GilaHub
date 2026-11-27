import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

describe('every stylesheet stays on the scales (tokens.css)', () => {
  const dir = resolve(__dirname, '../../src/styles');
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith('.css') ? [join(d, e.name)] : []));
  const decls = files(dir)
    .filter((f) => !f.endsWith('tokens.css'))
    .flatMap((f) => [...readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map((m) => ({ f: f.slice(dir.length + 1), prop: m[1], value: m[2] })));
  const px = (v: string) => [...v.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Math.abs(parseFloat(m[1])));
  const SPACE = new Set([0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 120, 140, 160]);
  // Corners: tiny marks say their own (10px and under); a surface takes --r-s, --r-m or --r-l.
  const RADIUS = new Set([1, 2, 4, 6, 8, 10]);
  // Shapes of their own: the folder's tab, a sticky note's lifted corner.
  const SHAPES = new Set(['12px 16px 0 0', '10px 14px 0 0', '22px 6px']);

  it('spacing', () => {
    const off = decls.filter((d) => /^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(d.prop) && px(d.value).some((n) => n <= 160 && !SPACE.has(n)));
    expect(off.map((d) => `${d.f}: ${d.prop}: ${d.value}`)).toEqual([]);
  });

  it('a blur is written -webkit- first, then the standard one (the build keeps only the last of a pair, and Chrome reads only the standard)', () => {
    const off = files(dir).flatMap((f) => {
      const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      return [...css.matchAll(/\{([^{}]*backdrop-filter[^{}]*)\}/g)].filter((m) => !/-webkit-backdrop-filter:[^;]+;\s*backdrop-filter:[^;]+;/.test(m[1])).map(() => f.slice(dir.length + 1));
    });
    expect(off).toEqual([]);
  });

  it('type sizes are whole pixels', () => {
    const off = decls.filter((d) => d.prop === 'font-size' && px(d.value).some((n) => n % 1 !== 0));
    expect(off.map((d) => `${d.f}: ${d.value}`)).toEqual([]);
  });

  it('radii', () => {
    const off = decls.filter((d) => /radius/.test(d.prop) && !SHAPES.has(d.value.replace(/\s+/g, ' ').trim()) && px(d.value).some((n) => n < 99 && !RADIUS.has(n)));
    expect(off.map((d) => `${d.f}: ${d.prop}: ${d.value}`)).toEqual([]);
  });

  it('what you press is one of the three --ctl heights', () => {
    // Every pill and disc that had a height of its own between 28 and 42px. A new one joins the list.
    const CONTROLS = ['.echip', '.token', '.option', '.lens__chip', '.tagtoken', '.scopetag', '.seg__btn', '.viewtoggle__btn', '.stepper', '.btn--sm', '.mini', '.iconbtn', '.iconbtn--sm', '.glyphbtn', '.herobtn', '.foldbtn', '.sheet__close', '.timefield'];
    const sheets = files(dir).map((f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
    const heightOf = (sel: string) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const css of sheets) {
        const m = css.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`));
        const h = m?.[1].match(/(?:^|\s)height:\s*([^;]+);/)?.[1];
        if (h) return h.trim();
      }
      return undefined;
    };
    expect(Object.fromEntries(CONTROLS.map((c) => [c, heightOf(c)]).filter(([, h]) => !/^var\(--ctl-[sml]\)$/.test(String(h))))).toEqual({});
  });

  it('what you read is one of the seven --type sizes (only the serif, and a note\'s own scale, say px)', () => {
    // 9px and 10px: inside the scaled note face, and an emoji in a 16px mark.
    const off = decls.filter((d) => d.prop === 'font-size' && px(d.value).some((n) => n < 18 && n !== 9 && n !== 10));
    expect(off.map((d) => `${d.f}: ${d.value}`)).toEqual([]);
  });

  it('transitions run at one of the four --dur speeds (a few pieces of choreography keep their own)', () => {
    // The live cursor, the drag slot, the bar's pill, a note peeling, the day card's hop, the ideas tag; 0: at once.
    const OWN = new Set([0, 1, 90, 100, 360, 380, 420]);
    /** How long a part of a transition takes, when it says so in ms or s (after a --dur token, a time is its delay). */
    const raw = (part: string) => (/var\(--dur-/.test(part) ? undefined : part.match(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/));
    const ownTime = (part: string) => {
      const m = raw(part);
      return !m || OWN.has(m[2] === 's' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]));
    };
    const off = decls.filter((d) => /^transition(-duration)?$/.test(d.prop) && !d.value.split(/,(?![^(]*\))/).every(ownTime));
    expect(off.map((d) => `${d.f}: ${d.value.replace(/\s+/g, ' ')}`)).toEqual([]);
  });

  it('a press is one of the three --press depths', () => {
    const rules = files(dir)
      .filter((f) => !f.endsWith('tokens.css'))
      .flatMap((f) => [...readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ f: f.slice(dir.length + 1), sel: m[1].trim(), body: m[2] })));
    const off = rules.filter((r) => r.sel.split(',').every((s) => /:active/.test(s)) && /scale(\(|:)\s*0?\.\d+/.test(r.body));
    expect(off.map((r) => `${r.f}: ${r.sel.replace(/\s+/g, ' ')}`)).toEqual([]);
  });

  it('white is the card colour, and text on ink is --cta-text', () => {
    const off = decls.filter((d) => (d.prop === 'background' || d.prop === 'color') && /^#fff(fff)?$/i.test(d.value) && d.f !== 'screens/pairing.css');
    expect(off.map((d) => `${d.f}: ${d.prop}: ${d.value}`)).toEqual([]);
  });
});

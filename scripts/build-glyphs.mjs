// Builds src/app/ui/icons.gen.ts — the Gila Duo glyphs — from Phosphor Icons 2.1 (MIT,
// © 2023 Phosphor Icons). Each glyph is [light, line]: the solid "light" layer (Phosphor's
// 20%-opacity duotone path, re-inked by CSS) and the ink line. Controls are line-only.
// Usage: npm run glyphs   — commit the output; nothing from Phosphor ships at runtime.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = resolve(root, 'node_modules/@phosphor-icons/core/assets');
const OUT = resolve(root, 'src/app/ui/icons.gen.ts');

// Our circles for the privacy family, on Phosphor's `intersect` geometry (r 72 at 96,96 and 160,160).
const LEFT = 'M24,96a72,72,0,1,0,144,0a72,72,0,1,0,-144,0Z';
const RIGHT = 'M88,160a72,72,0,1,0,144,0a72,72,0,1,0,-144,0Z';

/** App IconName → [Phosphor name, mode]. mode: 'duo' | 'line' (control, no light) | a light path override. */
const MAP = {
  // controls — line only; the button around them is the light
  plus: ['plus', 'line'], check: ['check', 'line'], x: ['x', 'line'],
  'chevron-right': ['caret-right', 'line'], 'chevron-left': ['caret-left', 'line'],
  'chevron-down': ['caret-down', 'line'], 'chevron-up': ['caret-up', 'line'],
  arrow: ['arrow-right', 'line'], 'arrow-back': ['arrow-left', 'line'],
  more: ['dots-three', 'line'], grip: ['dots-six-vertical', 'line'],
  undo: ['arrow-u-up-left', 'line'], refresh: ['arrow-clockwise', 'line'], swap: ['arrows-left-right', 'line'],
  // interface
  search: ['magnifying-glass', 'duo'], gear: ['gear-six', 'duo'], bell: ['bell', 'duo'],
  repeat: ['repeat', 'duo'], calendar: ['calendar-blank', 'duo'], clock: ['clock', 'duo'],
  user: ['user', 'duo'], lock: ['lock-simple', 'duo'],
  ours: ['intersect', 'duo'], mine: ['intersect', LEFT], theirs: ['intersect', RIGHT],
  bag: ['tote', 'duo'], basket: ['basket', 'duo'], sparkle: ['sparkle', 'duo'], sun: ['sun', 'duo'],
  lines: ['list-bullets', 'duo'], folders: ['squares-four', 'duo'], folder: ['folder-simple', 'duo'],
  trash: ['trash', 'duo'], edit: ['pencil-simple', 'duo'], copy: ['copy', 'duo'], archive: ['archive', 'duo'],
  heart: ['heart', 'duo'], 'heart-fill': ['heart', 'duo'], plane: ['airplane-tilt', 'duo'],
  move: ['arrow-square-in', 'duo'], share: ['export', 'duo'], note: ['note', 'duo'], steps: ['list-checks', 'duo'],
  device: ['device-mobile', 'duo'], download: ['tray-arrow-down', 'duo'], upload: ['tray-arrow-up', 'duo'],
  snooze: ['bell-z', 'duo'], skip: ['skip-forward', 'duo'], pause: ['pause', 'duo'], tag: ['tag', 'duo'],
  cart: ['shopping-cart-simple', 'duo'], link: ['link', 'duo'], eye: ['eye', 'duo'], 'eye-off': ['eye-slash', 'duo'],
  moon: ['moon', 'duo'], hand: ['hand', 'duo'], pin: ['push-pin', 'duo'], urgent: ['lightning', 'duo'],
  layout: ['layout', 'duo'], sliders: ['sliders-horizontal', 'duo'], inbox: ['tray', 'duo'], stack: ['rows', 'duo'],
  request: ['hand-waving', 'duo'], 'user-plus': ['user-plus', 'duo'], badge: ['notification', 'duo'],
  lightbulb: ['lightbulb', 'duo'],
  // projects
  home: ['house', 'duo'], gift: ['gift', 'duo'], book: ['book-open', 'duo'], car: ['car', 'duo'],
  paw: ['paw-print', 'duo'], wallet: ['wallet', 'duo'], film: ['film-slate', 'duo'], utensils: ['fork-knife', 'duo'],
  leaf: ['leaf', 'duo'], dumbbell: ['barbell', 'duo'], briefcase: ['briefcase', 'duo'], star: ['star', 'duo'],
  music: ['music-notes', 'duo'], wrench: ['wrench', 'duo'], baby: ['baby', 'duo'], plant: ['potted-plant', 'duo'],
  cake: ['cake', 'duo'], graduation: ['graduation-cap', 'duo'], broom: ['broom', 'duo'],
  'cooking-pot': ['cooking-pot', 'duo'], coffee: ['coffee', 'duo'], 'first-aid': ['first-aid', 'duo'],
  suitcase: ['suitcase-rolling', 'duo'],
  // grocery aisles
  carrot: ['carrot', 'duo'], bread: ['bread', 'duo'], cheese: ['cheese', 'duo'], fish: ['fish', 'duo'],
  bowl: ['bowl-food', 'duo'], jar: ['jar-label', 'duo'], cookie: ['cookie', 'duo'], snowflake: ['snowflake', 'duo'],
  drink: ['pint-glass', 'duo'], spray: ['spray-bottle', 'duo'], soap: ['hand-soap', 'duo'],
  // home departments
  bath: ['bathtub', 'duo'], bed: ['bed', 'duo'], armchair: ['armchair', 'duo'], package: ['package', 'duo'],
};

// 0.1 unit on a 256 grid is 0.01 px at 24 px: invisible, and ~10% smaller.
const round = (d) => d.replace(/-?\d*\.\d+/g, (m) => String(Math.round(parseFloat(m) * 10) / 10 || 0));

const out = [];
for (const [name, [ph, mode]] of Object.entries(MAP)) {
  const file = mode === 'line' ? `${assets}/regular/${ph}.svg` : `${assets}/duotone/${ph}-duotone.svg`;
  const svg = readFileSync(file, 'utf8');
  const light = [], line = [];
  for (const [, tag, attrs] of svg.matchAll(/<(\w+)\b([^>]*?)\/>/g)) {
    if (tag !== 'path') throw new Error(`${name}: unexpected <${tag}> in ${file}`);
    const d = /\sd="([^"]+)"/.exec(attrs)[1];
    (/opacity="0\.2"/.test(attrs) ? light : line).push(d);
  }
  const l = mode === 'line' ? null : mode === 'duo' ? light.join('') : mode;
  if (mode === 'duo' && !l) throw new Error(`${name}: ${ph} has no duotone layer`);
  out.push(`  '${name}': [${l ? `'${round(l)}'` : 'null'}, '${round(line.join(''))}'],`);
}

writeFileSync(
  OUT,
  `/*! Gila Duo glyphs, derived from Phosphor Icons 2.1 — © 2023 Phosphor Icons, MIT License (docs/THIRD-PARTY.md). */\n` +
    `// Generated by scripts/build-glyphs.mjs. Do not edit; add a row to MAP and run npm run glyphs.\n` +
    `// Each glyph: [light layer | null for controls, ink line], on a 256 grid.\n` +
    `export const GLYPHS = {\n${out.join('\n')}\n} as const satisfies Record<string, readonly [string | null, string]>;\n\n` +
    `export type IconName = keyof typeof GLYPHS;\n`,
);
console.log(`glyphs: ${out.length} → ${OUT}`);

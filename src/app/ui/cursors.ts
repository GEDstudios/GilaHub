import { GLYPHS } from './icons.gen';

/**
 * On a computer, the mouse wears our hands: an arrow, a pointing hand on anything to tap, the
 * open "I'll take it" hand on anything to pick up, a closed one while carrying. Each is the
 * Gila Duo glyph with its light in my colour and a thin white edge, so it reads on any card.
 * Set as CSS variables (--cur-*) that the stylesheet uses, falling back to the plain cursors.
 */
const SIZE = 32;
const PAD = 12;

function cursorUrl(name: keyof typeof GLYPHS, light: string, turn?: string, plain = false): string {
  const [glyphLight, line] = GLYPHS[name];
  const l = plain ? null : glyphLight;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${SIZE}' height='${SIZE}' viewBox='${-PAD} ${-PAD} ${256 + PAD * 2} ${256 + PAD * 2}'>` +
    (turn ? `<g transform='${turn}'>` : '') +
    `<path d='${line}' fill='#fff' stroke='#fff' stroke-width='26' stroke-linejoin='round'/>` +
    (l ? `<path d='${l}' fill='${light}'/>` : '') +
    `<path d='${line}' fill='#0a0a04' fill-rule='evenodd'/>` +
    (turn ? `</g>` : '') +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Where each one "points", on its 256 grid. */
const at = (x: number, y: number) => `${Math.round(((x + PAD) / (256 + PAD * 2)) * SIZE)} ${Math.round(((y + PAD) / (256 + PAD * 2)) * SIZE)}`;

/** Paint the cursors in this colour (any CSS colour; resolved here so the images can use it). */
export function setCursors(color: string): void {
  if (typeof document === 'undefined') return;
  const probe = document.createElement('span');
  probe.style.color = color;
  probe.style.display = 'none';
  document.body.append(probe);
  const light = getComputedStyle(probe).color || '#e8ff1f';
  probe.remove();
  const root = document.documentElement.style;
  // The arrow, stood up a little from Phosphor's 45° (about where a computer's own arrow leans), round its tip.
  root.setProperty('--cur-arrow', `${cursorUrl('cursor-arrow', light, 'translate(34 34) rotate(22) scale(0.84) translate(-34 -34)')} ${at(34, 34)}, auto`);
  // Turning and sizing a note
  root.setProperty('--cur-rotate', `${cursorUrl('cursor-rotate', light)} ${at(128, 128)}, alias`);
  root.setProperty('--cur-scale', `${cursorUrl('cursor-scale', light, undefined, true)} ${at(128, 128)}, nwse-resize`);
  root.setProperty('--cur-point', `${cursorUrl('hand-pointing', light)} ${at(116, 18)}, pointer`);
  root.setProperty('--cur-grab', `${cursorUrl('hand', light)} ${at(128, 120)}, grab`);
  root.setProperty('--cur-grabbing', `${cursorUrl('hand-grabbing', light)} ${at(128, 140)}, grabbing`);
}

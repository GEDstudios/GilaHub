// Renders the Gila Hub icon set from one SVG design using the preinstalled Chromium.
// Usage: npm run icons
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/icons');
mkdirSync(out, { recursive: true });

const INK = '#0A0A04';
const LEMON = '#EAFF00';

/** The mark: "gila" in a soft, heavy serif on acid yellow. */
function iconSvg({ size = 512, scale = 1, rounded = false, font = "'Fraunces Variable', 'Cooper Black', Georgia, serif" } = {}) {
  const fs = 178 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="${LEMON}"/>
  <text x="256" y="258" dy="0.3em" text-anchor="middle" font-family="${font}" font-weight="900" font-size="${fs}" fill="${INK}" letter-spacing="-8" style="font-variation-settings:'SOFT' 100">gila</text>
</svg>`;
}

/** Monochrome badge for Android notifications (alpha only). */
function badgeSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <text x="48" y="44" dy="0.3em" text-anchor="middle" font-family="'Fraunces Variable', Georgia, serif" font-weight="900" font-size="92" fill="#fff" style="font-variation-settings:'SOFT' 100">g</text>
</svg>`;
}

// Embed the font (a blank page can't load file:// stylesheets).
const fontData = readFileSync(resolve(root, 'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-soft-normal.woff2')).toString('base64');
const fontFace = `@font-face{font-family:'Fraunces Variable';src:url(data:font/woff2;base64,${fontData}) format('woff2');font-weight:100 900}`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function png(svg, size, file, transparent = false) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><head><style>${fontFace}html,body{margin:0;background:${transparent ? 'transparent' : LEMON}}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`,
    { waitUntil: 'networkidle' },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(out, file), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', file);
}

await png(iconSvg({ rounded: false }), 512, 'icon-512.png');
await png(iconSvg({ rounded: false }), 192, 'icon-192.png');
await png(iconSvg({ rounded: false }), 180, 'apple-touch-icon.png');
await png(iconSvg({ scale: 0.78 }), 512, 'maskable-512.png');
await png(badgeSvg(), 96, 'badge-96.png', true);
await browser.close();

writeFileSync(resolve(out, 'icon.svg'), iconSvg({ rounded: true, font: "'Cooper Black', Georgia, serif" }).replace(/ width="512" height="512"/, ''));
console.log('wrote icon.svg');

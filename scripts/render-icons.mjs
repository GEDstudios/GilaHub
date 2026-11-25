// Renders the Gila Hub icon set from one SVG design using the preinstalled Chromium.
// Usage: npm run icons
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/icons');
mkdirSync(out, { recursive: true });

const INK = '#111111';
const LIME = '#6CBE45';
const TANGERINE = '#FF6319';

/** The mark: a black sign with the white stripe and two route bullets. */
function iconSvg({ size = 512, scale = 1, rounded = false, font = "'Inter Variable', Inter, Helvetica, Arial, sans-serif" } = {}) {
  const r = 104 * scale;
  const d = 190 * scale;
  const cy = 256 + 34 * scale;
  const cx1 = 256 - d / 2;
  const cx2 = 256 + d / 2;
  const fs = r * 1.18;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="${INK}"/>
  <rect x="0" y="${rounded ? 70 : 58}" width="512" height="14" fill="#fff"/>
  <circle cx="${cx1}" cy="${cy}" r="${r}" fill="${LIME}"/>
  <circle cx="${cx2}" cy="${cy}" r="${r + 12 * scale}" fill="${INK}"/>
  <circle cx="${cx2}" cy="${cy}" r="${r}" fill="${TANGERINE}"/>
  <text x="${cx1}" y="${cy}" dy="0.355em" text-anchor="middle" font-family="${font}" font-weight="760" font-size="${fs}" fill="${INK}" letter-spacing="-4">G</text>
  <text x="${cx2}" y="${cy}" dy="0.355em" text-anchor="middle" font-family="${font}" font-weight="760" font-size="${fs}" fill="#fff" letter-spacing="-4">H</text>
</svg>`;
}

/** Monochrome badge for Android notifications (alpha only). */
function badgeSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs><mask id="m"><rect width="96" height="96" fill="#fff"/><circle cx="62" cy="48" r="26" fill="#000"/></mask></defs>
  <circle cx="30" cy="48" r="22" fill="#fff" mask="url(#m)"/>
  <circle cx="64" cy="48" r="22" fill="#fff"/>
</svg>`;
}

const fontCss = pathToFileURL(resolve(root, 'node_modules/@fontsource-variable/inter/index.css')).href;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function png(svg, size, file, transparent = false) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><head><link rel="stylesheet" href="${fontCss}"><style>html,body{margin:0;background:${transparent ? 'transparent' : INK}}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`,
    { waitUntil: 'networkidle' },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(out, file), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', file);
}

await png(iconSvg({ rounded: false }), 512, 'icon-512.png');
await png(iconSvg({ rounded: false }), 192, 'icon-192.png');
await png(iconSvg({ rounded: false }), 180, 'apple-touch-icon.png');
await png(iconSvg({ scale: 0.82 }), 512, 'maskable-512.png');
await png(badgeSvg(), 96, 'badge-96.png', true);
await browser.close();

writeFileSync(resolve(out, 'icon.svg'), iconSvg({ rounded: true, font: 'Inter, Helvetica, Arial, sans-serif' }).replace(/ width="512" height="512"/, ''));
console.log('wrote icon.svg');

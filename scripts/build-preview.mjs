// Builds a single self-contained HTML file of the app (JS, CSS and the Latin + Hebrew
// font subsets inlined) for previewing without a server. It runs in local-only mode:
// no service worker, no relay — everything else works on one device.
// Usage: node scripts/build-preview.mjs <out.html> [extra vite args…]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [out = resolve(root, 'gila-hub-preview.html'), ...viteArgs] = process.argv.slice(2);
const dist = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'gila-preview-'));
execFileSync('npx', ['vite', 'build', '--base', './', '--outDir', dist, '--emptyOutDir', ...viteArgs], { cwd: root, stdio: 'inherit', env: { ...process.env, GILA_ONE_FILE: '1' } });

const assets = join(dist, 'assets');
const files = readdirSync(assets);
const js = readFileSync(join(assets, files.find((f) => /^index-.*\.js$/.test(f))), 'utf8');
let css = readFileSync(join(assets, files.find((f) => /^index-.*\.css$/.test(f))), 'utf8');

// Keep only the font faces we need, inlined; drop the other subsets entirely.
css = css.replace(/@font-face\{[^}]*\}/g, (face) => {
  const m = face.match(/url\(\.?\/?(?:assets\/)?([^)]+\.woff2)\)/);
  if (!m) return face;
  const file = m[1].split('/').pop();
  if (!/(inter-latin-wght|heebo-hebrew-wght)/.test(file)) return "";
  const data = readFileSync(join(assets, file)).toString('base64');
  return face.replace(/src:[^;}]+/, `src:url(data:font/woff2;base64,${data}) format("woff2")`);
});

const html = `<title>Gila Hub</title>
<meta name="theme-color" content="#111111">
<meta name="description" content="Where our lines meet. Shared groceries, chores and lists for two.">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);

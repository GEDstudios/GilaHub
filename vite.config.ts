import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Emits /sw.js from src/sw/sw.js with the precache list of this build injected.
 * Fonts are runtime-cached (only the subsets actually used get downloaded),
 * except Latin + Hebrew which are precached for a fully offline first run.
 */
function serviceWorker(): Plugin {
  return {
    name: 'gila-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => {
        if (f.endsWith('.map')) return false;
        if (f.endsWith('.woff2')) return /(latin-wght|hebrew-wght)/.test(f) && !/latin-ext/.test(f);
        return !f.endsWith('.woff');
      });
      const precache = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon.svg', ...files.map((f) => `/${f}`)];
      const version = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 12);
      const source = readFileSync('src/sw/sw.js', 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/** Which build is this? Shown in Settings so you can tell an update arrived. */
function buildId(): string {
  let sha = process.env.GITHUB_SHA?.slice(0, 7) ?? '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = 'dev';
    }
  }
  const d = new Date();
  const stamp = `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
  return `${sha} · ${stamp}`;
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  define: { __BUILD__: JSON.stringify(buildId()) },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    // Keep /*! … */ and @license notices (React, the Phosphor-derived glyphs) in the shipped bundle.
    rolldownOptions: { output: { comments: { legal: true } } },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', ws: true },
    },
  },
});

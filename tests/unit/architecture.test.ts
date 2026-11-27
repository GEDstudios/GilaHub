import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The layers (docs/05-ARCHITECTURE.md), kept by a test the way tokens.test.ts keeps the scales:
 *
 *   core, smart   the data and the pure logic: they never look up at the app
 *   app/*.ts      what screens show and how it's said; no components
 *   app/ui        the design system: knows nothing about the Hub (only the plain stores below)
 *   app/components  pieces of screens; never a screen
 *   app/screens   whole pages; only App.tsx puts them together
 *   worker        the relay: shares no code with the app
 *   sw            the service worker's own bundle: no React in it
 */
const root = resolve(__dirname, '../..');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.(ts|tsx)$/.test(n) ? [join(d, n)] : []));
const files = [...walk(join(root, 'src')), ...walk(join(root, 'worker'))];
const rel = (f: string) => relative(root, f).replace(/\\/g, '/');

/** What a file imports at run time (type-only imports vanish when built): [what it wrote, the file that is, when it's ours]. */
function importsOf(file: string): Array<{ spec: string; to: string | null }> {
  const src = readFileSync(file, 'utf8');
  const specs = [
    ...[...src.matchAll(/(?:^|\n)\s*(import|export)(\s+type)?\s[^'"]*?from\s*['"]([^'"]+)['"]/g)].filter((m) => !m[2]).map((m) => m[3]),
    ...[...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ];
  return specs.map((spec) => {
    if (!spec.startsWith('.')) return { spec, to: null };
    const base = resolve(dirname(file), spec);
    const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((p) => existsSync(p) && statSync(p).isFile());
    return { spec, to: hit ? rel(hit) : null };
  });
}
const edges = files.flatMap((f) => importsOf(f).map((i) => ({ from: rel(f), ...i })));
const broken = (ok: (e: (typeof edges)[number]) => boolean) => edges.filter((e) => !ok(e)).map((e) => `${e.from} → ${e.to ?? e.spec}`);
const under = (p: string | null, dir: string) => !!p && p.startsWith(dir);

describe('the layers hold', () => {
  it('core and smart never import the app', () => {
    expect(broken((e) => !(under(e.from, 'src/core/') || under(e.from, 'src/smart/')) || !under(e.to, 'src/app/'))).toEqual([]);
  });

  it('the relay shares no code with the app', () => {
    expect(broken((e) => !under(e.from, 'worker/') || !under(e.to, 'src/'))).toEqual([]);
  });

  it('ui knows nothing about the Hub: of the app it uses only the plain stores (prefs, the router, the bar being edited)', () => {
    const STORES = new Set(['src/app/prefs.ts', 'src/app/router.ts', 'src/app/barEdit.ts']);
    expect(broken((e) => !under(e.from, 'src/app/ui/') || !under(e.to, 'src/app/') || under(e.to, 'src/app/ui/') || STORES.has(e.to!))).toEqual([]);
    expect(broken((e) => !under(e.from, 'src/app/ui/') || !under(e.to, 'src/core/hub/'))).toEqual([]);
  });

  it('a component never imports a screen, and only App.tsx puts screens together', () => {
    expect(broken((e) => !under(e.to, 'src/app/screens/') || under(e.from, 'src/app/screens/') || e.from === 'src/app/App.tsx')).toEqual([]);
  });

  it('what the app knows (src/app/*.ts) never imports what it draws (components, screens)', () => {
    const logic = (f: string) => /^src\/app\/[^/]+\.tsx?$/.test(f) && f !== 'src/app/App.tsx';
    expect(broken((e) => !logic(e.from) || !(under(e.to, 'src/app/components/') || under(e.to, 'src/app/screens/')))).toEqual([]);
  });

  it('the service worker bundle (src/sw/act.ts) never reaches React', () => {
    const seen = new Set<string>();
    const reach = (f: string, path: string[]): string[] | null => {
      if (seen.has(f)) return null;
      seen.add(f);
      for (const e of edges.filter((x) => x.from === f)) {
        if (e.spec === 'react' || e.spec.startsWith('react/') || e.spec === 'react-dom') return [...path, f, e.spec];
        const deeper = e.to ? reach(e.to, [...path, f]) : null;
        if (deeper) return deeper;
      }
      return null;
    };
    expect(reach('src/sw/act.ts', [])).toBeNull();
  });
});

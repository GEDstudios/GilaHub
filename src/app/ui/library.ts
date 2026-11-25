import { useEffect, useSyncExternalStore } from 'react';

/**
 * The icon library: ~1,300 more Phosphor glyphs (iconLibrary.gen.ts), in a chunk of its own
 * so the app doesn't carry them until they're wanted: when the picker opens, or a project or
 * category shows one ("x:<name>"). Until it lands, the spot stays an empty icon-sized box.
 */
type Lib = typeof import('./iconLibrary.gen');
let lib: Lib | null = null;
let loading: Promise<Lib> | null = null;
const listeners = new Set<() => void>();

export function loadLibrary(): Promise<Lib> {
  if (lib) return Promise.resolve(lib);
  loading ??= import('./iconLibrary.gen').then((m) => {
    lib = m;
    listeners.forEach((l) => l());
    return m;
  });
  return loading;
}

export function useLibrary(): Lib | null {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => lib,
    () => lib,
  );
  useEffect(() => {
    if (!lib) void loadLibrary().catch(() => undefined);
  }, []);
  return v;
}

export const LIB_GROUPS: Array<{ id: string; label: string }> = [
  { id: 'home', label: 'Home & things' },
  { id: 'nature', label: 'Nature' },
  { id: 'travel', label: 'Travel & places' },
  { id: 'health', label: 'Health' },
  { id: 'people', label: 'People' },
  { id: 'fun', label: 'Fun' },
  { id: 'money', label: 'Money & shops' },
  { id: 'work', label: 'Work' },
  { id: 'more', label: 'More' },
];

/** Search the library: every word typed must start a word of the icon's name or tags. */
export function searchLibrary(l: Lib, q: string, group: string | null): string[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const out: Array<[string, number]> = [];
  for (const [name, g, tags] of l.LIBRARY_INFO) {
    if (group && g !== group) continue;
    if (!words.length) {
      out.push([name, 0]);
      continue;
    }
    const hay = ` ${tags}`;
    if (!words.every((w) => hay.includes(` ${w}`))) continue;
    // Name hits first, then the shorter (plainer) names.
    const score = (words.every((w) => ` ${name.replace(/-/g, ' ')}`.includes(` ${w}`)) ? 0 : 100) + name.length;
    out.push([name, score]);
  }
  return words.length ? out.sort((a, b) => a[1] - b[1]).map((x) => x[0]) : out.map((x) => x[0]);
}

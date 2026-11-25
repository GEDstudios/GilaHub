import { useSyncExternalStore } from 'react';
import { MAX_PINS, type TabDef } from './tabs';
import { haptic } from './ui/haptics';
import { EDGE_DWELL, EDGE_STEP_MS, edgeDir } from './ui/scrub';
import type { Outside } from './ui/Sortable';

/**
 * Editing the bottom bar where it is (round 7, BAR): the live bar lives in App and the Projects
 * page in a route, so they share this tiny store.
 *   arranging  Projects > "Arrange the bar" is on: the live bar becomes editable (BarEdit live)
 *   aim        a folder or a token is being dragged; `at` is where it would land in the bar
 *              (an index among the pins, without its own key), null while it's elsewhere
 * And the pure maths of aiming at a bar: which slot is under the finger.
 */

export interface Aim {
  key: string;
  tab: TabDef;
  at: number | null;
  /** The bar is full and this isn't in it: it says no. */
  refusing?: boolean;
}

/** Where a drag would land in the bar: an index among the pins, with what lands there (none: a +). */
export interface BarGap {
  at: number;
  tab?: TabDef;
}

interface State {
  arranging: boolean;
  aim: Aim | null;
}

let state: State = { arranging: false, aim: null };
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
const snapshot = () => state;

export function useBarEdit(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** "Arrange the bar" on or off. An edit mode quiets the app's single-key shortcuts (html.is-editing). */
export function setArranging(on: boolean): void {
  if (state.arranging === on) return;
  document.documentElement.classList.toggle('is-editing', on);
  set({ arranging: on });
}

export const getAim = (): Aim | null => state.aim;

export function setAim(aim: Aim | null): void {
  const a = state.aim;
  if (a === aim || (a && aim && a.key === aim.key && a.at === aim.at && !!a.refusing === !!aim.refusing)) return;
  set({ aim });
}

/**
 * The bar as it shows while something is aimed at it (pure, for tests): the aimed key leaves
 * its place and a gap opens where it would land. Not over the bar yet, the gap is its own place
 * (pinned) or an empty + at the end. A full bar refuses a newcomer: no gap.
 */
export function withGap(tabs: TabDef[], aim: Aim | null): { tabs: TabDef[]; gap: BarGap | null } {
  if (!aim || tabs.length < 2) return { tabs, gap: null };
  const middle = tabs.slice(1, -1);
  const own = middle.findIndex((t) => t.key === aim.key);
  if (own < 0 && (aim.refusing || middle.length >= MAX_PINS)) return { tabs, gap: null };
  const rest = middle.filter((t) => t.key !== aim.key);
  const at = Math.min(Math.max(aim.at ?? (own >= 0 ? own : rest.length), 0), rest.length);
  return { tabs: [tabs[0], ...rest, tabs[tabs.length - 1]], gap: { at, tab: aim.at === null && own < 0 ? undefined : aim.tab } };
}

/**
 * The insertion index for a finger at x (pure, for tests): how many of the movable tabs'
 * centers are left of it. In the dock, over Today (left of its scrolling middle) is first and
 * over Projects is last.
 */
export function slotFromRects(x: number, centers: readonly number[], view?: { left: number; right: number }): number {
  if (view && x <= view.left) return 0;
  if (view && x >= view.right) return centers.length;
  return centers.filter((c) => c < x).length;
}

/** How far above the bar a drag still counts as over it (px). */
export const BAR_REACH = 20;

/**
 * The slot under (x, y) in a bar (`nav`), or null when the point isn't over it (its rect,
 * reaching `reach` px up). Counts the movable tabs only: not the ends, the gap, or `exclude`.
 */
export function slotAt(nav: Element | null, x: number, y: number, { reach = BAR_REACH, exclude }: { reach?: number; exclude?: string } = {}): number | null {
  if (!nav) return null;
  const r = nav.getBoundingClientRect();
  if (!r.width || y < r.top - reach || y > r.bottom + 40) return null;
  const cx = Math.min(Math.max(x, r.left), r.right);
  const centers = [...nav.querySelectorAll<HTMLElement>('[data-key]')]
    .filter((el) => !el.classList.contains('is-anchor') && !el.classList.contains('is-gap') && el.dataset.key !== exclude)
    .map((el) => {
      const b = el.getBoundingClientRect();
      return b.left + b.width / 2;
    });
  const view = nav.querySelector('.tabbar__scroll')?.getBoundingClientRect();
  return slotFromRects(cx, centers, view ? { left: view.left, right: view.right } : undefined);
}

/** Which way the dock is asked to step, and when it next may. */
export interface DockStep {
  dir: number;
  next: number;
}

/**
 * While something is dragged over a docked bar, a finger resting in the outer strip of its
 * scrolling middle steps it one slot (after EDGE_DWELL), then one every EDGE_STEP_MS.
 */
export function stepDock(nav: Element | null, x: number, now: number, st: DockStep, calm: boolean): void {
  const sc = nav?.querySelector<HTMLElement>('.tabbar__scroll');
  if (!sc) return;
  const v = sc.getBoundingClientRect();
  const dir = edgeDir(x, v.left, v.right, sc.scrollLeft, sc.scrollWidth - sc.clientWidth, -Infinity, Infinity);
  if (dir !== st.dir) {
    st.dir = dir;
    st.next = now + EDGE_DWELL;
  } else if (dir && now >= st.next) {
    const w = sc.querySelector<HTMLElement>('[data-key]')?.offsetWidth || 52;
    sc.scrollBy({ left: dir * w, behavior: calm ? 'auto' : 'smooth' });
    st.next = now + EDGE_STEP_MS;
  }
}

const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Drop onto a bar from a list (Sortable's `outside`): folders on Projects, tokens in a tray.
 * The bar opens a gap under the finger as it moves (`set`, read back with `get`), and letting
 * go there calls `place(key, at)`. A full bar shakes once and takes nothing.
 */
export function barTarget({
  nav,
  keyOf = (id) => id,
  tabOf,
  pinned,
  get,
  set: put,
  place,
}: {
  nav: () => Element | null;
  keyOf?: (id: string) => string;
  tabOf: (key: string) => TabDef | undefined;
  /** The pins now. */
  pinned: () => readonly string[];
  get: () => Aim | null;
  set: (aim: Aim | null) => void;
  place: (key: string, at: number | null, full: boolean) => void;
}): Outside {
  const dock: DockStep = { dir: 0, next: 0 };
  const full = (key: string) => {
    const pins = pinned();
    return !pins.includes(key) && pins.length >= MAX_PINS;
  };
  return {
    hit: (p) => slotAt(nav(), p.x, p.y) !== null,
    lift: (id) => {
      const key = keyOf(id);
      const tab = tabOf(key);
      if (tab) put({ key, tab, at: null });
    },
    aim: (p, id) => {
      const key = keyOf(id);
      const tab = tabOf(key);
      if (!tab) return;
      if (!p) return put({ key, tab, at: null });
      if (full(key)) {
        if (!get()?.refusing) haptic('warn');
        return put({ key, tab, at: null, refusing: true });
      }
      const bar = nav();
      stepDock(bar, p.x, performance.now(), dock, calm());
      const at = slotAt(bar, p.x, p.y, { exclude: key });
      const was = get()?.at;
      if (at !== null && was !== null && was !== undefined && at !== was) haptic('select');
      put({ key, tab, at });
    },
    drop: (id) => {
      const key = keyOf(id);
      if (tabOf(key)) place(key, get()?.at ?? null, full(key));
    },
    end: () => put(null),
  };
}

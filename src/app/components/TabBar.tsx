import { useCallback, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { useBarEdit, withGap } from '../barEdit';
import { useHub, usePartnerHere } from '../context';
import { navigate, useRoute } from '../router';
import { activeTabKey, barDensity, pinsOf, setPins, tabsOf, type TabDef } from '../tabs';
import { replay } from '../ui/flip';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { CANCEL_LIFT, centerScroll, clampBubble, EDGE_DWELL, EDGE_STEP_MS, edgeDir, HOLD_MS, HOLD_SLOP, nearestIndex, slotDistance } from '../ui/scrub';
import { useOnce } from '../ui/useOnce';
import { BarEdit, useFresh } from './BarEdit';
import { markEdges, TabBarView, TabMark } from './TabBarView';
import { calm, CLICK_SWALLOW_MS } from '../ui/tokens';
import { listKey, listIdOf } from '../../core/keys';
import { G } from '../ui/glyphs';

/** One finger on the bar: waiting for the hold, then scrubbing (`live`). */
interface Gesture {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  timer: number;
  live: boolean;
  /** The tab under the finger; null above the bar (cancel); undefined before the first pick. */
  key: string | null | undefined;
  raf: number;
  /** Reduced motion: no swell. */
  still: boolean;
  /** Dock: which way the finger asks the middle to step, and when it next may. */
  edge: { dir: number; next: number };
}

const onPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 959px)').matches;

/**
 * Hold-and-scrub on the live bar (TabBarView): hold still for a moment and slide; the tab under
 * the finger lights up and swells, a bubble names it, and letting go goes there (lift above the
 * bar to cancel). In the dock the middle steps one tab at a time once the finger rests past the
 * outermost tab in view. DECISIONS #8. An edited bar (BarEdit) never scrubs: holding it drags.
 */
function useBarScrub({
  tabs,
  navRef,
  scrollRef,
  onPick,
  onTouch,
}: {
  tabs: TabDef[];
  navRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onPick: (t: TabDef) => void;
  /** Any finger on the bar (the one-time hint leaves). */
  onTouch?: () => void;
}): { scrubKey: string | null; held: boolean; navProps: HTMLAttributes<HTMLElement>; bubble: ReactNode } {
  const [scrub, setScrub] = useState<{ key: string | null } | null>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const g = useRef<Gesture | null>(null);
  const swallow = useRef(false);
  const tabsRef = useRef<TabDef[]>(tabs);
  tabsRef.current = tabs;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  /** Put the bubble over the finger, inside the bar. */
  const placeBubble = useCallback(() => {
    const s = g.current;
    const nav = navRef.current;
    const b = bubbleRef.current;
    if (!s || !nav || !b) return;
    const r = nav.getBoundingClientRect();
    b.style.setProperty('--bx', `${clampBubble(s.x, b.offsetWidth, r.left, r.right) - r.left}px`);
  }, [navRef]);

  const end = useCallback(() => {
    const s = g.current;
    g.current = null;
    if (!s) return;
    clearTimeout(s.timer);
    cancelAnimationFrame(s.raf);
    const nav = navRef.current;
    if (!s.live || !nav) return;
    try {
      if (nav.hasPointerCapture(s.id)) nav.releasePointerCapture(s.id);
    } catch {
      /* already gone */
    }
    nav.querySelectorAll<HTMLElement>('.tab').forEach((el) => el.style.removeProperty('--d'));
    setScrub(null);
  }, [navRef]);

  /** One frame of scrubbing: find the tab under the finger, magnify, place the bubble, step the dock. */
  const frame = useCallback(
    (now: number) => {
      const s = g.current;
      const nav = navRef.current;
      if (!s?.live || !nav) return;
      const bar = nav.getBoundingClientRect();
      const cancel = s.y < bar.top - CANCEL_LIFT;
      const sc = scrollRef.current;
      const view = sc?.getBoundingClientRect();
      const els = [...nav.querySelectorAll<HTMLElement>('.tab')];
      const rects = els.map((el) => el.getBoundingClientRect());
      const x = Math.min(Math.max(s.x, bar.left), bar.right);
      // Only tabs you can see can be picked: in the dock, a middle tab's center must be in view.
      const inView: number[] = [];
      const centers = rects.map((r, i) => {
        const c = r.left + r.width / 2;
        if (!sc?.contains(els[i])) return c;
        if (view && (c < view.left || c > view.right)) return Infinity;
        inView.push(c);
        return c;
      });
      const i = cancel ? -1 : nearestIndex(x, centers);
      const magnify = !cancel && !s.still;
      els.forEach((el, j) => {
        const d = magnify ? slotDistance(x, rects[j].left + rects[j].width / 2, rects[j].width) : 9;
        el.style.setProperty('--d', Math.min(d, 9).toFixed(3));
      });
      const key = i >= 0 ? (els[i].dataset.key ?? null) : null;
      if (key !== s.key) {
        // The first pick already got the lift; every change after it gets a select.
        if (key && s.key !== undefined) haptic('select');
        s.key = key;
        setScrub({ key });
      }
      // Dock: rest past the outermost tab in view and the middle steps one tab, then another.
      if (sc && view && inView.length) {
        const dir = cancel ? 0 : edgeDir(s.x, view.left, view.right, sc.scrollLeft, sc.scrollWidth - sc.clientWidth, Math.min(...inView), Math.max(...inView));
        if (dir !== s.edge.dir) s.edge = { dir, next: now + EDGE_DWELL };
        else if (dir && now >= s.edge.next) {
          const w = rects[i]?.width || 52;
          sc.scrollBy({ left: dir * w, behavior: s.still ? 'auto' : 'smooth' });
          s.edge.next = now + EDGE_STEP_MS;
        }
        markEdges(sc);
      }
      placeBubble();
      s.raf = requestAnimationFrame(frame);
    },
    [navRef, scrollRef, placeBubble],
  );

  const begin = useCallback(() => {
    const s = g.current;
    const nav = navRef.current;
    if (!s || !nav) return;
    try {
      nav.setPointerCapture(s.id);
    } catch {
      /* the pointer is already gone */
    }
    // A button let go somewhere else (a mouse that left the bar) is no hold.
    if (!nav.hasPointerCapture(s.id)) return end();
    s.live = true;
    s.key = undefined;
    s.still = calm();
    haptic('lift');
    s.raf = requestAnimationFrame(frame);
  }, [navRef, frame, end]);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (g.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    swallow.current = false;
    onTouch?.();
    g.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(begin, HOLD_MS),
      live: false,
      key: null,
      raf: 0,
      still: false,
      edge: { dir: 0, next: 0 },
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    s.x = e.clientX;
    s.y = e.clientY;
    // Moving first means a tap that slipped, or a swipe that scrolls natively.
    if (!s.live && Math.hypot(s.x - s.x0, s.y - s.y0) > HOLD_SLOP) end();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    if (!s.live) return end();
    // The release must not also click the tab the gesture began on.
    swallow.current = true;
    setTimeout(() => (swallow.current = false), CLICK_SWALLOW_MS);
    const t = s.key ? tabsRef.current.find((tab) => tab.key === s.key) : undefined;
    end();
    if (t) {
      haptic('tick');
      pickRef.current(t);
    }
  };

  // While scrubbing, a touch must not scroll the dock or the page (React's touch handlers are
  // passive). Every render, since the bar's element is swapped while Projects arranges it.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const hold = (e: TouchEvent) => {
      if (g.current?.live && e.cancelable) e.preventDefault();
    };
    nav.addEventListener('touchmove', hold, { passive: false });
    return () => nav.removeEventListener('touchmove', hold);
  });

  useEffect(() => end, [end]);

  useLayoutEffect(() => {
    if (scrub) placeBubble();
  }, [scrub, placeBubble]);

  const scrubTab = scrub?.key ? tabs.find((t) => t.key === scrub.key) : undefined;

  return {
    scrubKey: scrub?.key ?? null,
    // Held for the whole gesture, the "Let go to cancel" part too (scrubKey is null there).
    held: scrub !== null,
    navProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: end,
      // Leaving before the hold fires (a mouse sliding off) is not a hold either.
      onPointerLeave: (e) => g.current && !g.current.live && e.pointerId === g.current.id && end(),
      // Only the bar's own capture counts (taking it from the tab underneath also fires this).
      onLostPointerCapture: (e) => e.target === e.currentTarget && g.current?.live && e.pointerId === g.current.id && end(),
      // A held tab must not open the link menu or callout.
      onContextMenu: (e) => g.current && e.preventDefault(),
      onClickCapture: (e) => {
        if (!swallow.current) return;
        swallow.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    },
    bubble: scrub ? (
      <span ref={bubbleRef} className={`tabbar__bubble${scrubTab ? ' is-lit' : ' is-cancel'}`} aria-hidden="true">
        {scrubTab ? <TabMark t={scrubTab} /> : <Icon name={G.close} className="icon--sm" />}
        <span dir="auto">{scrubTab ? scrubTab.label : 'Let go to cancel'}</span>
      </span>
    ) : null,
  };
}

/** Arranging from Projects: tapping a project's tab finds its folder; Shopping and Chores just stay. */
function findFolder(t: TabDef) {
  const listId = listIdOf(t.key);
  if (!listId) return;
  const el = document.querySelector<HTMLElement>(`.projslot[data-id="${CSS.escape(listId)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
  replay(el, 'is-flash');
}

/**
 * The live bottom bar. A tap goes straight to a tab; hold and slide to pick one (useBarScrub).
 * In dock mode the middle scrolls and keeps the active tab centered. DECISIONS #8.
 * While Projects arranges it, it is a BarEdit; while a folder or token is dragged toward it, it
 * rises with its labels on and opens a gap under the finger (barEdit's aim).
 */
export function TabBar() {
  const route = useRoute();
  const hub = useHub();
  const here = usePartnerHere();
  const { arranging, aim } = useBarEdit();
  const all = tabsOf(hub);
  const { tabs, gap } = withGap(all, aim);
  const on = activeTabKey(hub, route);
  const density = barDensity(all.length);
  const receiving = !!aim;
  const [hint, hinted] = useOnce('scrub-hint', all.length >= 6 && onPhone());

  const navRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { scrubKey, held, navProps, bubble } = useBarScrub({
    tabs: all,
    navRef,
    scrollRef,
    onPick: (t) => {
      window.dispatchEvent(new Event('gila:scrubbed'));
      navigate(t.path);
    },
    onTouch: hint ? hinted : undefined,
  });

  // Dock: keep the active tab centered, and the edge fades honest.
  const first = useRef(true);
  const tabKeys = all.map((t) => t.key).join('|');
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc) {
      first.current = true;
      return;
    }
    const el = sc.querySelector<HTMLElement>('.tab.is-on');
    if (el) sc.scrollTo({ left: centerScroll(el.offsetLeft, el.offsetWidth, sc.clientWidth, sc.scrollWidth), behavior: first.current || calm() ? 'auto' : 'smooth' });
    first.current = false;
    markEdges(sc);
  }, [on, tabKeys, density, arranging, receiving]);

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const edges = () => markEdges(sc);
    sc.addEventListener('scroll', edges, { passive: true });
    window.addEventListener('resize', edges);
    return () => {
      sc.removeEventListener('scroll', edges);
      window.removeEventListener('resize', edges);
    };
  }, [density, arranging, receiving]);

  const fresh = useFresh(pinsOf(hub), scrollRef);

  // A full bar says no to a newcomer, once each time it is aimed at.
  const refusing = !!aim?.refusing;
  useEffect(() => {
    if (refusing) replay(navRef.current, 'is-refusing');
  }, [refusing]);

  // The one-time hint leaves after six seconds really on screen: time under a sheet or a toast
  // (which would cover it) doesn't count. A first touch on the bar sends it away too.
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!hint) return;
    let shown = 0;
    const tick = () => {
      const hidden = !!document.querySelector('.sheet, .toasts .toast');
      setCovered(hidden);
      if (!hidden && (shown += 250) >= 6000) hinted();
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [hint, hinted]);

  if (arranging) return <BarEdit tabs={tabs} gap={gap} navRef={navRef} onPins={(next) => setPins(hub, next)} onTab={findFolder} />;

  return (
    <TabBarView
      tabs={tabs}
      activeKey={on}
      scrubKey={scrubKey}
      held={held}
      editing={receiving}
      receiving={receiving}
      gap={gap}
      slotClass={(k) => (k === fresh ? 'is-new' : undefined)}
      // My partner is on a project now: its tab (or the pinned one it's inside) glows.
      live={here?.listId ? new Set([listKey(here.listId), ...hub.listPath(here.listId).map((l) => listKey(l.id))]) : undefined}
      navRef={navRef}
      scrollRef={scrollRef}
      onTab={(t, e) => {
        e.preventDefault();
        navigate(t.path);
      }}
      navProps={receiving ? undefined : navProps}
    >
      {bubble}
      {hint && !receiving && !scrubKey && !bubble && !covered ? (
        <span className="tabbar__hint" role="status">
          <Icon name={G.holdHint} className="icon--sm" />
          Hold and slide to pick
        </span>
      ) : null}
    </TabBarView>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useHub, usePartnerShopping } from '../context';
import { navigate, useRoute } from '../router';
import { activeTabKey, barDensity, tabsOf, type TabDef } from '../tabs';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { CANCEL_LIFT, centerScroll, clampBubble, edgeSpeed, HOLD_MS, HOLD_SLOP, nearestIndex, slotDistance } from '../ui/scrub';
import { useOnce } from '../ui/useOnce';
import { markEdges, TabBarView, TabMark } from './TabBarView';

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
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const onPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 959px)').matches;

/**
 * The live bottom bar. A tap goes straight to a tab. Hold it still for a moment and slide:
 * the tab under the finger lights up and swells, a bubble names it, and letting go goes
 * there (lift above the bar to cancel). In dock mode the middle scrolls, follows the
 * finger near its edges, and keeps the active tab centered. DECISIONS #8.
 */
export function TabBar() {
  const route = useRoute();
  const hub = useHub();
  const shopping = usePartnerShopping();
  const tabs = tabsOf(hub);
  const on = activeTabKey(hub, route);
  const density = barDensity(tabs.length);
  const [scrub, setScrub] = useState<{ key: string | null } | null>(null);
  const [hint, hinted] = useOnce('scrub-hint', tabs.length >= 6 && onPhone());

  const navRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const g = useRef<Gesture | null>(null);
  const swallow = useRef(false);
  const tabsRef = useRef<TabDef[]>(tabs);
  tabsRef.current = tabs;

  /** Put the bubble over the finger, inside the bar. */
  const placeBubble = useCallback(() => {
    const s = g.current;
    const nav = navRef.current;
    const b = bubbleRef.current;
    if (!s || !nav || !b) return;
    const r = nav.getBoundingClientRect();
    b.style.setProperty('--bx', `${clampBubble(s.x, b.offsetWidth, r.left, r.right) - r.left}px`);
  }, []);

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
  }, []);

  /** One frame of scrubbing: auto-scroll, find the tab under the finger, magnify, place the bubble. */
  const frame = useCallback(() => {
    const s = g.current;
    const nav = navRef.current;
    if (!s?.live || !nav) return;
    const bar = nav.getBoundingClientRect();
    const cancel = s.y < bar.top - CANCEL_LIFT;
    const sc = scrollRef.current;
    const view = sc?.getBoundingClientRect();
    if (sc && view && !cancel) {
      const v = edgeSpeed(s.x, view.left, view.right, sc.scrollLeft, sc.scrollWidth - sc.clientWidth);
      if (v) {
        sc.scrollLeft += v;
        markEdges(sc);
      }
    }
    const els = [...nav.querySelectorAll<HTMLElement>('.tab')];
    const rects = els.map((el) => el.getBoundingClientRect());
    const x = Math.min(Math.max(s.x, bar.left), bar.right);
    // Only tabs you can see can be picked: in the dock, a middle tab's center must be in view.
    const centers = rects.map((r, i) => {
      const c = r.left + r.width / 2;
      const inScroller = sc?.contains(els[i]);
      return inScroller && view && (c < view.left || c > view.right) ? Infinity : c;
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
    placeBubble();
    s.raf = requestAnimationFrame(frame);
  }, [placeBubble]);

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
    s.still = reducedMotion();
    haptic('lift');
    s.raf = requestAnimationFrame(frame);
  }, [frame, end]);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (g.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    swallow.current = false;
    if (hint) hinted();
    g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, timer: window.setTimeout(begin, HOLD_MS), live: false, key: null, raf: 0, still: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    s.x = e.clientX;
    s.y = e.clientY;
    // Moving first means a tap that slipped, or a swipe the dock scrolls natively.
    if (!s.live && Math.hypot(s.x - s.x0, s.y - s.y0) > HOLD_SLOP) end();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    if (!s.live) return end();
    // The release must not also click the tab the gesture began on.
    swallow.current = true;
    setTimeout(() => (swallow.current = false), 400);
    const t = s.key ? tabsRef.current.find((tab) => tab.key === s.key) : undefined;
    end();
    if (t) {
      haptic('tick');
      navigate(t.path);
    }
  };

  // While scrubbing, a touch must not scroll the dock or the page (React's touch handlers are passive).
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const hold = (e: TouchEvent) => {
      if (g.current?.live && e.cancelable) e.preventDefault();
    };
    nav.addEventListener('touchmove', hold, { passive: false });
    return () => nav.removeEventListener('touchmove', hold);
  }, []);

  useEffect(() => end, [end]);

  useLayoutEffect(() => {
    if (scrub) placeBubble();
  }, [scrub, placeBubble]);

  // Dock: keep the active tab centered, and the edge fades honest.
  const first = useRef(true);
  const tabKeys = tabs.map((t) => t.key).join('|');
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc) {
      first.current = true;
      return;
    }
    const el = sc.querySelector<HTMLElement>('.tab.is-on');
    if (el) sc.scrollTo({ left: centerScroll(el.offsetLeft, el.offsetWidth, sc.clientWidth, sc.scrollWidth), behavior: first.current || reducedMotion() ? 'auto' : 'smooth' });
    first.current = false;
    markEdges(sc);
  }, [on, tabKeys, density]);

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
  }, [density]);

  // The one-time hint leaves after a while on screen (not counting time under a sheet), or on the first touch.
  useEffect(() => {
    if (!hint) return;
    let shown = 0;
    const timer = setInterval(() => {
      if (!document.querySelector('.sheet') && ++shown >= 6) hinted();
    }, 1000);
    return () => clearInterval(timer);
  }, [hint, hinted]);

  const scrubTab = scrub?.key ? tabs.find((t) => t.key === scrub.key) : undefined;

  return (
    <TabBarView
      tabs={tabs}
      activeKey={on}
      scrubKey={scrub?.key ?? null}
      live={shopping ? new Set(['shop']) : undefined}
      navRef={navRef}
      scrollRef={scrollRef}
      onTab={(t, e) => {
        e.preventDefault();
        navigate(t.path);
      }}
      navProps={{
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
      }}
    >
      {scrub ? (
        <span ref={bubbleRef} className={`tabbar__bubble${scrubTab ? ' is-lit' : ' is-cancel'}`} aria-hidden="true">
          {scrubTab ? <TabMark t={scrubTab} /> : <Icon name="x" className="icon--sm" />}
          <span dir="auto">{scrubTab ? scrubTab.label : 'Let go to cancel'}</span>
        </span>
      ) : null}
      {hint && !scrub ? (
        <span className="tabbar__hint" role="status">
          <Icon name="hand" className="icon--sm" />
          Hold and slide to pick
        </span>
      ) : null}
    </TabBarView>
  );
}

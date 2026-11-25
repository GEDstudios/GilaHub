import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { today as todayStr } from '../../core/dates';
import { useHub } from '../context';
import { barDensity, COMFY_TABS, DEFAULT_PINS, isDefaultPins, pinOptions, pinsOf, setPins, type TabDef } from '../tabs';
import { useFlip, replay } from '../ui/flip';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { slotDistance } from '../ui/scrub';
import { choresView, openCount, todayView } from '../views';
import { Arranger, type ArrangerRow, type ArrangerToken } from './Arranger';
import { markEdges, TabBarView, TabMark } from './TabBarView';

const TODAY: TabDef = { key: 'today', label: 'Today', path: '/', icon: 'sun' };
const PROJECTS: TabDef = { key: 'projects', label: 'Projects', path: '/lists', icon: 'folders' };
const DEMO_MS = 1600;
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The bottom bar, arranged in Settings (SETTINGS §3.2, DECISIONS #7): the real bar as a live
 * preview on a gray stage, then the arranger. Today and Projects stay put; everything between
 * drags by its grip, × takes it out, and the tray adds it back (just before Projects), in
 * project order. The preview follows the drag as it happens; the pins are saved only on a
 * drop, add, remove or reset, so a drag doesn't flood sync.
 */
export function BarEditor() {
  const hub = useHub();
  const { toast } = useOverlays();
  const pins = pinsOf(hub);
  const opts = pinOptions(hub);
  const byKey = new Map(opts.map((o) => [o.key, o]));

  const [draft, setDraft] = useState<string[] | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [scrub, setScrub] = useState<string | null>(null);

  const order = (draft ?? pins).filter((k) => byKey.has(k));
  const tabs = [TODAY, ...order.map((k) => byKey.get(k)!), PROJECTS];
  const crowded = tabs.length > COMFY_TABS;
  const navRef = useRef<HTMLElement>(null);
  useFlip(navRef, tabs.map((t) => t.key).join('|'), barDensity(tabs.length));

  // In the dock, the scrolling middle fades only on the sides with more to see, as on the real bar.
  useLayoutEffect(() => {
    const sc = navRef.current?.querySelector<HTMLElement>('.tabbar__scroll');
    if (!sc) return;
    const on = () => markEdges(sc);
    on();
    sc.addEventListener('scroll', on, { passive: true });
    return () => sc.removeEventListener('scroll', on);
  });

  // Slots that just arrived pop in; nothing on first draw.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const sig = pins.join('|');
  useEffect(() => {
    const prev = seen.current;
    seen.current = new Set(pins);
    const added = prev ? pins.find((k) => !prev.has(k)) : undefined;
    setFresh(added ?? null);
    if (!added) return;
    // In the dock, bring the newcomer into the scrolling middle's view.
    const sc = navRef.current?.querySelector<HTMLElement>('.tabbar__scroll');
    const el = sc?.querySelector<HTMLElement>(`[data-key="${CSS.escape(added)}"]`);
    if (sc && el) sc.scrollTo({ left: el.offsetLeft + el.offsetWidth / 2 - sc.clientWidth / 2, behavior: calm() ? 'auto' : 'smooth' });
    const t = setTimeout(() => setFresh(null), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const save = (next: string[], message?: string) => {
    const before = pins;
    setPins(hub, next);
    if (message) toast(message, { action: { label: 'Undo', run: () => setPins(hub, before) } });
  };

  const ref = todayStr();
  const toBuy = todayView(hub, ref).shopping.count;
  const ready = choresView(hub, ref).now.length;
  /** One live line under each row, like Edit Today's. */
  const subOf = (k: string): string | undefined => {
    if (k === 'shop') return toBuy ? `${toBuy} to buy` : 'Nothing to buy';
    if (k === 'chores') return hub.isAway() ? 'Paused while you’re away' : ready ? `${ready} ready` : 'All fresh';
    if (k.startsWith('l:')) {
      const n = openCount(hub, k.slice(2));
      return n ? `${n} open` : 'Nothing open';
    }
    return undefined;
  };

  const rows: ArrangerRow[] = pins
    .filter((k) => byKey.has(k))
    .map((k) => {
      const t = byKey.get(k)!;
      return { key: k, title: t.label, mark: <TabMark t={t} />, sub: subOf(k) };
    });

  const tokens: ArrangerToken[] = opts
    .filter((o) => !pins.includes(o.key))
    .map((o) => ({ key: o.key, label: o.label, mark: <TabMark t={o} />, onClick: () => save([...pins, o.key]) }));

  /** Tap a slot in the preview: its row comes into view and flashes. */
  const findRow = (t: TabDef) => {
    const row = document.querySelector<HTMLElement>(`.bareditor [data-slot="${CSS.escape(t.key)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
    replay(row, 'is-flash');
  };

  /** "Crowded?": a finger slides along the preview and each slot lifts in turn, like hold-and-slide. */
  const demoRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(demoRef.current), []);
  const demo = () => {
    const nav = navRef.current;
    if (!nav || demoRef.current) return;
    const dot = nav.querySelector<HTMLElement>('.scrubdot');
    const els = [...nav.querySelectorAll<HTMLElement>('.tab')];
    const box = nav.getBoundingClientRect();
    const sc = nav.querySelector<HTMLElement>('.tabbar__scroll');
    const view = sc?.getBoundingClientRect();
    const slots = els
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, key: el.dataset.key ?? '', c: r.left + r.width / 2 - box.left, w: r.width };
      })
      // Only what you can see, as with a real finger on the dock.
      .filter((s) => !sc?.contains(s.el) || !view || (s.c + box.left >= view.left && s.c + box.left <= view.right));
    if (!slots.length) return;
    const from = slots[0].c;
    const to = slots[slots.length - 1].c;
    const still = calm();
    const start = performance.now();
    let last = '';
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / DEMO_MS);
      // Ease in and out, with a beat at each end.
      const e = p < 0.1 ? 0 : p > 0.9 ? 1 : 0.5 - Math.cos(((p - 0.1) / 0.8) * Math.PI) / 2;
      const x = from + (to - from) * e;
      dot?.style.setProperty('--x', `${x}px`);
      let near = slots[0];
      for (const s of slots) {
        if (Math.abs(s.c - x) < Math.abs(near.c - x)) near = s;
        if (!still) s.el.style.setProperty('--d', Math.min(slotDistance(x, s.c, s.w), 9).toFixed(3));
      }
      if (near.key !== last) {
        last = near.key;
        setScrub(near.key);
      }
      if (p < 1) {
        demoRef.current = requestAnimationFrame(frame);
        return;
      }
      demoRef.current = 0;
      els.forEach((el) => el.style.removeProperty('--d'));
      setScrub(null);
    };
    demoRef.current = requestAnimationFrame(frame);
  };

  return (
    <div className="bareditor">
      <div className="barstage">
        <TabBarView
          tabs={tabs}
          activeKey="today"
          scrubKey={scrub}
          preview
          liftedKey={lifted}
          slotClass={(k) => (k === leaving ? 'is-leaving' : k === fresh ? 'is-new' : undefined)}
          navRef={navRef}
          onTab={findRow}
        >
          <span className="scrubdot" aria-hidden="true" />
        </TabBarView>
        {crowded ? (
          <button type="button" className="barhint" onClick={demo}>
            <Icon name="hand" className="icon--sm" />
            Crowded? Hold the bar and slide to pick.
          </button>
        ) : (
          <p className="barstage__cap">
            <span className="on-phone">Drag to arrange. It follows you to your other devices.</span>
            <span className="on-desk">Your phone’s bar. On a computer the same order shows in the sidebar.</span>
          </p>
        )}
      </div>
      <Arranger
        top={[{ key: 'today', mark: <Icon name="sun" />, title: 'Today', sub: 'Always first' }]}
        bottom={[{ key: 'projects', mark: <Icon name="folders" />, title: 'Projects', sub: 'Always last' }]}
        rows={rows}
        onMove={(keys) => setPins(hub, keys)}
        onPreview={(d) => {
          setDraft(d);
          if (!d) setLifted(null);
        }}
        onLift={setLifted}
        onLeave={setLeaving}
        onHide={(key) => {
          setLeaving(null);
          save(
            pins.filter((k) => k !== key),
            `Took ${byKey.get(key)?.label ?? 'it'} out of the bar`,
          );
        }}
        hideLabel={(r) => `Take ${r.title} out of the bar`}
        trayTitle="Add to the bar"
        tokens={tokens}
        trayEmpty="Everything’s in the bar."
        reset={
          isDefaultPins(pins)
            ? undefined
            : {
                label: 'Back to the default',
                run: () => save([...DEFAULT_PINS], 'The bar is back to the default'),
              }
        }
      />
    </div>
  );
}

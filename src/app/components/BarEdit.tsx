import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { BarGap } from '../barEdit';
import { barDensity, type TabDef } from '../tabs';
import { EditX } from '../ui/edit';
import { useFlip } from '../ui/flip';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Sortable, useSortableItem, type Outside } from '../ui/Sortable';
import { markEdges, TabBarView, TabMark } from './TabBarView';
import { calm } from '../ui/tokens';
import { G } from '../ui/glyphs';

const TAB_LEAN = () => ({ rest: -4, land: 0 });
const LEAVE_MS = 200;
/** A tab dragged this far (px) above the bar is out of it. */
const OUT_REACH = 56;

/** The key that just appeared (one at a time), for a pop; in the dock it scrolls into view. Nothing on first draw. */
export function useFresh(keys: readonly string[], scrollRef?: RefObject<HTMLElement | null>): string | null {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const sig = keys.join('|');
  useEffect(() => {
    const prev = seen.current;
    seen.current = new Set(keys);
    const added = prev ? (keys.find((k) => !prev.has(k)) ?? null) : null;
    setFresh(added);
    if (!added) return;
    const sc = scrollRef?.current;
    const el = sc?.querySelector<HTMLElement>(`[data-key="${CSS.escape(added)}"]`);
    if (sc && el) sc.scrollTo({ left: el.offsetLeft + el.offsetWidth / 2 - sc.clientWidth / 2, behavior: calm() ? 'auto' : 'smooth' });
    const t = setTimeout(() => setFresh(null), 400);
    return () => clearTimeout(t);
    // The keys, compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return fresh;
}

/** A tab in the hand: a tab of the bar being moved, or a folder or token over the bar. */
export function TabChip({ t, out = false }: { t: TabDef; out?: boolean }) {
  return (
    <span className={`tabchip${out ? ' is-out' : ''}`}>
      <span className="tab__mark">
        <TabMark t={t} />
      </span>
      <span className="tab__label" dir="auto">
        {t.label}
      </span>
    </span>
  );
}

/**
 * Something that can go in the bar, as a token beside it: a tap puts it just before Projects; a
 * long-press (or a mouse drag) lifts it, to drop where you let go (in a <Sortable still>).
 */
export function BarToken({ t, full, onAdd }: { t: TabDef; full?: boolean; onAdd: () => void }) {
  const s = useSortableItem(t.key);
  return (
    <button
      ref={s.ref}
      type="button"
      style={s.style}
      className={`token ${s.className}`}
      data-drag
      {...s.props}
      aria-label={`Add ${t.label} to the bar`}
      aria-disabled={full || undefined}
      onClick={() => {
        if (full) return;
        haptic('tick');
        onAdd();
      }}
    >
      <TokenFace t={t} />
    </button>
  );
}

function TokenFace({ t }: { t: TabDef }) {
  return (
    <>
      <TabMark t={t} />
      <span dir="auto">{t.label}</span>
      <Icon name={G.add} className="token__plus" />
    </>
  );
}

/** A token in the hand (the overlay of a <Sortable still> of BarTokens): a tab once it's over the bar. */
export function BarTokenLifted({ t, outside }: { t: TabDef; outside: boolean }) {
  return outside ? (
    <TabChip t={t} />
  ) : (
    <span className="token">
      <TokenFace t={t} />
    </span>
  );
}

/** A tab you can move: the whole tab is the grip; its × sits on the mark's shoulder. */
function MovableTab({
  t,
  className,
  inner,
  state,
  onTab,
  onTake,
}: {
  t: TabDef;
  className: string;
  inner: ReactNode;
  state?: 'new' | 'leaving' | 'out';
  onTab?: () => void;
  onTake: () => void;
}) {
  const s = useSortableItem(t.key);
  return (
    <span ref={s.ref} style={s.style} className={`tabslot ${s.className}${state ? ` is-${state}` : ''}`} data-key={t.key} data-grip {...s.props}>
      <span
        ref={s.gripRef}
        {...s.gripProps}
        className={className}
        aria-roledescription="movable tab"
        aria-label={t.label}
        onClick={onTab}
        onKeyDown={(e) => {
          if (e.key !== 'Delete' && e.key !== 'Backspace') return;
          e.preventDefault();
          onTake();
        }}
      >
        {inner}
      </span>
      <EditX size="badge" label={`Take ${t.label} out of the bar`} onClick={onTake} />
    </span>
  );
}

/**
 * The bottom bar, edited where it is, while Folders arranges it. Drag a tab along the bar to move
 * it, drag it up out of the bar (or tap its ×) to take it out; folders and tokens dropped onto it
 * open `gap`. No scrub and no links here: holding the bar is a drag. One `onPins` per change.
 */
export function BarEdit({
  tabs,
  gap = null,
  navRef,
  onPins,
  onTab,
}: {
  /** The whole bar, Today and Projects included (without a key that is being aimed in). */
  tabs: TabDef[];
  gap?: BarGap | null;
  navRef: RefObject<HTMLElement | null>;
  onPins: (next: string[]) => void;
  onTab?: (t: TabDef) => void;
}) {
  const ids = tabs.slice(1, -1).map((t) => t.key);
  const byKey = new Map(tabs.map((t) => [t.key, t]));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const fresh = useFresh(ids, scrollRef);
  const latest = useRef({ ids, onPins });
  latest.current = { ids, onPins };

  // Nothing between Today and Projects: one dashed + shows where things go.
  const slot = gap ?? (ids.length ? null : { at: 0 });
  const density = barDensity(tabs.length + (slot ? 1 : 0), { editing: true });
  const order = ids.filter((k) => k !== out && k !== leaving);
  if (slot) order.splice(slot.at, 0, `+${slot.tab?.key ?? ''}`);
  useFlip(navRef, order.join('|'), density);

  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const on = () => markEdges(sc);
    on();
    sc.addEventListener('scroll', on, { passive: true });
    return () => sc.removeEventListener('scroll', on);
  });

  /** × (or Delete): it shrinks away, then leaves; focus moves to its neighbour, else the first token. */
  const take = (key: string) => {
    if (leaving) return;
    const { ids: now } = latest.current;
    const i = now.indexOf(key);
    const next = now[i + 1] ?? now[i - 1];
    const focused = !!navRef.current?.contains(document.activeElement);
    haptic('tick');
    setLeaving(key);
    setTimeout(
      () => {
        setLeaving(null);
        latest.current.onPins(latest.current.ids.filter((k) => k !== key));
        if (!focused) return;
        requestAnimationFrame(() => {
          const el = next
            ? navRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next)}"] > .tab`)
            : document.querySelector<HTMLElement>('.bartray .token');
          el?.focus();
        });
      },
      calm() ? 0 : LEAVE_MS,
    );
  };

  // Drag a tab up out of the bar to take it out: past the line, the bar closes up and a note says so.
  const outside = useMemo<Outside>(
    () => ({
      hit: (p) => {
        const r = navRef.current?.getBoundingClientRect();
        return !!r?.width && p.y < r.top - OUT_REACH;
      },
      aim: (p, id) => setOut(p ? id : null),
      drop: (id) => latest.current.onPins(latest.current.ids.filter((k) => k !== id)),
      note: (
        <span className="handnote">
          <Icon name={G.close} />
          Let go to take it out
        </span>
      ),
    }),
    [navRef],
  );

  return (
    <Sortable
      layout="bar"
      ids={ids}
      onMove={(next) => onPins(next)}
      label={(id) => byKey.get(id)?.label ?? ''}
      renderOverlay={(id, { outside: isOut }) => {
        const t = byKey.get(id);
        return t ? <TabChip t={t} out={isOut} /> : null;
      }}
      lean={TAB_LEAN}
      outside={outside}
      grips
      instructions="Press space to pick up. Arrows move it, space drops, escape cancels. Delete takes it out."
    >
      <TabBarView
        tabs={tabs}
        activeKey={null}
        editing
        gap={slot}
        out={out}
        navRef={navRef}
        scrollRef={scrollRef}
        renderTab={(t, { className, inner }) => (
          <MovableTab
            t={t}
            className={className}
            inner={inner}
            state={t.key === leaving ? 'leaving' : t.key === out ? 'out' : t.key === fresh ? 'new' : undefined}
            onTab={onTab ? () => onTab(t) : undefined}
            onTake={() => take(t.key)}
          />
        )}
      />
    </Sortable>
  );
}

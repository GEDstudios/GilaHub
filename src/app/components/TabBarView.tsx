import { Fragment, type CSSProperties, type HTMLAttributes, type MouseEvent, type ReactElement, type ReactNode, type Ref } from 'react';
import type { BarGap } from '../barEdit';
import { barDensity, type TabDef } from '../tabs';
import { Icon } from '../ui/Icon';
import { ProjectMark } from '../ui/ProjectMark';
import { G } from '../ui/glyphs';

/** Keep the dock's edge fades only on the sides that have more to scroll to. */
export function markEdges(sc: HTMLElement): void {
  sc.classList.toggle('has-before', sc.scrollLeft > 1);
  sc.classList.toggle('has-after', sc.scrollLeft < sc.scrollWidth - sc.clientWidth - 1);
}

/** A tab's mark: a built-in icon, or the project's glyph in its color. */
export function TabMark({ t }: { t: TabDef }) {
  return t.icon ? <Icon name={t.icon} /> : <ProjectMark color={t.color} icon={t.glyph} />;
}

/**
 * The bottom bar's markup and its density rules, with no behaviour of its own. The live bar
 * (TabBar.tsx) adds routing and hold-and-scrub; BarEdit makes it editable.
 *
 *   comfy  up to 5 tabs: icon and label, a pill slides to the active tab
 *   snug   6–7: icons only; the active tab rises and shows its label
 *   dock   8 or more: Today and Projects stay put around a scrolling middle (`scrollRef`)
 *
 * Editing (`editing`): every tab keeps its label, nothing is current, the ends are quiet
 * anchors, and `gap` opens a dashed slot where a drag would land (an equal grid up to 6 slots,
 * a dock from 7). `renderTab` draws each movable tab (BarEdit: a sortable slot with its ×).
 */
export function TabBarView({
  tabs,
  activeKey,
  scrubKey = null,
  held = false,
  editing = false,
  receiving = false,
  gap = null,
  out = null,
  slotClass,
  renderTab,
  live,
  navRef,
  scrollRef,
  onTab,
  navProps,
  children,
}: {
  tabs: TabDef[];
  activeKey: string | null;
  /** The tab under the finger while the bar is held (lit instead of the active one). */
  scrubKey?: string | null;
  /** The bar is held (a tab picked, or "Let go to cancel"): what floats over it steps aside. */
  held?: boolean;
  editing?: boolean;
  /** A folder or token is being dragged and may land here: the bar rises to meet it. */
  receiving?: boolean;
  gap?: BarGap | null;
  /** A tab held up out of the bar: its slot closes (it still counts for the density). */
  out?: string | null;
  /** Extra classes per tab (one popping in). */
  slotClass?: (key: string) => string | undefined;
  renderTab?: (t: TabDef, parts: { className: string; inner: ReactNode }) => ReactElement;
  /** Tabs that carry a live dot (my partner is shopping). */
  live?: ReadonlySet<string>;
  navRef?: Ref<HTMLElement>;
  scrollRef?: Ref<HTMLDivElement>;
  onTab?: (t: TabDef, e: MouseEvent<HTMLElement>) => void;
  /** Gesture handlers for the live bar. */
  navProps?: HTMLAttributes<HTMLElement>;
  /** Floating bits: the scrub bubble, the one-time hint. */
  children?: ReactNode;
}) {
  const n = tabs.length + (gap ? 1 : 0);
  const density = barDensity(n, { editing });
  const pill = editing ? -1 : tabs.findIndex((t) => t.key === (scrubKey ?? activeKey));
  const cls = [
    'tabbar',
    `tabbar--${density}`,
    editing ? 'tabbar--edit' : '',
    receiving ? 'is-receiving' : '',
    held ? 'is-held' : '',
    scrubKey ? 'is-scrubbing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const marks = (t: TabDef) => (
    <>
      <span className="tab__mark">
        <TabMark t={t} />
        {live?.has(t.key) ? <span className="tab__live live" /> : null}
      </span>
      <span className="tab__label" dir="auto">
        {t.label}
      </span>
    </>
  );

  const tab = (t: TabDef, i: number) => {
    const on = !editing && t.key === activeKey;
    const extra = slotClass?.(t.key);
    const className = `tab${on ? ' is-on' : ''}${t.key === scrubKey ? ' is-scrub' : ''}${extra ? ` ${extra}` : ''}`;
    if (editing) {
      const end = i === 0 ? 'Always first' : i === tabs.length - 1 ? 'Always last' : null;
      if (end)
        return (
          <span key={t.key} className={`${className} is-anchor`} data-key={t.key} aria-disabled="true" aria-description={end}>
            {marks(t)}
          </span>
        );
      if (renderTab) return <Fragment key={t.key}>{renderTab(t, { className, inner: marks(t) })}</Fragment>;
    }
    return editing ? (
      <span key={t.key} className={className} data-key={t.key} onClick={onTab ? (e) => onTab(t, e) : undefined}>
        {marks(t)}
      </span>
    ) : (
      <a
        key={t.key}
        href={t.path}
        className={className}
        data-key={t.key}
        aria-current={on ? 'page' : undefined}
        draggable={false}
        onClick={onTab ? (e) => onTab(t, e) : undefined}
      >
        {marks(t)}
      </a>
    );
  };

  const middle = tabs.slice(1, -1).map((t, i) => tab(t, i + 1));
  if (gap)
    middle.splice(
      Math.min(Math.max(gap.at, 0), middle.length),
      0,
      <span key="__gap" className={`tab is-gap${gap.tab ? '' : ' is-empty'}`} data-key="__gap" aria-hidden="true">
        {gap.tab ? (
          marks(gap.tab)
        ) : (
          <span className="tab__mark">
            <Icon name={G.add} />
          </span>
        )}
      </span>,
    );
  const first = tab(tabs[0], 0);
  const last = tab(tabs[tabs.length - 1], tabs.length - 1);

  return (
    <nav
      ref={navRef}
      className={cls}
      aria-label="Main"
      style={{ '--n': n - (out ? 1 : 0), '--i': Math.max(pill, 0) } as CSSProperties}
      {...navProps}
    >
      {density !== 'dock' && pill >= 0 ? <span className="tabbar__pill" aria-hidden="true" /> : null}
      {density === 'dock' ? (
        <>
          {first}
          <div className="tabbar__scroll" ref={scrollRef}>
            {middle}
          </div>
          {last}
        </>
      ) : (
        <>
          {first}
          {middle}
          {last}
        </>
      )}
      {children}
    </nav>
  );
}

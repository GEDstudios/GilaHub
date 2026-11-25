import type { CSSProperties, HTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { barDensity, type TabDef } from '../tabs';
import { Icon } from '../ui/Icon';
import { ProjectMark } from '../ui/ProjectMark';

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
 * (TabBar.tsx) adds routing and hold-and-scrub; Settings shows the same thing as a preview.
 *
 *   comfy  up to 5 tabs: icon and label, a pill slides to the active tab
 *   snug   6–7: icons only; the active tab rises and shows its label
 *   dock   8 or more: Today and Projects stay put around a scrolling middle (`scrollRef`)
 */
export function TabBarView({
  tabs,
  activeKey,
  scrubKey = null,
  held = false,
  preview = false,
  liftedKey = null,
  slotClass,
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
  /** Settings' preview: static, and the slots are not links. */
  preview?: boolean;
  /** A slot whose row is being dragged in Settings. */
  liftedKey?: string | null;
  /** Extra classes per slot in the preview (a slot popping in, or shrinking out). */
  slotClass?: (key: string) => string | undefined;
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
  const density = barDensity(tabs.length);
  const pill = tabs.findIndex((t) => t.key === (scrubKey ?? activeKey));
  const cls = ['tabbar', `tabbar--${density}`, preview ? 'tabbar--preview' : '', held ? 'is-held' : '', scrubKey ? 'is-scrubbing' : ''].filter(Boolean).join(' ');

  const tab = (t: TabDef) => {
    const on = t.key === activeKey;
    const extra = slotClass?.(t.key);
    const className = `tab${on ? ' is-on' : ''}${t.key === scrubKey ? ' is-scrub' : ''}${t.key === liftedKey ? ' is-lifted' : ''}${extra ? ` ${extra}` : ''}`;
    const inner = (
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
    return preview ? (
      <span key={t.key} className={className} data-key={t.key} onClick={onTab ? (e) => onTab(t, e) : undefined}>
        {inner}
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
        {inner}
      </a>
    );
  };

  return (
    <nav ref={navRef} className={cls} aria-label={preview ? 'Bottom bar preview' : 'Main'} style={{ '--n': tabs.length, '--i': Math.max(pill, 0) } as CSSProperties} {...navProps}>
      {density !== 'dock' && pill >= 0 ? <span className="tabbar__pill" aria-hidden="true" /> : null}
      {density === 'dock' ? (
        <>
          {tab(tabs[0])}
          <div className="tabbar__scroll" ref={scrollRef}>
            {tabs.slice(1, -1).map(tab)}
          </div>
          {tab(tabs[tabs.length - 1])}
        </>
      ) : (
        tabs.map(tab)
      )}
      {children}
    </nav>
  );
}

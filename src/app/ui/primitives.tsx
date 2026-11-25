import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LineColor, List, Member } from '../../core/model';
import { haptic } from './haptics';
import { Icon, type IconName } from './Icon';

export const lineVars = (c: LineColor | undefined): CSSProperties =>
  ({ '--c': c ? `var(--${c})` : 'var(--tile-2)', '--c-soft': c ? `var(--${c}-soft)` : 'var(--tile)' }) as CSSProperties;

/** A person's icon light (--me-light, --them): their color, with lemon standing in for ink. */
export const lightVar = (c: LineColor): string => `var(--${c === 'ink' ? 'lemon' : c})`;

const firstGrapheme = (s: string): string => {
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const t = s.trim();
  if (!t) return '?';
  if (seg) for (const { segment } of seg.segment(t)) return segment.toUpperCase();
  return t[0].toUpperCase();
};

type Size = 'xs' | 'sm' | 'md' | 'lg';

/** The first letter of a name (a whole grapheme, so emoji and accents survive), upper-cased. */
export const initialOf = (s: string): string => firstGrapheme(s);

/** A person: a round avatar in their color with their initial. */
export function Avatar({ member, size = 'sm', name, color }: { member?: Member; size?: Size; name?: string; color?: LineColor }) {
  const n = member?.name ?? name ?? '';
  const c = member?.color ?? color;
  if (!n && !c) return null;
  return (
    <span className={`avatar avatar--${size}`} style={lineVars(c)} title={n} aria-hidden="true">
      {firstGrapheme(n)}
    </span>
  );
}

/** A project: a small soft square of its color. */
export function ListBullet({ list, size = 'sm' }: { list: Pick<List, 'name' | 'color' | 'icon'> | undefined; size?: Size }) {
  return <span className={`dot dot--${size}`} style={lineVars(list?.color)} title={list?.name} aria-hidden="true" />;
}

export function Check({
  on,
  color,
  onToggle,
  label,
  disabled,
}: {
  on: boolean;
  color?: LineColor;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}) {
  const [pop, setPop] = useState(false);
  return (
    <button
      type="button"
      className={`check ${on ? 'is-on' : ''} ${pop ? 'is-pop' : ''}`}
      style={lineVars(color)}
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!on) {
          haptic('tick');
          setPop(true);
        }
        onToggle();
      }}
      onAnimationEnd={() => setPop(false)}
    >
      <svg className="check__tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 12.5l4 4L18 8" pathLength={20} />
      </svg>
    </button>
  );
}

/** Observe when an element scrolls out of view (for the compact header). */
export function useScrolledPast<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting), { rootMargin: '-56px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, past];
}

/** A gray circle for header and sheet chrome (Search, …, Back, Close, Pause). */
export function IconButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button type="button" className="iconbtn" onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}

/**
 * New: the one black "+" in the app, always the rightmost thing in a screen's header.
 * It opens a sheet already pointed at where you are (see addAction.ts).
 */
export function NewButton({ onClick, label = 'New' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="iconbtn iconbtn--solid" onClick={onClick} aria-label={label} title={label} aria-keyshortcuts="N">
      <Icon name="plus" />
    </button>
  );
}

/**
 * A screen header: a quiet top row (back or avatar, actions) and a serif title.
 * When the title scrolls away, a compact bar keeps the context.
 */
export function Band({
  title,
  sub,
  top,
  actions,
  crumbs,
  mini,
  onBack,
  className,
  children,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  /** Top-left corner (an avatar) when there is no Back button. */
  top?: ReactNode;
  actions?: ReactNode;
  crumbs?: ReactNode;
  mini?: string;
  onBack?: () => void;
  className?: string;
  /** Rendered below the title (e.g. a color card). */
  children?: ReactNode;
}) {
  const [ref, past] = useScrolledPast<HTMLElement>();
  return (
    <>
      <header className={`band ${className ?? ''}`} ref={ref}>
        {onBack || top || actions ? (
          <div className="band__top">
            {onBack ? <IconButton icon="arrow-back" label="Back" onClick={onBack} /> : (top ?? <span />)}
            {actions ? <div className="band__actions">{actions}</div> : null}
          </div>
        ) : null}
        {crumbs}
        {title ? (
          <h1 className="band__title" dir="auto">
            {title}
          </h1>
        ) : null}
        {sub ? <p className="band__sub">{sub}</p> : null}
        {children}
      </header>
      <div className={`miniband ${past ? 'is-on' : ''}`} aria-hidden={!past}>
        {onBack ? (
          <button type="button" className="miniband__back" onClick={onBack} aria-label="Back" tabIndex={past ? 0 : -1}>
            <Icon name="arrow-back" />
          </button>
        ) : null}
        <span dir="auto">{mini ?? (typeof title === 'string' ? title : '')}</span>
      </div>
    </>
  );
}

/** Tasky's signature: a big rounded card of one color, a serif title, a quiet line under it. */
export function ColorCard({
  color,
  title,
  sub,
  badge,
  children,
  onClick,
  className,
  size = 'lg',
}: {
  color: LineColor | undefined;
  title: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  className?: string;
  size?: 'md' | 'lg';
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`ccard ccard--${size} ${className ?? ''}`} style={lineVars(color)} onClick={onClick}>
      <span className="ccard__top">
        <span className="ccard__title" dir="auto">
          {title}
        </span>
        {badge ? <span className="ccard__badge">{badge}</span> : null}
      </span>
      {children}
      {sub ? <span className="ccard__sub">{sub}</span> : null}
    </Tag>
  );
}

/** A name tag with a cursor — two people working in the same space. */
export function NameTag({ name, color, style, flip }: { name: string; color: LineColor; style?: CSSProperties; flip?: boolean }) {
  return (
    <span className={`nametag ${flip ? 'nametag--flip' : ''}`} style={{ ...lineVars(color), ...style }}>
      <svg className="nametag__cursor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 3l15 7.5-6.5 1.8L10.5 19z" fill="currentColor" />
      </svg>
      <span dir="auto">{name}</span>
    </span>
  );
}

export function Section({
  title,
  count,
  action,
  children,
  id,
}: {
  title: ReactNode;
  /** Hidden at 0. */
  count?: number | ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="section" id={id}>
      <div className="section__head">
        <h2 className="section__title">
          {title}
          {count ? <span className="section__count num">{count}</span> : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'is-on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
  small,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  label: string;
  /** The compact size, as a row's trailing control. */
  small?: boolean;
}) {
  return (
    <div className={`seg${small ? ' seg--sm' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={`seg__btn ${o.value === value ? 'is-on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, text, children }: { title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {text ? <p className="empty__text">{text}</p> : null}
      {children}
    </div>
  );
}

/** The wordmark: "gila hub" in the display serif. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }} aria-label="Gila Hub" role="img">
      gila<span className="wordmark__hub">hub</span>
    </span>
  );
}

/** Small ring showing step progress, e.g. 3 of 5. */
export function StepRing({ done, total }: { done: number; total: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const p = total ? done / total : 0;
  return (
    <svg className="ring" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--tile-2)" strokeWidth="2" />
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${c * p} ${c}`} strokeLinecap="round" transform="rotate(-90 7 7)" />
    </svg>
  );
}

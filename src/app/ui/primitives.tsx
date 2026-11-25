import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LineColor, List, Member } from '../../core/model';
import { haptic } from './haptics';
import { Icon } from './Icon';

export const lineVars = (c: LineColor | undefined): CSSProperties =>
  ({ '--c': c ? `var(--${c})` : 'var(--surface-2)', '--ci': c ? `var(--${c}-ink)` : 'var(--text)' }) as CSSProperties;

const firstGrapheme = (s: string): string => {
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const t = s.trim();
  if (!t) return '?';
  if (seg) for (const { segment } of seg.segment(t)) return segment.toUpperCase();
  return t[0].toUpperCase();
};

export function Bullet({
  color,
  label,
  emoji,
  size,
  ring,
  className,
  title,
}: {
  color: LineColor | undefined;
  label?: string;
  emoji?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'hero';
  ring?: boolean;
  className?: string;
  title?: string;
}) {
  const text = emoji || firstGrapheme(label ?? '');
  return (
    <span
      className={`bullet ${size && size !== 'md' ? `bullet--${size}` : ''} ${emoji ? 'bullet--emoji' : ''} ${ring ? 'bullet--ring' : ''} ${className ?? ''}`}
      style={lineVars(color)}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {text}
    </span>
  );
}

export function ListBullet({ list, size }: { list: Pick<List, 'name' | 'color' | 'icon'> | undefined; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'hero' }) {
  return <Bullet color={list?.color} label={list?.name} emoji={list?.icon || undefined} size={size} title={list?.name} />;
}

export function PersonBullet({ member, size = 'sm' }: { member: Member | undefined; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' }) {
  if (!member) return null;
  return <Bullet color={member.color} label={member.name} size={size} title={member.name} className="bullet--round" />;
}

export function Diamond({ title = 'Urgent' }: { title?: string }) {
  return (
    <span className="diamond" title={title} aria-label={title} role="img">
      Urgent
    </span>
  );
}

export function Check({
  on,
  color,
  onToggle,
  label,
  disabled,
  square,
}: {
  on: boolean;
  color?: LineColor;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
  square?: boolean;
}) {
  return (
    <button
      type="button"
      className={`check ${on ? 'is-on' : ''} ${square ? 'check--square' : ''}`}
      style={lineVars(color)}
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!on) haptic();
        onToggle();
      }}
    >
      <span className="check__fill" />
      <svg className="check__tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </button>
  );
}

/** Observe when an element scrolls out of view (for the mini band). */
export function useScrolledPast<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting), { rootMargin: '-40px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, past];
}

export function Band({
  title,
  sub,
  lead,
  top,
  actions,
  crumbs,
  mini,
  onBack,
  className,
  style,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** Beside the title (a check, a project mark). */
  lead?: ReactNode;
  /** Top-left corner (an avatar) when there is no Back button. */
  top?: ReactNode;
  actions?: ReactNode;
  crumbs?: ReactNode;
  mini?: string;
  onBack?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const [ref, past] = useScrolledPast<HTMLElement>();
  return (
    <>
      <header className={`band ${className ?? ''}`} ref={ref} style={style}>
        {onBack || top || actions ? (
          <div className="band__top">
            {onBack ? (
              <button type="button" className="iconbtn" onClick={onBack} aria-label="Back">
                <Icon name="arrow-back" />
              </button>
            ) : (
              top
            )}
            {actions ? <div className="band__actions">{actions}</div> : null}
          </div>
        ) : null}
        {crumbs}
        <div className="band__lead">
          {lead}
          <h1 className="band__title" dir="auto">
            {title}
          </h1>
        </div>
        {sub ? <p className="band__sub">{sub}</p> : null}
      </header>
      <div className={`miniband ${past ? 'is-on' : ''}`} aria-hidden={!past}>
        {onBack ? (
          <button type="button" className="iconbtn miniband__back" onClick={onBack} aria-label="Back" tabIndex={past ? 0 : -1}>
            <Icon name="arrow-back" />
          </button>
        ) : null}
        <span dir="auto">{mini ?? (typeof title === 'string' ? title : '')}</span>
      </div>
    </>
  );
}

/** A pastel pill, e.g. a project tag. */
export function Tag({ color, children, small }: { color?: LineColor; children: ReactNode; small?: boolean }) {
  return (
    <span className={`tag ${small ? 'tag--sm' : ''}`} style={lineVars(color)}>
      {children}
    </span>
  );
}

/** A name tag with a cursor — two people working in the same space. */
export function NameTag({ name, color, style }: { name: string; color: LineColor; style?: CSSProperties }) {
  return (
    <span className="nametag" style={{ ...lineVars(color), ...style }}>
      <svg className="nametag__cursor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 3l14 7-6 2-2 6z" fill="currentColor" stroke="var(--bg)" strokeWidth="1.5" strokeLinejoin="round" />
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
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section__head">
        <h2 className="section__title" id={id}>
          {title}
          {count !== undefined ? <span className="section__count num">{count}</span> : null}
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
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
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

export function Empty({ mark, title, text, children }: { mark?: ReactNode; title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      {mark ? <div className="empty__mark">{mark}</div> : null}
      <p className="empty__title">{title}</p>
      {text ? <p className="empty__text">{text}</p> : null}
      {children}
    </div>
  );
}

/** The wordmark: "gila hub" set in a soft, heavy serif. */
export function Logo({ size = 28, short }: { size?: number; short?: boolean }) {
  return (
    <span className="wordmark" style={{ fontSize: size }} aria-label="Gila Hub" role="img">
      {short ? 'gila' : 'gila hub'}
    </span>
  );
}

/** Small ring showing step progress, e.g. 3 of 5. */
export function StepRing({ done, total }: { done: number; total: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const p = total ? done / total : 0;
  return (
    <svg className="steps__ring" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="2.2" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeDasharray={`${c * p} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

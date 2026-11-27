import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LineColor, List, Member } from '../../core/model';
import { haptic } from './haptics';
import { Icon, type IconName } from './Icon';
import { G } from './glyphs';

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
export function Avatar({ member, size = 'sm' }: { member?: Member; size?: Size }) {
  if (!member) return null;
  return (
    <span className={`avatar avatar--${size}`} style={lineVars(member.color)} title={member.name} aria-hidden="true">
      {firstGrapheme(member.name)}
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
function useScrolledPast<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
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

/**
 * A gray circle for header and sheet chrome (Search, …, Back, Close): a round button with just a glyph. `pressed`: an on/off one (its glyph lit when on, e.g. the
 * star); `small`: the 36px size inside panels.
 */
export function IconButton({
  icon,
  label,
  onClick,
  pressed,
  disabled,
  small,
  className,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  small?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`iconbtn${small ? ' iconbtn--sm' : ''}${pressed ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
    >
      <Icon name={icon} lit={pressed} />
    </button>
  );
}

/**
 * Type to find, inside a sheet or panel: the one search field (a place, a tag, an icon). A × clears
 * it once there's something in it. Enter runs `onEnter` (e.g. make the tag).
 */
export function FindField({ value, onChange, placeholder, onEnter, enterKeyHint = 'search' }: { value: string; onChange: (v: string) => void; placeholder: string; onEnter?: () => void; enterKeyHint?: 'search' | 'done' }) {
  return (
    <label className="findfield">
      <Icon name={G.search} className="icon--sm" />
      <input
        value={value}
        dir="auto"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint={enterKeyHint}
        autoComplete="off"
      />
      {value ? (
        <button type="button" className="findfield__clear" aria-label="Clear" onClick={() => onChange('')}>
          <Icon name={G.close} className="icon--xs" />
        </button>
      ) : null}
    </label>
  );
}

/**
 * − n +: one stepper for every count (a repeat's "every", stock levels, urgent-at). `nullable`:
 * below its lowest it's off ("off"), and + from off starts at the lowest. `size` sm is the 30px
 * one that sits in a chip or a row; `look` card sits on a tile (white, a hairline).
 */
export function Stepper({
  value,
  onChange,
  label,
  min = 0,
  max,
  nullable,
  size = 'md',
  look = 'tile',
  tone,
  format,
  className,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  /** What it counts, for the buttons' names ("Have: one less"). */
  label: string;
  min?: number;
  max?: number;
  nullable?: boolean;
  size?: 'sm' | 'md';
  look?: 'tile' | 'card' | 'bare';
  tone?: 'low' | 'out' | '';
  format?: (v: number | null) => ReactNode;
  className?: string;
}) {
  const off = value == null;
  const n = value ?? min;
  return (
    <span className={`stepper stepper--${size} stepper--${look}${tone ? ` is-${tone}` : ''}${off ? ' is-off' : ''}${className ? ` ${className}` : ''}`} onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label={`${label}: one less`} disabled={off || (!nullable && n <= min)} onClick={() => onChange(nullable && n <= min ? null : n - 1)}>
        <Icon name={G.less} />
      </button>
      <span className="stepper__n num">{format ? format(value) : off ? 'off' : n}</span>
      <button type="button" aria-label={`${label}: one more`} disabled={!off && max != null && n >= max} onClick={() => onChange(off ? min : n + 1)}>
        <Icon name={G.add} />
      </button>
    </span>
  );
}

/** One answer to a question a sheet asks. The first is the main one; `quiet` ones are lighter. */
type Choice = { label: string; icon?: IconName; run: () => void; quiet?: boolean; danger?: boolean; disabled?: boolean };

/**
 * The answers to a sheet's question, as full-width buttons: stacked, or side by side (`row`).
 * Every "Keep or put back?", "Use the template?", "Move it?" asks this way.
 */
export function Choices({ choices, row }: { choices: Choice[]; row?: boolean }) {
  return (
    <div className={`choices${row ? ' choices--row' : ''}`}>
      {choices.map((c) => (
        <button key={c.label} type="button" className={`btn btn--block${c.quiet ? ' btn--quiet' : ''}${c.danger ? ' btn--danger' : ''}`} disabled={c.disabled} onClick={c.run}>
          {c.icon ? <Icon name={c.icon} className="icon--sm" /> : null}
          {c.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The star: keep it on Today (a task in my Highlights, a folder's block). One look, one sound,
 * one undo wherever it is.
 */
export function StarButton({ on, onLabel, offLabel, onChange }: { on: boolean; onLabel: string; offLabel: string; onChange: (on: boolean) => void }) {
  return (
    <IconButton
      icon={G.highlight}
      className="starbtn"
      pressed={on}
      label={on ? onLabel : offLabel}
      onClick={() => {
        haptic('select');
        onChange(!on);
      }}
    />
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
            {onBack ? <IconButton icon={G.back} label="Back" onClick={onBack} /> : <span className="band__corner">{top}</span>}
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
            <Icon name={G.back} />
          </button>
        ) : null}
        <span dir="auto">{mini ?? (typeof title === 'string' ? title : '')}</span>
      </div>
    </>
  );
}

/** The small cursor a name tag carries (Tasky's): two people in the same space. */
export function CursorMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 3l15 7.5-6.5 1.8L10.5 19z" fill="currentColor" />
    </svg>
  );
}

/** A name tag with a cursor — two people working in the same space. */
export function NameTag({ name, color, style, flip }: { name: string; color: LineColor; style?: CSSProperties; flip?: boolean }) {
  return (
    <span className={`nametag ${flip ? 'nametag--flip' : ''}`} style={{ ...lineVars(color), ...style }}>
      <CursorMark className="nametag__cursor" />
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

/**
 * The one fold arrow: pointing at the title while folded, down while open. Everything that folds
 * under a heading folds with it (a Disclosure, a folder's groups).
 */
export function FoldButton({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className={`foldbtn ${open ? 'is-open' : ''}`} aria-expanded={open} aria-label={`${open ? 'Fold' : 'Show'} ${label}`} title={open ? 'Fold' : 'Show'} onClick={onToggle}>
      <Icon name={G.fold} />
    </button>
  );
}

/**
 * A Section that folds: title and count on the left, the fold arrow on the right (FoldButton).
 * Done, In stock and the rest all fold this way. `after` shows either way.
 */
export function Disclosure({
  title,
  count,
  open: openProp,
  onToggle,
  children,
  after,
}: {
  title: ReactNode;
  count?: number | ReactNode;
  /** Controlled; leave it out and the section keeps its own state (closed at first). */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
  after?: ReactNode;
}) {
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const toggle = () => {
    setOwn(!open);
    onToggle?.(!open);
  };
  return (
    <Section
      title={title}
      count={count}
      action={<FoldButton open={open} label={typeof title === 'string' ? title : 'this'} onToggle={toggle} />}
    >
      {open ? children : null}
      {after}
    </Section>
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

export function Empty({ title, text }: { title: string; text?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {text ? <p className="empty__text">{text}</p> : null}
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

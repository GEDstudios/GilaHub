import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type Ref } from 'react';
import type { LineColor, List, Member } from '../../core/model';
import { haptic } from './haptics';
import { Icon, type IconName } from './Icon';
import { G } from './glyphs';

export const lineVars = (c: LineColor | undefined): CSSProperties =>
  ({ '--c': c ? `var(--${c})` : 'var(--tile-2)', '--c-soft': c ? `var(--${c}-soft)` : 'var(--tile)' }) as CSSProperties;

/** A person's icon light (--me-light, --them): their color, with lemon standing in for ink. */
export const lightVar = (c: LineColor): string => `var(--${c === 'ink' ? 'lemon' : c})`;

/** The first character of some text, whole (an emoji or an accented letter is one); '' when there's none. */
export const firstGrapheme = (s: string): string => {
  const t = s.trim();
  if (!t) return '';
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)) return segment;
  return [...t][0];
};

type Size = 'xs' | 'sm' | 'md' | 'lg';

/** A name's initial, upper-cased ("?" for no name). */
export const initialOf = (s: string): string => (firstGrapheme(s) || '?').toUpperCase();

/** A person: a round avatar in their color with their initial. */
export function Avatar({ member, size = 'sm' }: { member?: Member; size?: Size }) {
  if (!member) return null;
  return (
    <span className={`avatar avatar--${size}`} style={lineVars(member.color)} title={member.name} aria-hidden="true">
      {initialOf(member.name)}
    </span>
  );
}

/** A folder: a small soft square of its color. */
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

type ButtonAttrs = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type' | 'children' | 'aria-label'> & { ref?: Ref<HTMLButtonElement> };

/**
 * The button that commits something (`.btn`): Add, Create folder, Stick it. `quiet` is the lighter
 * second choice, `small` the 40px one in a row or a header, `block` fills its line, `danger` deletes.
 */
export function Button({
  children,
  icon,
  quiet,
  danger,
  small,
  block,
  className,
  type = 'button',
  label,
  ...rest
}: ButtonAttrs & {
  children: ReactNode;
  /** A glyph before the words. */
  icon?: IconName;
  quiet?: boolean;
  danger?: boolean;
  small?: boolean;
  block?: boolean;
  /** A class for where it sits (never for how it looks). */
  className?: string;
  type?: 'button' | 'submit';
  /** Said to a screen reader instead of the words on it. */
  label?: string;
}) {
  const cls = `btn${small ? ' btn--sm' : ''}${quiet ? ' btn--quiet' : ''}${block ? ' btn--block' : ''}${danger ? ' btn--danger' : ''}${className ? ` ${className}` : ''}`;
  return (
    <button type={type} className={cls} aria-label={label} {...rest}>
      {icon ? <Icon name={icon} className="icon--sm" /> : null}
      {children}
    </button>
  );
}

/** A low-emphasis, underlined link of a button (`.textbtn`): Edit Today, Invite your person, Delete. */
export function TextButton({
  children,
  icon,
  iconAfter,
  danger,
  className,
  label,
  ...rest
}: ButtonAttrs & {
  children: ReactNode;
  /** A glyph before the words… */
  icon?: IconName;
  /** …or a small one after them (it leads somewhere). */
  iconAfter?: IconName;
  danger?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <button type="button" className={`textbtn${danger ? ' textbtn--danger' : ''}${className ? ` ${className}` : ''}`} aria-label={label} {...rest}>
      {icon ? <Icon name={icon} className="icon--sm" /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} className="icon--xs" /> : null}
    </button>
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
        <Button key={c.label} block icon={c.icon} quiet={c.quiet} danger={c.danger} disabled={c.disabled} onClick={c.run}>
          {c.label}
        </Button>
      ))}
    </div>
  );
}

/** ♡: thanks for something my person did. Filled once said; a tap again takes it back. */
export function ThanksButton({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`heart ${on ? 'is-on' : ''}`}
      aria-label={label}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        if (!on) haptic('success');
        onToggle();
      }}
    >
      <Icon name={on ? G.thanked : G.thanks} />
    </button>
  );
}

/** What's in the hand, small, while it's over somewhere it can go into (a folder, a task, a step of the path). */
export function DropChip({ label, nesting }: { label: string; /** It goes under a task (↳) rather than out on its own. */ nesting?: boolean }) {
  return (
    <span className="dropchip">
      <Icon name={nesting ? G.subtask : G.move} className="icon--sm" />
      <span dir="auto">{label}</span>
    </span>
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
  className,
}: {
  title: ReactNode;
  /** Hidden at 0. */
  count?: number | ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section className={`section${className ? ` ${className}` : ''}`} id={id}>
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

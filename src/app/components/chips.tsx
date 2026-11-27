import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from '../ui/Icon';

/**
 * One soft chip of the inline editor. With `open` it has a panel that opens under the row; with
 * `pressed` it is an on/off chip with no panel (Urgent, Pin to bar). `ghost` = a dashed invitation
 * (e.g. while on my own). `lead` replaces the icon (a folder's bullet).
 */
export function EChip({
  label,
  icon,
  lead,
  set,
  open,
  pressed,
  onToggle,
  ghost,
  tone,
  style,
}: {
  label: ReactNode;
  icon?: IconName;
  lead?: ReactNode;
  set: boolean;
  /** An extra class (a chip with a look of its own, like who sees it). */
  tone?: string;
  style?: CSSProperties;
  /** Its panel is open (leave it out for a chip with no panel). */
  open?: boolean;
  /** An on/off chip: whether it's on. */
  pressed?: boolean;
  onToggle: () => void;
  ghost?: boolean;
}) {
  // Open, a tap anywhere outside the chip and its panel closes it (not inside another chip, which
  // opens itself, nor in a sheet opened over this one).
  const ref = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const chip = ref.current;
      const t = e.target instanceof Element ? e.target : null;
      if (!chip || !t || chip.contains(t)) return;
      if (t.closest('.panel, .echip, .livecursor, .toasts')) return;
      const theirs = t.closest('.sheet');
      if (theirs && theirs !== chip.closest('.sheet')) return;
      toggleRef.current();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);
  return (
    <button
      ref={ref}
      type="button"
      className={`echip ${set ? 'is-set' : ''} ${open ? 'is-open' : ''} ${ghost ? 'echip--ghost' : ''} ${tone ?? ''}`}
      style={style}
      onClick={onToggle}
      aria-expanded={open}
      aria-pressed={pressed}
    >
      {lead ?? (icon ? <Icon name={icon} className="icon--sm" /> : null)}
      <span dir="auto">{label}</span>
    </button>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return <div className="panel">{children}</div>;
}

/** A part of a panel (a row's choices, under a hairline). */
export function PanelPart({ children }: { children: ReactNode }) {
  return <div className="panel__part">{children}</div>;
}

export function Options<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T | null;
  options: Array<{ value: T; label: ReactNode; icon?: IconName }>;
  onPick: (v: T) => void;
}) {
  return (
    <div className="options" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={`option ${o.value === value ? 'is-on' : ''}`} onClick={() => onPick(o.value)}>
          {o.icon ? <Icon name={o.icon} className="icon--sm" /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

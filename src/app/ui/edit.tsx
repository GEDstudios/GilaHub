import type { Ref } from 'react';
import { Icon } from './Icon';

/**
 * One edit-mode language for the bar, Today and Projects (round 7, DECISIONS §2). Styles live in
 * components.css, "Edit mode". Enter by a quiet text button at the end of the page (.editlink);
 * the thing being edited turns into a white object you pick up; Done leaves.
 */

/**
 * × on an object: take it out, or hide it. `badge` overlaps the shoulder of a small object (a
 * bar tab); `head` ends a card's head (a Today card). It never starts a drag (Sortable NO_DRAG).
 */
export function EditX({ size, label, onClick, className }: { size: 'badge' | 'head'; label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`editx editx--${size}${className ? ` ${className}` : ''}`} aria-label={label} title={label} onClick={onClick}>
      <Icon name="x" />
    </button>
  );
}

/** + on what can be added here: a white disc that turns into × while its container is open. */
export function AddDisc({ open = false, className }: { open?: boolean; className?: string }) {
  return (
    <span className={`adddisc${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`} aria-hidden="true">
      <Icon name="plus" />
    </span>
  );
}

/** Leaves an edit mode; it takes the band's primary-action slot. Everything is already saved. */
export function DoneButton({ onClick, ref }: { onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type="button" className="btn btn--sm" onClick={onClick}>
      Done
    </button>
  );
}

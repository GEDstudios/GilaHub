import type { Ref } from 'react';
import { Icon } from './Icon';
import { G } from './glyphs';
import { Button } from './primitives';

/**
 * One edit-mode language for the bar, Today and Folders. Styles live in
 * styles/components/drag.css, "Edit mode". Enter by a quiet text button at the end of the page (.editlink);
 * the thing being edited turns into a white object you pick up; Done leaves.
 */

/**
 * × on an object: take it out, or hide it. `badge` overlaps the shoulder of a small object (a
 * bar tab); `head` ends a card's head (a Today card). It never starts a drag (Sortable NO_DRAG).
 */
export function EditX({ size, label, onClick, className }: { size: 'badge' | 'head'; label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`editx editx--${size}${className ? ` ${className}` : ''}`} aria-label={label} title={label} onClick={onClick}>
      <Icon name={G.close} />
    </button>
  );
}

/** + on what can be added here: a white disc that turns into × while its container is open. */
export function AddDisc({ open = false, className }: { open?: boolean; className?: string }) {
  return (
    <span className={`adddisc${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`} aria-hidden="true">
      <Icon name={G.add} />
    </span>
  );
}

/** Leaves an edit mode; it takes the band's primary-action slot. Everything is already saved. */
export function DoneButton({ onClick, ref, label, className }: { onClick: () => void; ref?: Ref<HTMLButtonElement>; /** What is done, when "Done" alone doesn't say. */ label?: string; className?: string }) {
  return (
    <Button small ref={ref} label={label} className={className} onClick={onClick}>
      Done
    </Button>
  );
}

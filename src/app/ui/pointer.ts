import { useEffect, useState } from 'react';

/**
 * What this device points with, asked one way everywhere: a mouse (a computer, where pickers made
 * for one show), any mouse at all (a tablet with one plugged in), or a finger (vibration).
 */
const MOUSE = '(hover: hover) and (pointer: fine)';
const ANY_MOUSE = '(any-hover: hover) and (any-pointer: fine)';
const ask = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;

/** A mouse is the main pointer. */
export const isMouse = () => ask(MOUSE);
/** Some mouse is around (the live cursor follows it). */
export const hasMouse = () => ask(ANY_MOUSE);
/** A finger is the main pointer. */
export const isTouch = () => ask('(pointer: coarse)');

/** isMouse(), kept up to date (a tablet's keyboard and trackpad come and go). */
export function useMouse(): boolean {
  const [on, setOn] = useState(isMouse);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(MOUSE);
    const fn = () => setOn(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);
  return on;
}

/**
 * Haptics: one call for every tactile moment, `haptic(kind)`.
 *
 *   select   a light tick while choosing (each new drop spot, each tab under the finger)
 *   tick     a check-off (the default)
 *   lift     picking something up
 *   drop     putting it down
 *   success  a finished moment
 *   warn     "not there" (dragging out of its aisle)
 *
 * Android/Chrome: the Vibration API with a pattern per kind. iOS has no Vibration API:
 * toggling a hidden `<input type=checkbox switch>` plays the system switch haptic
 * (Safari 18+), one click per kind and two for success. `select` is throttled so a
 * fast drag doesn't buzz. The device pref `haptics` (default on) gates all of them.
 * Pure progressive enhancement: silently does nothing elsewhere.
 */
import { getPrefs } from '../prefs';
import { playSound } from './sounds';

export type HapticKind = 'select' | 'tick' | 'lift' | 'drop' | 'success' | 'warn';

export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  select: 5,
  tick: 10,
  lift: 16,
  drop: [8, 30, 12],
  success: [10, 50, 10, 50, 18],
  warn: [24, 40, 24],
};

/** Minimum gap between two `select` haptics, in ms. The iOS switch click is heavier, so it waits longer. */
export const SELECT_GAP = { vibrate: 28, ios: 45 } as const;

let label: HTMLLabelElement | null = null;
let lastSelect = -Infinity;

function iosSwitch(): HTMLLabelElement | null {
  if (label) return label;
  if (typeof document === 'undefined') return null;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = 'gila-haptic';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  label = document.createElement('label');
  label.htmlFor = input.id;
  label.setAttribute('aria-hidden', 'true');
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-10px;top:-10px';
  box.append(input, label);
  document.body.append(box);
  return label;
}

const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/** True when a `select` at time `now` should be skipped (pure, for tests). */
export function throttled(kind: HapticKind, now: number, last: number, ios: boolean): boolean {
  return kind === 'select' && now - last < (ios ? SELECT_GAP.ios : SELECT_GAP.vibrate);
}

export function haptic(kind: HapticKind = 'tick'): void {
  // Each tactile moment has a sound too (its own switch, in Settings).
  if (kind === 'tick' || kind === 'drop' || kind === 'success' || kind === 'warn') playSound(kind);
  try {
    if (!getPrefs().haptics) return;
    const ios = !canVibrate();
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (throttled(kind, now, lastSelect, ios)) return;
    if (kind === 'select') lastSelect = now;
    if (!ios) {
      navigator.vibrate(HAPTIC_PATTERNS[kind]);
      return;
    }
    const sw = iosSwitch();
    sw?.click();
    if (kind === 'success') setTimeout(() => sw?.click(), 90);
  } catch {
    /* no haptics here */
  }
}

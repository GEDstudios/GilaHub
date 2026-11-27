import { isTouch } from './pointer';
/**
 * Phones only raise the keyboard for a focus that happens inside the tap itself. New opens
 * a sheet a moment after the tap, so the tap focuses a hidden field first ("primes" the
 * keyboard) and the sheet's field takes the focus over when it mounts.
 */
let primer: HTMLInputElement | null = null;

export function primeKeyboard(): void {
  if (typeof document === 'undefined' || !isTouch()) return;
  if (!primer) {
    primer = document.createElement('input');
    primer.setAttribute('aria-hidden', 'true');
    primer.tabIndex = -1;
    primer.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none;border:0;padding:0;';
    document.body.appendChild(primer);
  }
  primer.focus({ preventScroll: true });
  // If nothing takes the focus over, let it go again.
  setTimeout(() => {
    if (document.activeElement === primer) primer?.blur();
  }, 900);
}

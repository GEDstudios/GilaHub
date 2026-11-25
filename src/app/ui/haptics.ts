/**
 * A light haptic tick on check-off.
 * Android/Chrome: Vibration API. iOS (no Vibration API): toggling a hidden
 * `<input type=checkbox switch>` plays the system switch haptic (Safari 18+).
 * Pure progressive enhancement — silently does nothing elsewhere.
 */
let label: HTMLLabelElement | null = null;

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

export function haptic(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && navigator.vibrate) {
      navigator.vibrate(12);
      return;
    }
    iosSwitch()?.click();
  } catch {
    /* no haptics here */
  }
}

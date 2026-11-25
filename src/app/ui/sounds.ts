/**
 * Sounds: small, soft, made on the fly (Web Audio, no files). One per tactile moment, the same
 * kinds as haptics, so a tick sounds like a tick everywhere. The device pref `sounds` (default
 * on) gates them; the phone's silent switch still wins on iPhone.
 *
 *   tick     a small wooden pop (ticked off, put in the cart)
 *   drop     a soft click (dropped into place)
 *   success  a two-note chime (paid, kept a moment, all done)
 *   warn     a low bump ("not there")
 *   add      a light rising blip (added something)
 */
import { getPrefs } from '../prefs';

export type SoundKind = 'tick' | 'drop' | 'success' | 'warn' | 'add';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** One soft note: a sine with a quick attack and a short tail. */
function note(a: AudioContext, freq: number, at: number, len: number, vol: number, type: OscillatorType = 'sine', glide?: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, at + len);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + len + 0.02);
}

export function playSound(kind: SoundKind): void {
  try {
    if (!getPrefs().sounds) return;
    const a = audio();
    if (!a) return;
    const t = a.currentTime + 0.005;
    switch (kind) {
      case 'tick':
        note(a, 880, t, 0.09, 0.12, 'triangle', 660);
        break;
      case 'drop':
        note(a, 420, t, 0.06, 0.08, 'triangle', 300);
        break;
      case 'add':
        note(a, 620, t, 0.1, 0.07, 'sine', 930);
        break;
      case 'success':
        note(a, 784, t, 0.18, 0.08);
        note(a, 1175, t + 0.09, 0.32, 0.07);
        break;
      case 'warn':
        note(a, 180, t, 0.14, 0.1, 'triangle', 140);
        break;
    }
  } catch {
    /* no sound here */
  }
}

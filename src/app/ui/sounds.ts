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
 *   notify   a three-note doorbell (something arrived: a reminder, a note, an ask)
 */
import { getPrefs } from '../prefs';

export type SoundKind = 'tick' | 'drop' | 'success' | 'warn' | 'add' | 'notify';

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

/**
 * One struck note, like a small marimba bar: the tone plus a quieter partial a fourth octave up
 * that dies fast (the "tock"), a quick attack and a natural tail. Loud enough for a phone speaker.
 */
function note(a: AudioContext, freq: number, at: number, len: number, vol: number, type: OscillatorType = 'sine', glide?: number) {
  const out = a.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(vol, at + 0.006);
  out.gain.exponentialRampToValueAtTime(0.0001, at + len);
  out.connect(a.destination);
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, at + len);
  o.connect(out);
  o.start(at);
  o.stop(at + len + 0.03);
  // The strike
  const k = a.createOscillator();
  const kg = a.createGain();
  k.type = 'sine';
  k.frequency.setValueAtTime(freq * 4, at);
  kg.gain.setValueAtTime(0.0001, at);
  kg.gain.exponentialRampToValueAtTime(vol * 0.35, at + 0.003);
  kg.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(0.05, len));
  k.connect(kg).connect(a.destination);
  k.start(at);
  k.stop(at + 0.07);
}

export function playSound(kind: SoundKind): void {
  try {
    if (!getPrefs().sounds) return;
    const a = audio();
    if (!a) return;
    const t = a.currentTime + 0.005;
    switch (kind) {
      case 'tick':
        note(a, 988, t, 0.12, 0.32, 'triangle', 784);
        break;
      case 'drop':
        note(a, 440, t, 0.09, 0.26, 'triangle', 330);
        break;
      case 'add':
        note(a, 659, t, 0.1, 0.22, 'sine', 880);
        note(a, 988, t + 0.06, 0.14, 0.18);
        break;
      case 'success':
        note(a, 784, t, 0.22, 0.26);
        note(a, 1175, t + 0.09, 0.4, 0.22);
        break;
      case 'warn':
        note(a, 196, t, 0.16, 0.3, 'triangle', 147);
        break;
      case 'notify':
        // Our little doorbell: up and over, then a soft landing.
        note(a, 1047, t, 0.3, 0.24);
        note(a, 1319, t + 0.11, 0.3, 0.22);
        note(a, 1568, t + 0.22, 0.55, 0.2);
        break;
    }
  } catch {
    /* no sound here */
  }
}

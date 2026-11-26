/**
 * Sounds: soft, round pops made on the fly (Web Audio, no files). One per tactile moment, the
 * same kinds as haptics, so a tick sounds like a tick everywhere. The device pref `sounds`
 * (default on) gates them; the phone's silent switch still wins on iPhone.
 *
 * Every sound is built from two things:
 *   - a pop: a pure sine that glides in pitch (like a bubble), with a 2-3 ms attack and a short
 *     natural tail, through a gentle low-pass, so it's round, never bright;
 *   - a touch: a whisper of filtered noise, a few ms long, under the pop: the feel of a
 *     fingertip on glass.
 *
 *   select   the faintest tap (a chip, a pen, a choice)
 *   tick     a round bubble pop, rising (ticked off, put in the cart)
 *   lift     a soft lift-off (picked something up to move it)
 *   drop     a lower pop, settling (dropped into place)
 *   add      two little pops, up (added something)
 *   success  three bubbles rising (paid, kept a moment, all done)
 *   warn     a low, soft double bump ("not there")
 *   notify   bloop-bloop and a soft ring (something arrived)
 */
import { getPrefs } from '../prefs';

export type SoundKind = 'select' | 'tick' | 'lift' | 'drop' | 'success' | 'warn' | 'add' | 'notify';

let ctx: AudioContext | null = null;
let out: AudioNode | null = null;
let noise: AudioBuffer | null = null;

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

/** Everything goes through one warm low-pass and a soft limiter, so nothing is ever sharp or loud. */
function master(a: AudioContext): AudioNode {
  if (out) return out;
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  lp.Q.value = 0.5;
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.002;
  comp.release.value = 0.12;
  lp.connect(comp).connect(a.destination);
  out = lp;
  return out;
}

/** A pop: a sine gliding from `from` to `to` Hz, quick to start, quick to fade. */
function pop(a: AudioContext, at: number, from: number, to: number, len: number, vol: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(from, at);
  // Most of the glide happens up front: the "bloop".
  o.frequency.exponentialRampToValueAtTime(to, at + len * 0.45);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.0025);
  g.gain.exponentialRampToValueAtTime(vol * 0.35, at + len * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(master(a));
  o.start(at);
  o.stop(at + len + 0.02);
}

/** A touch: a few ms of soft, band-limited noise: the tactile part. */
function touch(a: AudioContext, at: number, vol: number, center = 2400) {
  if (!noise) {
    noise = a.createBuffer(1, Math.ceil(a.sampleRate * 0.02), a.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = a.createBufferSource();
  src.buffer = noise;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = center;
  bp.Q.value = 0.9;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.0008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
  src.connect(bp).connect(g).connect(master(a));
  src.start(at);
  src.stop(at + 0.02);
}

export function playSound(kind: SoundKind): void {
  try {
    if (!getPrefs().sounds) return;
    const a = audio();
    if (!a) return;
    const t = a.currentTime + 0.004;
    switch (kind) {
      case 'select':
        touch(a, t, 0.06, 3000);
        pop(a, t, 1100, 1300, 0.035, 0.1);
        break;
      case 'tick':
        touch(a, t, 0.1);
        pop(a, t, 480, 920, 0.11, 0.42);
        break;
      case 'lift':
        pop(a, t, 380, 620, 0.09, 0.24);
        break;
      case 'drop':
        touch(a, t, 0.09, 1800);
        pop(a, t, 420, 260, 0.1, 0.4);
        break;
      case 'add':
        touch(a, t, 0.06);
        pop(a, t, 560, 860, 0.08, 0.16);
        pop(a, t + 0.065, 760, 1180, 0.11, 0.15);
        break;
      case 'success':
        touch(a, t, 0.07);
        pop(a, t, 523, 784, 0.1, 0.16);
        pop(a, t + 0.075, 659, 988, 0.1, 0.15);
        pop(a, t + 0.15, 784, 1175, 0.22, 0.16);
        break;
      case 'warn':
        pop(a, t, 240, 170, 0.1, 0.18);
        pop(a, t + 0.11, 220, 150, 0.12, 0.15);
        break;
      case 'notify':
        touch(a, t, 0.06);
        pop(a, t, 620, 930, 0.12, 0.18);
        pop(a, t + 0.12, 830, 1245, 0.14, 0.17);
        // A soft ring after, settling.
        pop(a, t + 0.26, 1245, 1240, 0.45, 0.07);
        break;
    }
  } catch {
    /* no sound here */
  }
}

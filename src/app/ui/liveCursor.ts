import { cursorImage, type CursorKind } from './cursors';
import { calm, HOLD as HOLD_TIME } from './tokens';
import { hasMouse } from './pointer';

/**
 * The mouse, alive (a computer only, and not when motion is turned down): our cursor drawn by
 * the page instead of the system. It sits exactly where the mouse is (no lag), but it has a
 * body: it leans into a quick move and springs back past straight before it settles, squashes
 * a little when you click, and pops when it changes shape. Left alone for three seconds it
 * turns into the open hand and waves. Text fields keep the system's I-beam.
 */

const POINT = "a, button, summary, select, label, [role='button'], [role='radio'], [role='checkbox'], [role='switch'], [role='tab'], .row--tap";
const GRAB = '[data-drag], [data-grip], .stuck, .slot__grip, .homecard__grip, .nf__photo.is-editable';
const TEXT = "input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='color']):not([type='file']), textarea, [contenteditable='true']";
/** Left alone this long it turns into the hand and waves; then it waves again every WAVE_EVERY. */
const IDLE_MS = 1500;
const WAVE_EVERY = 3000;
const WAVE_MS = 1300;
/** The wave's swing at t (0–1): left, right, left, right, settling, eased between the turns. */
const WAVE_KEYS: Array<[number, number]> = [
  [0, 0],
  [0.14, -14],
  [0.3, 12],
  [0.46, -12],
  [0.62, 9],
  [0.8, -3],
  [1, 0],
];
function waveAngle(t: number): number {
  for (let i = 1; i < WAVE_KEYS.length; i++) {
    const [t1, a1] = WAVE_KEYS[i];
    const [t0, a0] = WAVE_KEYS[i - 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return a0 + (a1 - a0) * (u * u * (3 - 2 * u));
    }
  }
  return 0;
}
/** Things that need a hold to pick up (with the mouse: a note, a note's photo), and how long. */
const HOLD = '.stuck:not(.is-lifted), .nf__photo.is-editable:not(.is-lifted)';
const MOUSE_HOLD_MS = HOLD_TIME.press;

function kindAt(target: EventTarget | null): CursorKind | 'text' {
  const root = document.documentElement;
  const t = target instanceof Element ? target : null;
  if (root.classList.contains('is-dragging')) return 'grabbing';
  if (root.classList.contains('note-lifted')) {
    if (root.dataset.twist === 'scale') return 'scale';
    if (t?.closest('.stuck.is-lifted, .nf__photo.is-lifted')) return 'grab';
    return 'rotate';
  }
  if (!t) return 'arrow';
  if (t.closest(TEXT) && !(t as HTMLInputElement).disabled && !(t as HTMLInputElement).readOnly) return 'text';
  if (t.closest(GRAB)) return 'grab';
  const p = t.closest(POINT);
  if (p && !(p as HTMLButtonElement).disabled) return 'point';
  return 'arrow';
}

/** A mouse or trackpad anywhere on this device (a touchscreen laptop counts). */

/** On by its switch in Settings; left alone, on unless motion is turned down. */
export function wantsLiveCursor(pref: boolean | null): boolean {
  if (!hasMouse()) return false;
  return pref ?? !calm();
}

export function startLiveCursor(pref: boolean | null = null): () => void {
  if (typeof window === 'undefined' || !wantsLiveCursor(pref)) return () => {};

  const el = document.createElement('div');
  el.className = 'livecursor';
  el.setAttribute('aria-hidden', 'true');
  const body = document.createElement('div');
  body.className = 'livecursor__body';
  const img = document.createElement('img');
  img.alt = '';
  img.width = 32;
  img.height = 32;
  // Text fields get our own I-beam too: the system's pointer never shows on the page.
  const beam = document.createElement('div');
  beam.className = 'livecursor__beam';
  beam.innerHTML = `<svg viewBox="0 0 16 24"><path d="M5 2.5h1.6c.6 0 1.1.3 1.4.7.3-.4.8-.7 1.4-.7H11M5 21.5h1.6c.6 0 1.1-.3 1.4-.7.3.4.8.7 1.4.7H11M8 3.4v17.2M6.2 12h3.6"/></svg>`;
  body.append(img);
  // While a hold is under way the cursor is a timer: it fills, and then the thing lifts.
  const timer = document.createElement('div');
  timer.className = 'livecursor__timer';
  timer.innerHTML = `<svg viewBox="0 0 24 24"><circle class="livecursor__track" cx="12" cy="12" r="9"/><circle class="livecursor__pie" cx="12" cy="12" r="4.25"/><circle class="livecursor__fill" cx="12" cy="12" r="9"/></svg>`;
  timer.style.setProperty('--hold', `${MOUSE_HOLD_MS}ms`);
  // Our own tooltip: the browser's (a `title`) brings the system's pointer back on a Mac while
  // it shows, so titles are taken in hand here and shown by us instead.
  const tip = document.createElement('div');
  tip.className = 'livecursor__tip';
  el.append(body, beam, timer, tip);
  document.body.append(el);
  document.documentElement.classList.add('has-livecursor');

  let x = -100;
  let y = -100;
  let kind: CursorKind | 'text' = 'arrow';
  let shown: CursorKind | null = null;
  let waving = false;
  let waveAt = 0;
  let pressed = false;
  let visible = false;
  // The body hangs from the pointer's tip like a little pendulum on a spring: it trails a move
  // (further the quicker it goes, never quite flat out), and when the move stops it swings back
  // past straight and wiggles to rest, by as much as it was going. All in real time, not frames.
  let rot = 0;
  let rotV = 0;
  let vel = 0;
  // Speed as the mouse reports it (px/s), and when it last did.
  let evVel = 0;
  let movedAt = 0;
  let lastEvX = 0;
  let lastEvT = 0;
  let lastT = 0;
  // The size (1 = still): a little spring for the click squash and the pop of a new shape.
  let sc = 1;
  let scV = 0;
  let scTarget = 1;
  let raf = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;

  // One picture per shape, made once and shown or hidden (swapping a picture's source is a bigger
  // change to the page than a style).
  const pics = new Map<CursorKind, HTMLImageElement>();
  let pic: HTMLImageElement = img;
  const picture = (k: CursorKind) => {
    const im = cursorImage(k);
    if (!im) return;
    let p = pics.get(k);
    if (!p || p.dataset.src !== im.src) {
      p = p ?? (pics.size === 0 ? img : (img.cloneNode() as HTMLImageElement));
      p.src = im.src;
      p.dataset.src = im.src;
      if (!p.parentNode) body.append(p);
      pics.set(k, p);
    }
    if (pic !== p) {
      pic.style.display = 'none';
      pic.style.transform = '';
      p.style.display = '';
      pic = p;
    }
    body.style.transformOrigin = `${im.hx}px ${im.hy}px`;
    el.style.setProperty('--hx', `${im.hx}px`);
    el.style.setProperty('--hy', `${im.hy}px`);
  };
  const setKind = (k: CursorKind | 'text') => {
    kind = k;
    // Pressed on something you can pick up: the hand closes the moment the button goes down
    // (a button or a link keeps its pointing finger).
    const closed: CursorKind | 'text' = pressed && k === 'grab' ? 'grabbing' : k;
    const want: CursorKind | null = closed === 'text' ? null : waving ? 'grab' : closed;
    el.classList.toggle('is-hidden', !visible);
    el.classList.toggle('is-text', k === 'text');
    if (want && want !== shown) {
      shown = want;
      picture(want);
      // A new shape arrives with a little pop.
      sc = 0.82;
      scV = 0;
    }
    kick();
  };

  const OMEGA = 2 * Math.PI * 3; // how fast it swings
  const ZETA = 0.415; // how soon it settles: one small swing back (about a fifth of the lean), then still
  const LEAN = 20; // the most it ever trails, in degrees
  const V0 = 1500; // px/s for about three quarters of that
  const frame = (now: number) => {
    raf = 0;
    const dt = Math.min(0.034, lastT ? (now - lastT) / 1000 : 1 / 60);
    lastT = now;
    if (dt <= 0) {
      kick();
      return;
    }
    // Sideways speed, from the mouse's own reports (not frames, which mice don't keep pace
    // with). The moment the reports stop, it has stopped: the swing back starts right away.
    if (now - movedAt > 25) evVel *= Math.exp(-dt / 0.008);
    vel = evVel;
    // It trails behind the way it's going: a soft limit, so a flick leans further than a nudge.
    const target = LEAN * Math.tanh(vel / V0);
    // Spring towards that, lightly damped (semi-implicit Euler: steady at any frame rate).
    rotV += (OMEGA * OMEGA * (target - rot) - 2 * ZETA * OMEGA * rotV) * dt;
    rot += rotV * dt;
    scV = (scV + (scTarget - sc) * 0.3) * 0.62;
    sc += scV;
    const shown = 30 * Math.tanh(rot / 30);
    // The wave, drawn here too (no animation classes): from the wrist, back and forth, settling.
    if (waveAt) {
      const t = (now - waveAt) / WAVE_MS;
      if (t >= 1) {
        waveAt = 0;
        pic.style.transform = '';
        stopWave();
      } else pic.style.transform = `rotate(${waveAngle(t).toFixed(2)}deg)`;
    }
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    body.style.transform = `translate(calc(-1 * var(--hx, 0px)), calc(-1 * var(--hy, 0px))) rotate(${shown.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
    if (waveAt || Math.abs(rot) > 0.04 || Math.abs(rotV) > 0.4 || Math.abs(vel) > 2 || Math.abs(sc - scTarget) > 0.002 || Math.abs(scV) > 0.002) kick();
    else lastT = 0;
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  // The mouse is still over this page (not off in another window, or the page around this one).
  const here = () => document.documentElement.matches(':hover');
  const wave = () => {
    if (!visible || kind === 'text') return;
    // Gone off the page without saying so (leaving a frame can skip the event): no hand left
    // waving by itself next to the real pointer.
    if (!here()) {
      hide();
      return;
    }
    // The open hand waves, then it's the arrow again; resting on, it waves again now and then.
    waving = true;
    shown = null;
    setKind(kind);
    waveAt = performance.now();
    kick();
    idle = setTimeout(wave, WAVE_EVERY);
  };
  const stopWave = () => {
    if (!waving) return;
    waving = false;
    waveAt = 0;
    pic.style.transform = '';
    shown = null;
    setKind(kind);
  };
  const restartIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(wave, IDLE_MS);
  };

  let tipT: ReturnType<typeof setTimeout> | undefined;
  const hideTip = () => {
    clearTimeout(tipT);
    tip.classList.remove('is-on');
  };
  /** Under the mouse: anything with a title gives it to us (kept as data-tip), and after a rest we show it. */
  const tipFor = (target: EventTarget | null) => {
    hideTip();
    const t = target instanceof Element ? target.closest('[title], [data-tip]') : null;
    if (!t) return;
    const title = t.getAttribute('title');
    if (title !== null) {
      if (title) t.setAttribute('data-tip', title);
      t.removeAttribute('title');
    }
    const text = t.getAttribute('data-tip');
    if (!text) return;
    tipT = setTimeout(() => {
      tip.textContent = text;
      tip.classList.add('is-on');
    }, 650);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      hide();
      return;
    }
    tipFor(e.target);
    x = e.clientX;
    y = e.clientY;
    const t = e.timeStamp || performance.now();
    const gap = (t - lastEvT) / 1000;
    if (lastEvT && gap > 0.002 && gap < 0.1) evVel += ((x - lastEvX) / gap - evVel) * 0.5;
    else if (!lastEvT || gap >= 0.1) evVel = 0;
    lastEvX = x;
    lastEvT = t;
    movedAt = performance.now();
    kick();
    // Moved off before the hold landed: no hold.
    if (holdAt && Math.hypot(x - holdAt[0], y - holdAt[1]) > 8) endHold();
    if (!visible) {
      visible = true;
      evVel = 0;
    }
    stopWave();
    setKind(kindAt(e.target));
    restartIdle();
  };
  let holdAt: [number, number] | null = null;
  const endHold = () => {
    holdAt = null;
    timer.classList.remove('is-on');
    el.classList.remove('is-holding');
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    stopWave();
    const t = e.target instanceof Element ? e.target : null;
    if (e.button === 0 && t?.closest(HOLD) && !t.closest('.sticky__check')) {
      holdAt = [e.clientX, e.clientY];
      timer.classList.remove('is-on');
      void timer.offsetWidth;
      timer.classList.add('is-on');
      el.classList.add('is-holding');
      setTimeout(() => holdAt && endHold(), MOUSE_HOLD_MS + 120);
    }
    hideTip();
    scTarget = 0.86;
    pressed = e.button === 0;
    setKind(kindAt(e.target));
    restartIdle();
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    endHold();
    scTarget = 1;
    pressed = false;
    setKind(kindAt(e.target));
  };
  const hide = () => {
    hideTip();
    visible = false;
    pressed = false;
    clearTimeout(idle);
    el.classList.add('is-hidden');
  };
  const onLeave = (e: MouseEvent) => {
    if (!e.relatedTarget) hide();
  };
  const onOut = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && !e.relatedTarget) hide();
  };
  const onRepaint = () => {
    shown = null;
    setKind(kind);
  };
  // Classes that change the shape without a move (a drag starts, a note is lifted).
  const watch = new MutationObserver(() => {
    // It lifted: the timer's done, the hand takes over.
    if (holdAt && document.documentElement.classList.contains('note-lifted')) endHold();
    setKind(kindAt(document.elementFromPoint(x, y)));
  });
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-twist'] });

  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
  window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  window.addEventListener('pointerup', onUp, { capture: true, passive: true });
  document.addEventListener('mouseout', onLeave);
  document.documentElement.addEventListener('mouseleave', hide);
  document.addEventListener('pointerout', onOut);
  document.addEventListener('visibilitychange', hide);
  window.addEventListener('blur', hide);
  window.addEventListener('gila:cursors', onRepaint);
  hide();

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(idle);
    hideTip();
    watch.disconnect();
    window.removeEventListener('pointermove', onMove, { capture: true });
    window.removeEventListener('pointerdown', onDown, { capture: true });
    window.removeEventListener('pointerup', onUp, { capture: true });
    document.removeEventListener('mouseout', onLeave);
    document.documentElement.removeEventListener('mouseleave', hide);
    document.removeEventListener('pointerout', onOut);
    document.removeEventListener('visibilitychange', hide);
    window.removeEventListener('blur', hide);
    window.removeEventListener('gila:cursors', onRepaint);
    document.documentElement.classList.remove('has-livecursor');
    el.remove();
  };
}

import { cursorImage, type CursorKind } from './cursors';

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
const IDLE_MS = 3000;
/** Things that need a hold to pick up (with the mouse: a note, a note's photo), and how long. */
const HOLD = '.stuck:not(.is-lifted), .nf__photo.is-editable:not(.is-lifted)';
export const MOUSE_HOLD_MS = 380;

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
export const hasMouse = () => typeof matchMedia === 'function' && matchMedia('(any-hover: hover) and (any-pointer: fine)').matches;

/** On by its switch in Settings; left alone, on unless motion is turned down. */
export function wantsLiveCursor(pref: boolean | null): boolean {
  if (!hasMouse()) return false;
  return pref ?? !matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  timer.innerHTML = `<svg viewBox="0 0 24 24"><circle class="livecursor__track" cx="12" cy="12" r="9"/><circle class="livecursor__fill" cx="12" cy="12" r="9"/></svg>`;
  timer.style.setProperty('--hold', `${MOUSE_HOLD_MS}ms`);
  el.append(body, beam, timer);
  document.body.append(el);
  document.documentElement.classList.add('has-livecursor');

  let x = -100;
  let y = -100;
  let lastX = x;
  let lastY = y;
  // The settle wiggle: when a move stops, a swing the other way and two smaller ones.
  let fast = 0;
  let peak = 0;
  let movedAt = 0;
  let dir = 1;
  let wiggleAt = 0;
  let wiggleAmp = 0;
  let kind: CursorKind | 'text' = 'arrow';
  let shown: CursorKind | null = null;
  let waving = false;
  let visible = false;
  // Springs: the lean (degrees) and the size (1 = still).
  let rot = 0;
  let rotV = 0;
  let sc = 1;
  let scV = 0;
  let scTarget = 1;
  let raf = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;

  const picture = (k: CursorKind) => {
    const im = cursorImage(k);
    if (!im) return;
    img.src = im.src;
    body.style.transformOrigin = `${im.hx}px ${im.hy}px`;
    el.style.setProperty('--hx', `${im.hx}px`);
    el.style.setProperty('--hy', `${im.hy}px`);
  };
  const setKind = (k: CursorKind | 'text') => {
    kind = k;
    const want: CursorKind | null = k === 'text' ? null : waving ? 'grab' : k;
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

  const frame = () => {
    raf = 0;
    const vx = x - lastX;
    const vy = y - lastY;
    lastX = x;
    lastY = y;
    const speed = Math.hypot(vx, vy);
    if (speed > 3) {
      fast++;
      peak = Math.max(peak, speed);
      if (Math.abs(vx) > 1) dir = Math.sign(vx);
    }
    // No mouse news for a moment after a real move: it stopped. Wiggle, as big as the move was quick.
    if (fast && performance.now() - movedAt > 55) {
      if (fast >= 3 && !waving) {
        wiggleAt = performance.now();
        wiggleAmp = Math.min(16, 5 + peak * 0.35) * -dir;
      }
      fast = 0;
      peak = 0;
    }
    // Lean into a sideways move; when it stops, swing back well past straight and wiggle to a
    // stop (a loose spring: a clear swing back, then a smaller one, then still).
    const lean = Math.max(-13, Math.min(13, vx * 0.55));
    rotV = (rotV + (lean - rot) * 0.22) * 0.84;
    rot = Math.max(-17, Math.min(17, rot + rotV));
    // On top of the lean, the settle wiggle: a quick sine that dies away in about half a second.
    let wig = 0;
    if (wiggleAt) {
      const t = (performance.now() - wiggleAt) / 1000;
      if (t > 0.7) wiggleAt = 0;
      else wig = wiggleAmp * Math.exp(-t / 0.17) * Math.sin(2 * Math.PI * 3.6 * t + 0.35);
    }
    scV = (scV + (scTarget - sc) * 0.3) * 0.62;
    sc += scV;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    body.style.transform = `translate(calc(-1 * var(--hx, 0px)), calc(-1 * var(--hy, 0px))) rotate(${(rot + wig).toFixed(2)}deg) scale(${sc.toFixed(3)})`;
    if (wiggleAt || fast || Math.abs(rot) > 0.05 || Math.abs(rotV) > 0.05 || Math.abs(sc - scTarget) > 0.002 || Math.abs(scV) > 0.002 || vx) kick();
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
    waving = true;
    shown = null;
    setKind(kind);
    body.classList.remove('is-waving');
    void body.offsetWidth;
    body.classList.add('is-waving');
  };
  const stopWave = () => {
    if (!waving) return;
    waving = false;
    body.classList.remove('is-waving');
    shown = null;
    setKind(kind);
  };
  body.addEventListener('animationend', stopWave);
  const restartIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(wave, IDLE_MS);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      hide();
      return;
    }
    x = e.clientX;
    y = e.clientY;
    movedAt = performance.now();
    // Moved off before the hold landed: no hold.
    if (holdAt && Math.hypot(x - holdAt[0], y - holdAt[1]) > 8) endHold();
    if (!visible) {
      visible = true;
      lastX = x;
      lastY = y;
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
    scTarget = 0.86;
    setKind(kindAt(e.target));
    restartIdle();
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    endHold();
    scTarget = 1;
    setKind(kindAt(e.target));
  };
  const hide = () => {
    visible = false;
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

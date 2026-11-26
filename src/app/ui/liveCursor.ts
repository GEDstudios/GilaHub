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

export function startLiveCursor(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};

  const el = document.createElement('div');
  el.className = 'livecursor';
  el.setAttribute('aria-hidden', 'true');
  const body = document.createElement('div');
  body.className = 'livecursor__body';
  const img = document.createElement('img');
  img.alt = '';
  img.width = 32;
  img.height = 32;
  body.append(img);
  el.append(body);
  document.body.append(el);
  document.documentElement.classList.add('livecursor');

  let x = -100;
  let y = -100;
  let lastX = x;
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
    el.classList.toggle('is-hidden', k === 'text' || !visible);
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
    lastX = x;
    // Lean into a quick sideways move; spring back (a touch past straight) when it stops.
    const lean = Math.max(-16, Math.min(16, vx * 0.6));
    rotV = (rotV + (lean - rot) * 0.22) * 0.72;
    rot += rotV;
    scV = (scV + (scTarget - sc) * 0.3) * 0.62;
    sc += scV;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    body.style.transform = `translate(calc(-1 * var(--hx, 0px)), calc(-1 * var(--hy, 0px))) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(3)})`;
    if (Math.abs(rot) > 0.05 || Math.abs(rotV) > 0.05 || Math.abs(sc - scTarget) > 0.002 || Math.abs(scV) > 0.002 || vx) kick();
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const wave = () => {
    if (!visible || kind === 'text') return;
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
    if (!visible) {
      visible = true;
      lastX = x;
    }
    stopWave();
    setKind(kindAt(e.target));
    restartIdle();
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    stopWave();
    scTarget = 0.86;
    setKind(kindAt(e.target));
    restartIdle();
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
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
  const onRepaint = () => {
    shown = null;
    setKind(kind);
  };
  // Classes that change the shape without a move (a drag starts, a note is lifted).
  const watch = new MutationObserver(() => setKind(kindAt(document.elementFromPoint(x, y))));
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-twist'] });

  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
  window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  window.addEventListener('pointerup', onUp, { capture: true, passive: true });
  document.addEventListener('mouseout', onLeave);
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
    window.removeEventListener('blur', hide);
    window.removeEventListener('gila:cursors', onRepaint);
    document.documentElement.classList.remove('livecursor');
    el.remove();
  };
}

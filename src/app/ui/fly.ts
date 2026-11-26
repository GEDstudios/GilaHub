/**
 * A thing on its way somewhere, in the app's own hand: a sticky note kept from a screen is picked
 * up the way a held note is (it lifts, its shadow deepens, it leans), then glides along an arc
 * into its place in the bar, swaying like paper, leaving a dashed ink trail (the line a lifted
 * note wears) and folding small as it goes. The place catches it: a squash and a bounce, a small
 * note in its colour tucking into the folder, a burst of ink strokes. The original is hidden at
 * once (it may vanish); a copy does the flying.
 */

const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The bar's (or the computer's top bar's) place for a tab, if it's on screen. */
export function tabTarget(key: string): HTMLElement | null {
  const els = [...document.querySelectorAll<HTMLElement>(`nav.tabbar:not(.tabbar--preview) [data-key="${key}"], .topnav [data-tab="${key}"]`)];
  return els.find((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }) ?? null;
}

/**
 * Let the place catch something: a squash and a bounce; with a colour, a small note of that
 * colour pops up out of it and tucks back in, and ink strokes burst around it.
 */
export function catchAt(el: HTMLElement | null, color?: string): void {
  if (!el) return;
  el.classList.remove('is-catch');
  void el.offsetWidth;
  el.classList.add('is-catch');
  const off = (e: AnimationEvent) => {
    if (e.target !== el) return;
    el.classList.remove('is-catch');
    el.removeEventListener('animationend', off);
  };
  el.addEventListener('animationend', off);
  if (!color || calm()) return;
  const icon = el.querySelector<HTMLElement>('.icon') ?? el;
  const box = icon.getBoundingClientRect();
  const fx = document.createElement('span');
  fx.className = 'catchfx';
  fx.setAttribute('aria-hidden', 'true');
  fx.style.left = `${box.left + box.width / 2}px`;
  fx.style.top = `${box.top + box.height / 2}px`;
  fx.style.setProperty('--c', color);
  fx.innerHTML = `<span class="catchfx__note"></span>${Array.from({ length: 7 }, (_, i) => `<i style="--a:${i * (360 / 7) - 90}deg"></i>`).join('')}`;
  document.body.append(fx);
  // Gone once its note has tucked in (the longest part).
  fx.firstElementChild?.addEventListener('animationend', () => fx.remove(), { once: true });
  setTimeout(() => fx.remove(), 4000);
}

/** Where the note is at `t` along the arc (a quadratic curve through a point above both ends). */
function arc(t: number, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): [number, number] {
  const u = 1 - t;
  return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
}

/** Ease in-out (slow off the page, quick through the air, settling in). */
const glide = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Fly a copy of `from` into `to`. Resolves when it lands (at once when motion is turned down).
 * `color` is the thing's colour (a CSS colour), for the trail's end and the catch.
 */
export function flyInto(from: Element | null, to: HTMLElement | null, opts: { color?: string; ms?: number } = {}): Promise<void> {
  const { color, ms = 1050 } = opts;
  if (!from || !to || calm() || typeof document === 'undefined') {
    catchAt(to, color);
    return Promise.resolve();
  }
  const src = from as HTMLElement;
  const r = src.getBoundingClientRect();
  const w = src.offsetWidth || r.width;
  const h = src.offsetHeight || r.height;
  const x0 = r.left + r.width / 2;
  const y0 = r.top + r.height / 2;
  const icon = (to.querySelector('.icon') ?? to).getBoundingClientRect();
  const x1 = icon.left + icon.width / 2;
  const y1 = icon.top + icon.height / 2;

  // Its own turn and size, kept under the flight.
  const base = getComputedStyle(src).transform;
  const own = base && base !== 'none' ? base : '';
  const ghost = src.cloneNode(true) as HTMLElement;
  // Only a picture: nothing to read, focus or find (it isn't the thing itself).
  for (const a of ['id', 'role', 'tabindex', 'aria-label', 'data-note', 'data-id']) ghost.removeAttribute(a);
  ghost.querySelectorAll('[id],[role],[tabindex],[aria-label]').forEach((n) => {
    for (const a of ['id', 'role', 'tabindex', 'aria-label']) n.removeAttribute(a);
  });
  ghost.querySelectorAll('.sticky__check, .stuck__done').forEach((n) => n.remove());
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.remove('stuck', 'is-peeling', 'is-lifted', 'is-moving');
  ghost.classList.add('is-flying');
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${x0 - w / 2}px`,
    top: `${y0 - h / 2}px`,
    width: `${w}px`,
    height: `${h}px`,
    margin: '0',
    zIndex: '2147483000',
    pointerEvents: 'none',
    transformOrigin: '50% 50%',
    translate: 'none',
    rotate: 'none',
    scale: 'none',
  });

  // The arc: up off the page and over, then down into the place.
  const dx = x1 - x0;
  const dy = y1 - y0;
  const rise = Math.min(240, Math.max(110, Math.abs(dy) * 0.5 + 60));
  // Down to the bar: up off the page, over and down. Up to a top bar: a steep rise, then across
  // into it (never off the top of the screen).
  const up = y1 < y0 - 40;
  const cx = up ? x0 + dx * 0.12 : x0 + dx * 0.3;
  const cy = up ? Math.max(8, y1 - 24) : Math.max(12, Math.min(y0, y1) - rise);
  // It ends about the size of the place's icon.
  const end = Math.max(0.08, (Math.min(icon.width, icon.height) * 1.15) / Math.max(w, h));
  const lean = dx >= 0 ? 1 : -1;

  // 0–18%: picked up where it is (the held note's lift and shadow). Then the flight.
  const PEEL = 0.18;
  const frames: Keyframe[] = [
    { offset: 0, transform: `translate(0px, 0px) ${own} rotate(0deg) scale(1)`, filter: 'drop-shadow(0 2px 3px rgb(10 10 4 / 0.12))', opacity: 1 },
    { offset: PEEL * 0.55, transform: `translate(0px, -8px) ${own} rotate(${-3 * lean}deg) scale(1.08)`, filter: 'drop-shadow(0 18px 18px rgb(10 10 4 / 0.28))', opacity: 1, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
    { offset: PEEL, transform: `translate(0px, -6px) ${own} rotate(${-5 * lean}deg) scale(1.07)`, filter: 'drop-shadow(0 18px 18px rgb(10 10 4 / 0.28))', opacity: 1 },
  ];
  const N = 16;
  for (let k = 1; k <= N; k++) {
    const p = k / N;
    const q = glide(p);
    const [x, y] = arc(q, x0, y0 - 6, cx, cy, x1, y1);
    // A paper sway that dies down, a lean into the turn, and a fold small at the end.
    const sway = Math.sin(p * Math.PI * 2.2) * 11 * (1 - p);
    const rot = -5 * lean * (1 - p) + sway + 10 * lean * p * p;
    // Readable through the arc; it folds small only on the way down into the place.
    const s = 1.07 + (end - 1.07) * Math.min(1, q ** 1.7 * 1.04);
    const sy = p > 0.86 ? s * (1 - (p - 0.86) * 1.6) : s;
    const shadow = 18 * (1 - q) + 2;
    frames.push({
      offset: PEEL + (1 - PEEL) * p,
      transform: `translate(${x - x0}px, ${y - y0}px) ${own} rotate(${rot.toFixed(2)}deg) scale(${s.toFixed(3)}, ${sy.toFixed(3)})`,
      filter: `drop-shadow(0 ${shadow.toFixed(1)}px ${shadow.toFixed(1)}px rgb(10 10 4 / ${(0.12 + 0.16 * (1 - q)).toFixed(2)}))`,
      opacity: p > 0.94 ? 0 : 1,
    });
  }

  // The trail: a dashed ink line drawn along the arc behind it, gone as it lands.
  const svgNS = 'http://www.w3.org/2000/svg';
  const trail = document.createElementNS(svgNS, 'svg');
  trail.setAttribute('class', 'flytrail');
  trail.setAttribute('aria-hidden', 'true');
  const d = `M${x0} ${y0 - 6} Q${cx} ${cy} ${x1} ${y1}`;
  const mask = document.createElementNS(svgNS, 'mask');
  const mid = `fly-${Math.random().toString(36).slice(2)}`;
  mask.setAttribute('id', mid);
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  const reveal = document.createElementNS(svgNS, 'path');
  reveal.setAttribute('d', d);
  reveal.setAttribute('pathLength', '1');
  reveal.setAttribute('class', 'flytrail__reveal');
  mask.append(reveal);
  const line = document.createElementNS(svgNS, 'path');
  line.setAttribute('d', d);
  line.setAttribute('class', 'flytrail__line');
  line.setAttribute('mask', `url(#${mid})`);
  trail.append(mask, line);
  document.body.append(trail, ghost);

  // The thing itself is gone from where it was, at once; the copy carries on.
  src.style.visibility = 'hidden';
  const fly = ghost.animate(frames, { duration: ms, easing: 'linear', fill: 'forwards' });
  // The trail draws just behind the note (it starts once it's picked up), then fades.
  reveal.animate(
    [
      { strokeDashoffset: 1, offset: 0 },
      { strokeDashoffset: 1, offset: PEEL },
      { strokeDashoffset: 0.04, offset: 0.97 },
      { strokeDashoffset: 0, offset: 1 },
    ],
    { duration: ms, easing: 'linear', fill: 'forwards' },
  );
  const fade = trail.animate([{ opacity: 1 }, { opacity: 1, offset: 0.72 }, { opacity: 0 }], { duration: ms + 260, easing: 'ease-out', fill: 'forwards' });
  fade.onfinish = () => trail.remove();

  return new Promise((done) => {
    let landed = false;
    const finish = () => {
      if (landed) return;
      landed = true;
      ghost.remove();
      catchAt(to, color);
      done();
    };
    fly.onfinish = finish;
    fly.oncancel = finish;
  });
}

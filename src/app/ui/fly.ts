/**
 * A thing on its way somewhere: a copy of it lifts off where it is and arcs into a place in the
 * bar (a peeled sticky note into Projects, where our notes are kept), shrinking as it goes;
 * the place catches it with a squash and a bounce. The original is left alone (it may vanish).
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

/** Let the place catch something: a squash, a bounce. */
export function catchAt(el: HTMLElement | null): void {
  if (!el) return;
  el.classList.remove('is-catch');
  void el.offsetWidth;
  el.classList.add('is-catch');
  setTimeout(() => el.classList.remove('is-catch'), 700);
}

/** Fly a copy of `from` into `to`. Resolves when it lands (at once when motion is turned down). */
export function flyInto(from: Element | null, to: HTMLElement | null, ms = 720): Promise<void> {
  if (!from || !to || calm() || typeof document === 'undefined') {
    catchAt(to);
    return Promise.resolve();
  }
  const src = from as HTMLElement;
  const r = src.getBoundingClientRect();
  const t = to.getBoundingClientRect();
  const w = src.offsetWidth || r.width;
  const h = src.offsetHeight || r.height;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // Keep the copy's own turn and size, then add the flight on top.
  const base = getComputedStyle(src).transform;
  const own = base && base !== 'none' ? base : '';
  const ghost = src.cloneNode(true) as HTMLElement;
  // Only a picture: nothing to read, focus or find (it isn't the thing itself).
  for (const a of ['id', 'role', 'tabindex', 'aria-label', 'data-note', 'data-id']) ghost.removeAttribute(a);
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.remove('stuck', 'is-peeling');
  ghost.classList.add('is-flying');
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${cx - w / 2}px`,
    top: `${cy - h / 2}px`,
    width: `${w}px`,
    height: `${h}px`,
    margin: '0',
    zIndex: '2147483000',
    pointerEvents: 'none',
    transformOrigin: '50% 50%',
  });
  document.body.append(ghost);
  // The copy carries on; the thing itself is gone from where it was, at once.
  src.style.visibility = 'hidden';
  const dx = t.left + t.width / 2 - cx;
  const dy = t.top + t.height / 2 - cy;
  // Up first, then a long arc down into the place.
  const lift = Math.min(140, Math.max(60, Math.abs(dy) * 0.35));
  const end = Math.max(0.06, Math.min(t.width, t.height) / Math.max(w, h));
  const anim = ghost.animate(
    [
      { transform: `translate(0, 0) ${own} scale(1)`, opacity: 1, offset: 0 },
      { transform: `translate(${dx * 0.12}px, ${-lift * 0.7}px) ${own} rotate(-8deg) scale(1.08)`, opacity: 1, offset: 0.22 },
      { transform: `translate(${dx * 0.6}px, ${dy * 0.35 - lift}px) ${own} rotate(10deg) scale(0.55)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${dx}px, ${dy}px) ${own} rotate(24deg) scale(${end})`, opacity: 0.2, offset: 1 },
    ],
    { duration: ms, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' },
  );
  return new Promise((done) => {
    const finish = () => {
      ghost.remove();
      catchAt(to);
      done();
    };
    anim.onfinish = finish;
    anim.oncancel = finish;
  });
}

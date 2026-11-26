import { useEffect, useRef, useState } from 'react';
import type { LineColor } from '../../core/model';
import { GLYPHS } from './icons.gen';
import { calm } from './tokens';

/**
 * My person's cursor, as the computer's live cursor draws mine: the Gila Duo arrow, its light in
 * their colour, a white edge. Now and then, quietly, it hops, wiggles, loops, clicks or peeks;
 * tap it and it waves (the open hand) back. Calm when motion is turned down.
 */
type Trick = 'wave' | 'hop' | 'wiggle' | 'loop' | 'click' | 'peek';
const TRICKS: Trick[] = ['wave', 'hop', 'wiggle', 'loop', 'click', 'peek'];
const LENGTH: Record<Trick, number> = { wave: 1400, hop: 700, wiggle: 700, loop: 1100, click: 650, peek: 1200 };


function Glyph({ name, light, turn }: { name: keyof typeof GLYPHS; light: string; turn?: string }) {
  const [glyphLight, line] = GLYPHS[name];
  return (
    <g transform={turn}>
      <path d={line} fill="#fff" stroke="#fff" strokeWidth={26} strokeLinejoin="round" />
      {glyphLight ? <path d={glyphLight} fill={light} /> : null}
      <path d={line} fill="#0a0a04" fillRule="evenodd" />
    </g>
  );
}

export function PersonCursor({ color, className = '' }: { color: LineColor; className?: string }) {
  const [trick, setTrick] = useState<Trick | null>(null);
  const last = useRef<Trick | null>(null);
  const timer = useRef<number>(0);
  const light = `var(--${color === 'ink' ? 'lemon' : color})`;

  const play = (t?: Trick) => {
    if (calm()) return;
    // Never the same one twice in a row; a wave only when it's tapped.
    const pool = TRICKS.filter((x) => x !== last.current && x !== 'wave');
    const next = t ?? pool[Math.floor(Math.random() * pool.length)];
    last.current = next;
    setTrick(null);
    requestAnimationFrame(() => setTrick(next));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setTrick(null), LENGTH[next]);
  };

  useEffect(() => {
    if (calm()) return;
    // Something small every while; never a wave by itself.
    let loop = 0;
    const again = () => {
      loop = window.setTimeout(() => {
        if (document.visibilityState === 'visible') play();
        again();
      }, 7000 + Math.random() * 7000);
    };
    again();
    return () => {
      window.clearTimeout(loop);
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span
      className={`pcursor ${trick ? `is-${trick}` : ''} ${className}`}
      aria-hidden="true"
      onPointerDown={(e) => {
        e.stopPropagation();
        play('wave');
      }}
      // A tap on the cursor is for it (a wave), not for what it sits on.
      onClick={(e) => e.stopPropagation()}
    >
      <svg viewBox="-12 -12 280 280" className="pcursor__svg">
        {trick === 'wave' ? <Glyph name="hand" light={light} /> : <Glyph name="cursor-arrow" light={light} turn="translate(34 34) rotate(22) scale(0.84) translate(-34 -34)" />}
      </svg>
      {trick === 'click' ? <span className="pcursor__ring" /> : null}
    </span>
  );
}

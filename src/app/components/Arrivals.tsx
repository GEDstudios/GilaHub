import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Hub } from '../../core/hub';
import { useHub } from '../context';
import { navigate } from '../router';
import { placeUrl } from './Notes';
import { haptic } from '../ui/haptics';
import { Icon, type IconName } from '../ui/Icon';
import { playSound } from '../ui/sounds';
import { G_TEXT } from '../ui/glyphs';
import { G } from '../ui/glyphs';

/**
 * Something arrived while the app is open (a reminder came due, my person left a note or asked
 * me something, a push landed): it drops in from the top as a small card, with our doorbell.
 * Tap to go there; swipe it up, or let it be, and it's gone. A thing to do has Done and
 * Tomorrow right on it, like the phone's notification.
 */
export interface Arrival {
  title: string;
  body?: string;
  url?: string;
  /** What kind, for its little mark. */
  kind?: 'reminder' | 'note' | 'ask' | 'done' | 'other';
}

type Shown = Arrival & { id: number };

/**
 * Was I looking when it happened? While the app is in the background the phone shows the
 * system notification; the card is only for what arrives while I'm looking, never a repeat of
 * what the phone already said (once I come back, or reopen the app).
 */
let visibleSince = typeof document !== 'undefined' && document.visibilityState === 'visible' ? Date.now() : Infinity;
if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    visibleSince = document.visibilityState === 'visible' ? Date.now() : Infinity;
  });
export const sawItHappen = (at: number): boolean => typeof document !== 'undefined' && document.visibilityState === 'visible' && at >= visibleSince - 1500;
let queue: Shown[] = [];
let seq = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function announce(a: Arrival): void {
  // The same thing twice in a row (a push and the sync that follows it) shows once.
  if (queue.some((q) => q.title === a.title && q.body === a.body)) return;
  queue = [...queue, { ...a, id: seq++ }].slice(-3);
  playSound('notify');
  emit();
}

function dismiss(id: number) {
  queue = queue.filter((q) => q.id !== id);
  emit();
}

const MARK: Record<NonNullable<Arrival['kind']>, IconName> = { reminder: 'bell', note: 'note', ask: 'request', done: 'check', other: 'bell' };

/** "/i/abc" → "abc": a thing to do, with Done and Tomorrow. */
const itemOf = (url?: string) => (url ? /^\/i\/([A-Za-z0-9]+)$/.exec(url)?.[1] : undefined);

export function Arrivals() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => queue,
  );
  const top = list.at(-1);
  if (!top) return null;
  return <Card key={top.id} a={top} more={list.length - 1} />;
}

function Card({ a, more }: { a: Shown; more: number }) {
  const hub = useHub();
  const [leaving, setLeaving] = useState(false);
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);
  const id = itemOf(a.url);
  const item = id ? hub.item(id) : undefined;
  const go = (suffix = '') => {
    leave();
    if (a.url) navigate(`${a.url}${suffix}`);
  };
  const leave = () => {
    setLeaving(true);
    setTimeout(() => dismiss(a.id), 240);
  };
  useEffect(() => {
    const t = setTimeout(leave, 7000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className={`arrival ${leaving ? 'is-leaving' : ''}`}
      role="alert"
      style={dy < 0 ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}
      onPointerDown={(e) => {
        start.current = e.clientY;
      }}
      onPointerMove={(e) => {
        if (start.current !== null) setDy(Math.min(0, e.clientY - start.current));
      }}
      onPointerUp={() => {
        start.current = null;
        if (dy < -30) leave();
        else setDy(0);
      }}
    >
      <button type="button" className="arrival__main" onClick={() => go()}>
        <span className={`arrival__mark arrival__mark--${a.kind ?? 'other'}`}>
          <Icon name={MARK[a.kind ?? 'other']} />
        </span>
        <span className="arrival__text">
          <strong dir="auto">{a.title}</strong>
          {a.body ? <span dir="auto">{a.body}</span> : null}
        </span>
        {more ? <span className="arrival__more num">+{more}</span> : null}
      </button>
      {item && !item.done ? (
        <span className="arrival__actions">
          <button
            type="button"
            className="arrival__act"
            onClick={() => {
              haptic('tick');
              go('?do=done');
            }}
          >
            <Icon name={G.done} className="icon--sm" /> Done
          </button>
          <button type="button" className="arrival__act" onClick={() => go('?do=later')}>
            Tomorrow
          </button>
        </span>
      ) : null}
    </div>
  );
}

/**
 * Watch what sync brings in: a note my person just left me, or something they just asked me.
 * Only what arrives while the app is open (not what was there when it opened).
 */
export function useArrivalWatch(hub: Hub): void {
  useEffect(() => {
    const seen = new Set<string>();
    const since = Date.now();
    const look = () => {
      const partner = hub.partner();
      if (!partner) return;
      for (const n of hub.notesForMe()) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        if (n.createdAt > since && n.by !== hub.meId && sawItHappen(n.createdAt)) announce({ kind: 'note', title: `${G_TEXT.note} ${partner.name} left you a note`, body: n.text, url: placeUrl(n.place) });
      }
      for (const i of hub.store.all('item')) {
        if (seen.has(`ask:${i.id}`) || i.done || i.requestedBy !== partner.id || i.assignee !== hub.meId) continue;
        seen.add(`ask:${i.id}`);
        if ((i.createdAt ?? 0) > since && sawItHappen(i.createdAt ?? 0)) announce({ kind: 'ask', title: `${G_TEXT.ask} ${partner.name} asked you`, body: i.title, url: `/i/${i.id}` });
      }
    };
    look();
    return hub.store.subscribe(look);
  }, [hub]);
}

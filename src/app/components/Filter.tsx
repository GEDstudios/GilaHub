import type { Hub } from '../../core/actions';
import type { Item } from '../../core/model';
import { useHub } from '../context';
import { setPrefs, usePrefs } from '../prefs';
import type { ReactNode } from 'react';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Avatar } from '../ui/primitives';
import { TagMark } from './Tags';

/**
 * Show only some things, on any screen: with these tags (any of them), for whom, urgent ones.
 * Each screen keeps its own ("today", "shop", "l:<id>"), on this device.
 */
export interface Filter {
  tags: string[];
  who: 'me' | 'partner' | null;
  urgent: boolean;
}

export const NO_FILTER: Filter = { tags: [], who: null, urgent: false };

export const isActive = (f: Filter): boolean => f.tags.length > 0 || !!f.who || f.urgent;

/** Whose is it to do: whoever it's given to (both, or whose turn); not given to anyone, whose it is. */
function forWhom(hub: Hub, i: Item, member: string): boolean {
  if (i.assignee === member || i.assignee === 'both') return true;
  if (i.assignee === 'turns') return (i.turn ?? null) === member;
  if (i.assignee) return false;
  return hub.ownerOf(i) === member;
}

/** Does it pass? (A task passes when it does, or when one of its subtasks does.) */
export function passes(hub: Hub, f: Filter, i: Item, deep = false): boolean {
  if (!isActive(f)) return true;
  const self = (x: Item) => {
    if (f.urgent && !x.urgent) return false;
    if (f.who) {
      const who = f.who === 'me' ? hub.meId : hub.partner()?.id;
      if (!who || !forWhom(hub, x, who)) return false;
    }
    if (f.tags.length) {
      const has = hub.tagsOf(x);
      if (!f.tags.some((t) => has.includes(t))) return false;
    }
    return true;
  };
  return self(i) || (deep && hub.descendants(i.id).some(self));
}

/** A screen's filter, and the way to change it. */
export function useFilter(key: string) {
  const hub = useHub();
  const prefs = usePrefs();
  const raw = prefs.filters?.[key];
  // Tags taken away since don't count.
  const f: Filter = raw ? { tags: (raw.tags ?? []).filter((t) => !!hub.tag(t)), who: raw.who ?? null, urgent: !!raw.urgent } : NO_FILTER;
  const set = (next: Filter) => setPrefs({ filters: { ...(prefs.filters ?? {}), [key]: next } });
  return {
    key,
    f,
    set,
    clear: () => set(NO_FILTER),
    active: isActive(f),
    test: (i: Item, deep = false) => passes(hub, f, i, deep),
  };
}

export type FilterState = ReturnType<typeof useFilter>;

/**
 * The lens: one quiet row of chips over a screen's things, so you narrow it in a tap and widen it
 * in another. All (and how many), then the people, Urgent, and the tags that are actually here,
 * each with its count, in our order. Tap to keep only those; tap again to let go. Several tags
 * show what wears any of them; one person at a time. Nothing to narrow: no row at all. `children`
 * end the row (a project's view switch).
 */
export function Lens({ filter, items, children }: { filter: FilterState; items: Item[]; children?: ReactNode }) {
  const hub = useHub();
  const f = filter.f;
  const partner = hub.partner();
  const me = hub.me();
  const count = (test: (i: Item) => boolean) => items.filter(test).length;
  const people = partner
    ? ([
        ['me', me, count((i) => forWhom(hub, i, hub.meId))],
        ['partner', partner, count((i) => forWhom(hub, i, partner.id))],
      ] as const).filter(([who, , n]) => n > 0 || f.who === who)
    : [];
  const urgentN = count((i) => !!i.urgent);
  const tagN = new Map<string, number>();
  for (const i of items) for (const t of hub.tagsOf(i)) tagN.set(t, (tagN.get(t) ?? 0) + 1);
  const tags = hub.tags().filter((t) => tagN.has(t.id) || f.tags.includes(t.id));
  const facets = people.length + (urgentN || f.urgent ? 1 : 0) + tags.length;
  const pick = (next: Filter) => {
    haptic('select');
    filter.set(next);
  };
  if (!facets && !filter.active) return children ? <div className="lens lens--bare">{children}</div> : null;
  return (
    <div className="lens">
      <div className="lens__chips" role="toolbar" aria-label="Show only">
        <button type="button" className={`lens__chip ${filter.active ? '' : 'is-on'}`} aria-pressed={!filter.active} onClick={() => filter.active && pick(NO_FILTER)}>
          <span>All</span>
          <span className="lens__n num">{items.length}</span>
        </button>
        {people.map(([who, m, n]) => (
          <button
            key={who}
            type="button"
            className={`lens__chip lens__chip--person ${f.who === who ? 'is-on' : ''}`}
            aria-pressed={f.who === who}
            onClick={() => pick({ ...f, who: f.who === who ? null : who })}
          >
            <Avatar member={m} size="xs" />
            <span dir="auto">{who === 'me' ? 'Me' : m?.name}</span>
            <span className="lens__n num">{n}</span>
          </button>
        ))}
        {urgentN || f.urgent ? (
          <button type="button" className={`lens__chip ${f.urgent ? 'is-on' : ''}`} aria-pressed={f.urgent} onClick={() => pick({ ...f, urgent: !f.urgent })}>
            <Icon name="urgent" className="icon--sm" />
            <span>Urgent</span>
            <span className="lens__n num">{urgentN}</span>
          </button>
        ) : null}
        {tags.map((t) => {
          const on = f.tags.includes(t.id);
          return (
            <button key={t.id} type="button" className={`lens__chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => pick({ ...f, tags: on ? f.tags.filter((x) => x !== t.id) : [...f.tags, t.id] })}>
              <TagMark icon={t.icon} />
              <span dir="auto">{t.name}</span>
              <span className="lens__n num">{tagN.get(t.id) ?? 0}</span>
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}

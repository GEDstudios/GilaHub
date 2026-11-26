import type { Hub } from '../../core/actions';
import type { Item } from '../../core/model';
import { useHub } from '../context';
import { setPrefs, usePrefs } from '../prefs';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Avatar, Seg } from '../ui/primitives';
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

/** The header's filter button: a dot on it while something is filtered out. */
export function FilterButton({ filter }: { filter: FilterState }) {
  const { openSheet } = useOverlays();
  return (
    <button
      type="button"
      className={`iconbtn filterbtn ${filter.active ? 'is-on' : ''}`}
      aria-label={filter.active ? 'Filter (on)' : 'Filter'}
      title="Filter"
      aria-pressed={filter.active}
      onClick={() => openSheet((close) => <FilterSheet fkey={filter.key} onClose={close} />)}
    >
      <Icon name="sliders" />
    </button>
  );
}

/** What to show: for whom, urgent only, and tags (any of them). Changes apply as you tap. */
function FilterSheet({ fkey, onClose }: { fkey: string; onClose: () => void }) {
  const hub = useHub();
  // Its own read of the filter: the sheet outlives the screen's render that opened it.
  const filter = useFilter(fkey);
  const partner = hub.partner();
  const f = filter.f;
  const counts = hub.tagCounts();
  const tags = hub.tags();
  const flip = (id: string) => filter.set({ ...f, tags: f.tags.includes(id) ? f.tags.filter((t) => t !== id) : [...f.tags, id] });
  return (
    <Sheet onClose={onClose} title="Show only">
      {partner ? (
        <div className="filtersheet__part">
          <p className="panel__head">For</p>
          <Seg
            label="For whom"
            value={f.who ?? 'any'}
            onChange={(v) => filter.set({ ...f, who: v === 'any' ? null : (v as 'me' | 'partner') })}
            options={[
              { value: 'any', label: 'Anyone' },
              { value: 'me', label: 'Me' },
              { value: 'partner', label: partner.name },
            ]}
          />
        </div>
      ) : null}
      <div className="filtersheet__part">
        <button type="button" className={`tagtoken ${f.urgent ? 'is-on' : ''}`} aria-pressed={f.urgent} onClick={() => filter.set({ ...f, urgent: !f.urgent })}>
          <Icon name="urgent" className="icon--sm" />
          <span>Urgent only</span>
          {f.urgent ? <Icon name="check" className="icon--xs" /> : null}
        </button>
      </div>
      {tags.length ? (
        <div className="filtersheet__part">
          <p className="panel__head">Tags</p>
          <div className="tagpick__tags" role="group" aria-label="Tags">
            {tags.map((t) => (
              <button key={t.id} type="button" className={`tagtoken ${f.tags.includes(t.id) ? 'is-on' : ''}`} aria-pressed={f.tags.includes(t.id)} onClick={() => flip(t.id)}>
                <TagMark icon={t.icon} />
                <span dir="auto">{t.name}</span>
                {counts.get(t.id) ? <span className="tagtoken__n num">{counts.get(t.id)}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="filtersheet__foot">
        {filter.active ? (
          <button type="button" className="btn btn--quiet" onClick={() => filter.clear()}>
            Show everything
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

/** While a filter is on: what it keeps, each with its ×, and Clear. Under the header. */
export function FilterBar({ filter, hidden }: { filter: FilterState; hidden?: number }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  if (!filter.active) return null;
  const f = filter.f;
  const partner = hub.partner();
  const whoName = f.who === 'me' ? 'Me' : partner?.name;
  return (
    <div className="filterbar" role="group" aria-label="Filtered">
      <button type="button" className="filterbar__lead" onClick={() => openSheet((close) => <FilterSheet fkey={filter.key} onClose={close} />)} aria-label="Change the filter">
        <Icon name="sliders" className="icon--sm" />
      </button>
      {f.who && whoName ? (
        <button type="button" className="tagtoken is-on" onClick={() => filter.set({ ...f, who: null })} aria-label={`Stop showing only ${whoName}`}>
          <Avatar member={f.who === 'me' ? hub.me() : partner} size="xs" />
          <span dir="auto">{whoName}</span>
          <Icon name="x" className="icon--xs" />
        </button>
      ) : null}
      {f.urgent ? (
        <button type="button" className="tagtoken is-on" onClick={() => filter.set({ ...f, urgent: false })} aria-label="Stop showing only urgent">
          <Icon name="urgent" className="icon--sm" />
          <span>Urgent</span>
          <Icon name="x" className="icon--xs" />
        </button>
      ) : null}
      {f.tags.map((id) => {
        const t = hub.tag(id);
        return t ? (
          <button key={id} type="button" className="tagtoken is-on" onClick={() => filter.set({ ...f, tags: f.tags.filter((x) => x !== id) })} aria-label={`Stop filtering by ${t.name}`}>
            <TagMark icon={t.icon} />
            <span dir="auto">{t.name}</span>
            <Icon name="x" className="icon--xs" />
          </button>
        ) : null;
      })}
      <button type="button" className="textbtn filterbar__clear" onClick={() => filter.clear()}>
        Clear{hidden ? ` · ${hidden} hidden` : ''}
      </button>
    </div>
  );
}

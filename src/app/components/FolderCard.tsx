import { useMemo, useRef, type CSSProperties } from 'react';
import type { Hub } from '../../core/hub';
import type { List } from '../../core/model';
import { barTarget, getAim, setAim } from '../barEdit';
import { useHub } from '../context';
import { navigate } from '../router';
import { AddDisc } from '../ui/edit';
import { replay } from '../ui/flip';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { lineVars } from '../ui/primitives';
import { Glyph, showsGlyph } from '../ui/FolderMark';
import { useSortableItem } from '../ui/Sortable';
import { listVisLabel, VIS_ICON } from '../privacy';
import { MAX_PINS, pinAt, pinOptions, pinsOf, setPins, togglePin } from '../tabs';
import { folderCount } from '../views';
import { hashOf } from '../../core/ids';
import { listKey } from '../../core/keys';
import { G } from '../ui/glyphs';

/** A small, stable tilt per folder, so the cards sit like real folders. */
const tilt = (id: string): number => [-2.2, -1.4, -0.6, 0.8, 1.5, 2.3][hashOf(id) % 6];

/** Where a folder is dropped to pin it: the bottom bar, or on a computer the top bar's places. */
const liveBar = () => {
  const bar = document.querySelector<HTMLElement>('.tabbar');
  if (bar && bar.getBoundingClientRect().width) return bar;
  return document.querySelector('.topnav__tabs');
};
const tabOf = (hub: Hub, key: string) => pinOptions(hub).find((o) => o.key === key);

/**
 * Arranging the bar, a folder tap is its pin: in goes just before Folders, out comes out. A
 * folder the Shopping or Chores tab already shows flashes that tab instead; a full bar shakes.
 */
function tapPin(hub: Hub, list: List) {
  const pins = pinsOf(hub);
  const key = listKey(list.id);
  if (!pins.includes(key) && pins.length >= MAX_PINS) {
    haptic('warn');
    return replay(liveBar(), 'is-refusing');
  }
  haptic('tick');
  togglePin(hub, key);
}

/**
 * Dropped on the bar: pinned where it landed. Outside the arranging mode a newcomer says so,
 * with Undo. For folder cards anywhere (the Folders page, the folders inside a folder) and the
 * bar tray's tokens.
 */
export function useBarDrop(arranging = false) {
  const hub = useHub();
  const { toast } = useOverlays();
  const arrangingRef = useRef(arranging);
  arrangingRef.current = arranging;
  return useMemo(() => {
    const place = (key: string, at: number | null, full: boolean) => {
      if (full) return toast('The bar is full');
      const before = pinsOf(hub);
      const was = before.includes(key);
      pinAt(hub, key, at ?? before.length);
      const name = tabOf(hub, key)?.label;
      if (!was && name && !arrangingRef.current) toast(`${name} is pinned to the bar`, { undo: () => setPins(hub, before) });
    };
    const common = { nav: liveBar, tabOf: (key: string) => tabOf(hub, key), pinned: () => pinsOf(hub), get: getAim, set: setAim, place };
    return { folders: barTarget({ ...common, keyOf: (id) => listKey(id) }), tokens: barTarget(common) };
  }, [hub, toast]);
}

/** As the bar shows a folder, for a card lifted over it. */
export const barTabOf = tabOf;

/** A folder's pin while arranging: a white + when it's not in the bar, an ink pin when it is. */
function FolderPin({ list, pins, index }: { list: List; pins: string[]; index: number }) {
  const hub = useHub();
  const on = pins.includes(listKey(list.id));
  const label = on ? `${list.name} is pinned to the bar` : `Pin ${list.name} to the bar`;
  return (
    <button
      type="button"
      className={`folderpin${on ? ' is-in' : ''}`}
      style={{ '--i': index } as CSSProperties}
      aria-pressed={on}
      aria-disabled={!on && pins.length >= MAX_PINS ? true : undefined}
      aria-label={label}
      title={label}
      onClick={() => tapPin(hub, list)}
    >
      {on ? (
        <span className="folderpin__in">
          <Icon name={G.pinToBar} />
        </span>
      ) : (
        <AddDisc />
      )}
    </button>
  );
}

/** A folder card in the grid: drag it to reorder (a long press on phones), or onto the bar to pin it there. */
export function SortableFolder({ list, arranging, pins, index }: { list: List; arranging: boolean; pins: string[]; index: number }) {
  const hub = useHub();
  const s = useSortableItem(list.id);
  return (
    <div
      ref={s.ref}
      data-id={list.id}
      className={`folderslot ${s.className}`}
      style={{ ...s.style, '--tilt': `${tilt(list.id)}deg` } as CSSProperties}
      {...s.props}
    >
      <FolderCard list={list} onClick={arranging ? () => tapPin(hub, list) : undefined} />
      {arranging ? <FolderPin list={list} pins={pins} index={index} /> : null}
    </div>
  );
}

/** A folder lifts with its own tilt, plus 3deg, and lands back at its tilt. */
export const folderLean = (id: string) => ({ rest: tilt(id) + 3, land: tilt(id) });

/** A folder as a card: its name, what's open in it, whose it is, its glyph. A tap opens it. */
export function FolderCard({ list, onClick }: { list: List; onClick?: () => void }) {
  const hub = useHub();
  const count = folderCount(hub, list);
  // A folder with folders in it looks it: more sheets peek out behind.
  const inside = hub.subLists(list.id).length;
  return (
    <button
      type="button"
      className={`ccard ccard--md foldercard${inside ? ' foldercard--stack' : ''}`}
      data-inside={inside || undefined}
      style={{ ...lineVars(list.color), ['--tilt' as string]: `${tilt(list.id)}deg` }}
      onClick={onClick ?? (() => navigate({ name: 'list', id: list.id }))}
      data-drag
      data-drop-list={list.id}
    >
      {/* The name gets the card's whole width; the glyph sits low, by the count. */}
      <span className="ccard__top">
        <span className="ccard__title foldercard__name" dir="auto">
          {list.name}
        </span>
      </span>
      <span className="ccard__sub foldercard__foot">
        <span>
          {list.visibility === 'private' ? <Icon name={VIS_ICON.private} className="ccard__lock" /> : null}
          {count.text}
          {list.visibility !== 'shared' ? ` · ${listVisLabel(hub, list)}` : ''}
        </span>
        {showsGlyph(list.icon) ? <Glyph icon={list.icon} className="ccard__glyph" /> : null}
      </span>
    </button>
  );
}

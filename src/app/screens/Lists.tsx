import { GrowField } from '../ui/AutoTitle';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Hub } from '../../core/hub';
import { suggestIcon } from '../../core/projectIcons';
import type { List } from '../../core/model';
import { barTarget, getAim, setAim, setArranging, useBarEdit } from '../barEdit';
import { BarToken, BarTokenLifted, TabChip } from '../components/BarEdit';
import { ProjectFields, type ProjectLook } from '../components/ProjectFields';
import { CardIcon, IconPicker } from '../components/IconPicker';
import { useHub } from '../context';
import { navigate } from '../router';
import { AddDisc, DoneButton } from '../ui/edit';
import { replay } from '../ui/flip';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, Disclosure, lineVars, ListBullet, TextButton, Button } from '../ui/primitives';
import { SyncBadge } from '../components/SyncBadge';
import { Glyph, showsGlyph } from '../ui/ProjectMark';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { useBackGuard } from '../ui/backGuard';
import { listVisLabel, VIS_ICON } from '../privacy';
import { MAX_PINS, pinAt, pinOptions, pinsOf, setPins, togglePin } from '../tabs';
import { projectCount } from '../views';
import { CollectedNotes } from '../components/Notes';
import { hashOf } from '../../core/ids';
import { listKey, listIdOf } from '../../core/keys';
import { G } from '../ui/glyphs';
import { useEscape } from '../ui/keyboard';

/** A name on a card of its color, then the same chips as a project's page. */
export function NewProjectSheet({
  onClose,
  parentId,
  name: startName = '',
}: {
  onClose: () => void;
  parentId?: string;
  /** Start with this name written (a search with nothing found). */
  name?: string;
}) {
  const hub = useHub();
  const parent = hub.list(parentId);
  const [name, setName] = useState(startName);
  const [look, setLook] = useState<ProjectLook>(() => ({
    color: hub.freshColor(),
    // Unset until picked: the name suggests one as it's typed.
    icon: undefined,
    // Inside a folder that's Mine or Only me, a new one is too (and whose it is).
    visibility: parent?.visibility ?? 'shared',
    owner: parent && parent.visibility !== 'shared' ? (parent.owner ?? hub.meId) : undefined,
    pinned: false,
  }));
  const [picking, setPicking] = useState(false);
  const icon = look.icon ?? suggestIcon(name, 'tasks', undefined, hub.lists().at(-1)?.icon, hub.iconsInUse());

  const create = () => {
    if (!name.trim()) return;
    // A project made inside another is looked at the way that one is (by tag, inside Shopping).
    const id = hub.createList({ name, color: look.color, icon, visibility: look.visibility, owner: look.owner, parentId: parent?.id, view: parent?.view });
    if (look.pinned) togglePin(hub, listKey(id));
    onClose();
    navigate({ name: 'list', id });
  };
  // The phone's Back with a name written: make it, or don't.
  useBackGuard({ dirty: !!name.trim(), title: 'Create this folder?', saveLabel: 'Create it', discardLabel: 'Discard', onSave: create, onDiscard: onClose });

  return (
    // No title: the card says it, its placeholder asking for the name.
    <Sheet onClose={onClose} label={parent ? `New folder in ${parent.name}` : 'New folder'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        {/* A folder from the start: the same tab on top as on Projects. */}
        <div className="ccard ccard--lg ccard--edit ccard--folder" style={lineVars(look.color)}>
          <span className="ccard__top">
            <GrowField className="ccard__input" placeholder={parent ? `Name a folder in ${parent.name}` : 'Name your new folder'} value={name} onChange={setName} label="Folder name" />
          </span>
          <span className="ccard__sub projcard__foot">
            <span>
              {parent ? `In ${parent.name}` : 'Folder'} · {listVisLabel(hub, { visibility: look.visibility, owner: look.owner ?? (look.visibility === 'shared' ? null : hub.meId) })}
            </span>
            {/* Its icon, right on the card (low, as on the folders): tap it to pick another. */}
            <CardIcon icon={icon} open={picking} onToggle={() => setPicking(!picking)} />
          </span>
        </div>

        {picking ? (
          <div className="panel ccard__pick">
            <IconPicker
              value={icon}
              color={look.color}
              onChange={(v) => {
                setLook((l) => ({ ...l, icon: v }));
                setPicking(false);
              }}
            />
          </div>
        ) : null}


        <ProjectFields value={{ ...look, icon }} onChange={(p) => setLook((l) => ({ ...l, ...p }))} />

        <Button block type="submit" style={{ marginTop: 26 }} disabled={!name.trim()}>
          Create folder
        </Button>
      </form>
    </Sheet>
  );
}

/** A small, stable tilt per project, so the cards sit like real folders. */
const tilt = (id: string): number => [-2.2, -1.4, -0.6, 0.8, 1.5, 2.3][hashOf(id) % 6];

/** Where a folder is dropped to pin it: the bottom bar, or on a computer the top bar's places. */
const liveBar = () => {
  const bar = document.querySelector<HTMLElement>('.tabbar');
  if (bar && bar.getBoundingClientRect().width) return bar;
  return document.querySelector('.topnav__tabs');
};
const tabOf = (hub: Hub, key: string) => pinOptions(hub).find((o) => o.key === key);

/**
 * Arranging the bar, a folder tap is its pin: in goes just before Projects, out comes out. A
 * project the Shopping or Chores tab already shows flashes that tab instead; a full bar shakes.
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
      if (!was && name && !arrangingRef.current) toast(`${name} is in the bar`, { undo: () => setPins(hub, before) });
    };
    const common = { nav: liveBar, tabOf: (key: string) => tabOf(hub, key), pinned: () => pinsOf(hub), get: getAim, set: setAim, place };
    return { folders: barTarget({ ...common, keyOf: (id) => listKey(id) }), tokens: barTarget(common) };
  }, [hub, toast]);
}

/** As the bar shows a folder, for a card lifted over it. */
export const barTabOf = tabOf;

/** A folder's pin while arranging: a white + when it's not in the bar, an ink pin when it is. */
function ProjPin({ list, pins, index }: { list: List; pins: string[]; index: number }) {
  const hub = useHub();
  const on = pins.includes(listKey(list.id));
  const label = on ? `${list.name} is in the bar` : `Put ${list.name} in the bar`;
  return (
    <button
      type="button"
      className={`projpin${on ? ' is-in' : ''}`}
      style={{ '--i': index } as CSSProperties}
      aria-pressed={on}
      aria-disabled={!on && pins.length >= MAX_PINS ? true : undefined}
      aria-label={label}
      title={label}
      onClick={() => tapPin(hub, list)}
    >
      {on ? (
        <span className="projpin__in">
          <Icon name={G.pinToBar} />
        </span>
      ) : (
        <AddDisc />
      )}
    </button>
  );
}

/** Drag a folder to reorder projects (a long press on phones), or onto the bar to pin it there. */
export function SortableProject({ list, arranging, pins, index }: { list: List; arranging: boolean; pins: string[]; index: number }) {
  const hub = useHub();
  const s = useSortableItem(list.id);
  return (
    <div
      ref={s.ref}
      data-id={list.id}
      className={`projslot ${s.className}`}
      style={{ ...s.style, '--tilt': `${tilt(list.id)}deg` } as CSSProperties}
      {...s.props}
    >
      <ProjectCard list={list} onClick={arranging ? () => tapPin(hub, list) : undefined} />
      {arranging ? <ProjPin list={list} pins={pins} index={index} /> : null}
    </div>
  );
}

/** A folder lifts with its own tilt, plus 3deg, and lands back at its tilt. */
export const folderLean = (id: string) => ({ rest: tilt(id) + 3, land: tilt(id) });

export function ProjectCard({ list, onClick }: { list: List; onClick?: () => void }) {
  const hub = useHub();
  const count = projectCount(hub, list);
  // A folder with folders in it looks it: more sheets peek out behind.
  const inside = hub.subLists(list.id).length;
  return (
    <button
      type="button"
      className={`ccard ccard--md projcard${inside ? ' projcard--stack' : ''}`}
      data-inside={inside || undefined}
      style={{ ...lineVars(list.color), ['--tilt' as string]: `${tilt(list.id)}deg` }}
      onClick={onClick ?? (() => navigate({ name: 'list', id: list.id }))}
      data-drag
      data-drop-list={list.id}
    >
      {/* The name gets the card's whole width; the glyph sits low, by the count. */}
      <span className="ccard__top">
        <span className="ccard__title projcard__name" dir="auto">
          {list.name}
        </span>
      </span>
      <span className="ccard__sub projcard__foot">
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


/** While the bar tray floats over the page, the page makes room for it (as for the shopbar). */
function useFloatHeight(el: HTMLElement | null) {
  useLayoutEffect(() => {
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--float-h', `${el.offsetHeight + 12}px`);
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--float-h');
    };
  }, [el]);
}

/**
 * Projects (BAR §4): folders you open, drag to reorder, or drag down onto the bottom bar to pin
 * there. "Arrange the bar" (phone) makes the bar itself editable: folders get pins, the real
 * bar takes × and drags, and Shopping, Chores and Search float above it while they're out.
 */
export function Lists() {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const { arranging } = useBarEdit();
  const lists = hub.topLists();
  const pins = pinsOf(hub);
  const newProject = () => openSheet((close) => <NewProjectSheet onClose={close} />);

  const archived = hub.store.all('list').filter((l) => l.archived);
  const onMove = (next: string[], id: string) => hub.moveList(id, next[next.indexOf(id) + 1] ?? null);

  const arrangeRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [tray, setTray] = useState<HTMLDivElement | null>(null);
  useFloatHeight(tray);
  const start = () => {
    setArranging(true);
    requestAnimationFrame(() => doneRef.current?.focus({ preventScroll: true }));
  };
  const stop = () => {
    setArranging(false);
    requestAnimationFrame(() => arrangeRef.current?.focus({ preventScroll: true }));
  };
  // Leaving the page leaves the mode.
  useEffect(() => () => setArranging(false), []);
  useEscape(arranging, stop);

  const toBar = useBarDrop(arranging);

  // Out of the bar, waiting in the tray: Search, and the folders inside folders (the top ones are on the page).
  const missing = arranging ? pinOptions(hub).filter((o) => !pins.includes(o.key) && (!listIdOf(o.key) || !!hub.parentOf(listIdOf(o.key)!))) : [];

  return (
    <>
      <Band
        top={<SyncBadge />}
        actions={arranging ? <DoneButton ref={doneRef} onClick={stop} /> : undefined}
        title="Folders"
        sub={arranging ? 'Drag folders into the bar, or tabs out of it.' : undefined}
      />
      <div className={`column${arranging ? ' is-arranging' : ''}`}>
        <Sortable
          ids={lists.map((l) => l.id)}
          onMove={onMove}
          layout="grid"
          lean={folderLean}
          label={(id) => hub.list(id)?.name ?? ''}
          outside={toBar.folders}
          renderOverlay={(id, { outside }) => {
            const l = hub.list(id);
            const t = outside ? tabOf(hub, listKey(id)) : undefined;
            return t ? <TabChip t={t} /> : l ? <ProjectCard list={l} /> : null;
          }}
        >
          <div className="projgrid">
            {lists.map((l, i) => (
              <SortableProject key={l.id} list={l} arranging={arranging} pins={pins} index={i} />
            ))}
            {arranging ? null : (
              <button type="button" className="projcard projcard--new" onClick={newProject}>
                <span className="projcard__plus">
                  <Icon name={G.add} />
                </span>
                <span>New folder</span>
              </button>
            )}
          </div>
        </Sortable>

        {arranging ? null : <CollectedNotes />}

        {arranging ? null : (
          <p className="editlink editlink--phone">
            <TextButton iconAfter={G.edit} ref={arrangeRef} onClick={start}>
              Arrange the bar
            </TextButton>
          </p>
        )}


        {archived.length ? (
          <Disclosure title="Archived" count={archived.length}>
            <ul className="rows">
              {archived.map((l) => (
                <li key={l.id} className="row">
                  <ListBullet list={l} size="md" />
                  <div className="row__body">
                    <span className="row__title" dir="auto">
                      {l.name}
                    </span>
                  </div>
                  <button type="button" className="mini" onClick={() => hub.updateList(l.id, { archived: false })}>
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </div>
      {missing.length ? (
        <div className="bartray" ref={setTray}>
          <Sortable
            still
            layout="grid"
            ids={missing.map((t) => t.key)}
            onMove={() => undefined}
            label={(key) => tabOf(hub, key)?.label ?? ''}
            liftClass="lift--token"
            outside={toBar.tokens}
            renderOverlay={(key, { outside }) => {
              const t = tabOf(hub, key);
              return t ? <BarTokenLifted t={t} outside={outside} /> : null;
            }}
          >
            {missing.map((t) => (
              <BarToken key={t.key} t={t} full={pins.length >= MAX_PINS} onAdd={() => togglePin(hub, t.key)} />
            ))}
          </Sortable>
        </div>
      ) : null}
    </>
  );
}

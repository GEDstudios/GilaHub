import { GrowField } from '../ui/AutoTitle';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Hub } from '../../core/actions';
import { suggestIcon } from '../../core/projectIcons';
import type { List, Visibility } from '../../core/model';
import { useAddAction } from '../addAction';
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
import { Band, Disclosure, lineVars, ListBullet, NewButton } from '../ui/primitives';
import { SyncBadge } from '../components/SyncBadge';
import { Glyph, showsGlyph } from '../ui/ProjectMark';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { listVisLabel } from '../privacy';
import { coveredByTab, MAX_PINS, pinAt, pinOptions, pinsOf, setPins, togglePin } from '../tabs';
import { projectCount } from '../views';
import { CollectedNotes } from '../components/Notes';

/** A name on a card of its color, then the same chips as a project's page. */
export function NewProjectSheet({ onClose, initial, parentId }: { onClose: () => void; initial?: Partial<{ visibility: Visibility }>; parentId?: string }) {
  const hub = useHub();
  const parent = hub.list(parentId);
  const [name, setName] = useState('');
  const [look, setLook] = useState<ProjectLook>(() => ({
    color: hub.freshColor(),
    // Unset until picked: the name suggests one as it's typed.
    icon: undefined,
    visibility: initial?.visibility ?? 'shared',
    pinned: false,
  }));
  const [picking, setPicking] = useState(false);
  // Inside Shopping, it's a shopping list: its icon leans that way.
  const shop = hub.isShop(parent);
  const icon = look.icon ?? suggestIcon(name, shop ? 'shopping' : 'tasks', undefined, hub.lists().at(-1)?.icon, hub.iconsInUse());

  const create = () => {
    if (!name.trim()) return;
    const id = hub.createList({ name, color: look.color, icon, visibility: look.visibility, owner: look.owner, parentId: parent?.id });
    if (look.pinned) togglePin(hub, `l:${id}`);
    onClose();
    navigate({ name: 'list', id });
  };

  return (
    // No title: the card says it, its placeholder asking for the name.
    <Sheet onClose={onClose} label={parent ? `New project in ${parent.name}` : 'New project'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        {/* A folder from the start: the same tab on top as on Projects. */}
        <div className="ccard ccard--lg ccard--edit ccard--folder" style={lineVars(look.color)}>
          <span className="ccard__top">
            <GrowField className="ccard__input" placeholder={parent ? `Name a project in ${parent.name}` : 'Name your new project'} value={name} onChange={setName} label="Project name" />
          </span>
          <span className="ccard__sub projcard__foot">
            <span>
              {shop ? 'Shopping list' : parent ? `In ${parent.name}` : 'Project'} · {listVisLabel(hub, { visibility: look.visibility, owner: look.owner ?? (look.visibility === 'shared' ? null : hub.meId) })}
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


        <ProjectFields value={{ ...look, icon }} onChange={(p) => setLook((l) => ({ ...l, ...p }))} canVis noIcon />

        <button type="submit" className="btn btn--block" style={{ marginTop: 26 }} disabled={!name.trim()}>
          Create project
        </button>
      </form>
    </Sheet>
  );
}

/** A small, stable tilt per project, so the cards sit like real folders. */
export function tilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return [-2.2, -1.4, -0.6, 0.8, 1.5, 2.3][Math.abs(h) % 6];
}

/** The live bottom bar (hidden on a computer, where nothing can be dropped on it). */
const liveBar = () => document.querySelector('.tabbar:not(.tabbar--preview)');
const tabOf = (hub: Hub, key: string) => pinOptions(hub).find((o) => o.key === key);

/**
 * Arranging the bar, a folder tap is its pin: in goes just before Projects, out comes out. A
 * project the Shopping or Chores tab already shows flashes that tab instead; a full bar shakes.
 */
function tapPin(hub: Hub, list: List) {
  const pins = pinsOf(hub);
  const key = `l:${list.id}`;
  if (coveredByTab(hub, list.id, pins)) return replay(liveBar()?.querySelector('[data-key="shop"]'), 'is-flash');
  if (!pins.includes(key) && pins.length >= MAX_PINS) {
    haptic('warn');
    return replay(liveBar(), 'is-refusing');
  }
  haptic('tick');
  togglePin(hub, key);
}

/** A folder's pin while arranging: a white + when it's not in the bar, an ink pin when it is. */
function ProjPin({ list, pins, index }: { list: List; pins: string[]; index: number }) {
  const hub = useHub();
  const covered = coveredByTab(hub, list.id, pins) ? tabOf(hub, 'shop') : undefined;
  const on = !!covered || pins.includes(`l:${list.id}`);
  const label = covered ? `In the bar as ${covered.label}` : on ? `${list.name} is in the bar` : `Put ${list.name} in the bar`;
  return (
    <button
      type="button"
      className={`projpin${on ? ' is-in' : ''}`}
      style={{ '--i': index } as CSSProperties}
      aria-pressed={covered ? undefined : on}
      aria-disabled={covered || (!on && pins.length >= MAX_PINS) ? true : undefined}
      aria-label={label}
      title={label}
      onClick={() => tapPin(hub, list)}
    >
      {on ? (
        <span className="projpin__in">
          <Icon name="pin" />
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
    >
      {/* The name gets the card's whole width; the glyph sits low, by the count. */}
      <span className="ccard__top">
        <span className="ccard__title projcard__name" dir="auto">
          {list.name}
        </span>
      </span>
      <span className="ccard__sub projcard__foot">
        <span>
          {list.visibility === 'private' ? <Icon name="lock" className="ccard__lock" /> : null}
          {count.text}
          {list.visibility !== 'shared' ? ` · ${listVisLabel(hub, list)}` : ''}
        </span>
        {showsGlyph(list.icon) ? <Glyph icon={list.icon} className="ccard__glyph" /> : null}
      </span>
    </button>
  );
}

/** "+ New project" for the header, N and the sidebar; not while the bar is being arranged. */
function NewProjectAction({ run }: { run: () => void }) {
  useAddAction(run, 'New project');
  return null;
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
  const { openSheet, toast } = useOverlays();
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
  // Esc leaves it too (not mid-drag, where Esc cancels the drag, nor under a sheet).
  useEffect(() => {
    if (!arranging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.documentElement.classList.contains('is-dragging')) return;
      if (document.querySelector('.sheet')) return;
      stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [arranging]);

  // Dropped on the bar: pinned where it landed. Outside the mode a newcomer says so, with Undo.
  const arrangingRef = useRef(arranging);
  arrangingRef.current = arranging;
  const toBar = useMemo(() => {
    const place = (key: string, at: number | null, full: boolean) => {
      if (full) return toast('The bar is full');
      const before = pinsOf(hub);
      // The one Chores (or Shopping) project is already there as its tab: move that instead.
      const id = key.startsWith('l:') ? key.slice(2) : null;
      const list = id ? hub.list(id) : undefined;
      if (list && coveredByTab(hub, list.id, before)) key = 'shop';
      const was = before.includes(key);
      pinAt(hub, key, at ?? before.length);
      const name = tabOf(hub, key)?.label;
      if (!was && name && !arrangingRef.current) toast(`${name} is in the bar`, { action: { label: 'Undo', run: () => setPins(hub, before) } });
    };
    const common = { nav: liveBar, tabOf: (key: string) => tabOf(hub, key), pinned: () => pinsOf(hub), get: getAim, set: setAim, place };
    return { folders: barTarget({ ...common, keyOf: (id) => `l:${id}` }), tokens: barTarget(common) };
  }, [hub, toast]);

  // Never twice: a tab whose one project is already in the bar isn't offered again.
  const root = hub.shopRoot();
  const missing = arranging
    ? pinOptions(hub).filter((o) => !o.key.startsWith('l:') && !pins.includes(o.key) && !(o.key === 'shop' && root && pins.includes(`l:${root.id}`)))
    : [];

  return (
    <>
      {arranging ? null : <NewProjectAction run={newProject} />}
      <Band
        top={<SyncBadge />}
        actions={arranging ? <DoneButton ref={doneRef} onClick={stop} /> : <NewButton label="New project" onClick={newProject} />}
        title="Projects"
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
            const t = outside ? tabOf(hub, `l:${id}`) : undefined;
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
                  <Icon name="plus" />
                </span>
                <span>New project</span>
              </button>
            )}
          </div>
        </Sortable>

        {arranging ? null : <CollectedNotes />}

        {arranging ? null : (
          <p className="editlink editlink--phone">
            <button ref={arrangeRef} type="button" className="textbtn" onClick={start}>
              Arrange the bar
              <Icon name="layout" className="icon--xs" />
            </button>
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

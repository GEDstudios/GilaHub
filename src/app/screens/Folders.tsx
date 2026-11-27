import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { setArranging, useBarEdit } from '../barEdit';
import { BarToken, BarTokenLifted, TabChip } from '../components/BarEdit';
import { useHub } from '../context';
import { DoneButton } from '../ui/edit';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Band, Disclosure, ListBullet, TextButton } from '../ui/primitives';
import { SyncBadge } from '../components/SyncBadge';
import { Sortable } from '../ui/Sortable';
import { MAX_PINS, pinOptions, pinsOf, togglePin } from '../tabs';
import { CollectedNotes } from '../components/Notes';
import { listKey, listIdOf } from '../../core/keys';
import { G } from '../ui/glyphs';
import { useEscape } from '../ui/keyboard';
import { NewFolderSheet } from '../components/NewFolderSheet';
import { FolderCard, SortableFolder, barTabOf, folderLean, useBarDrop } from '../components/FolderCard';

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
 * Folders: folders you open, drag to reorder, or drag down onto the bottom bar to pin
 * there. "Arrange the bar" (phone) makes the bar itself editable: folders get pins, the real
 * bar takes × and drags, and Shopping, Chores and Search float above it while they're out.
 */
export function Folders() {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const { arranging } = useBarEdit();
  const lists = hub.topLists();
  const pins = pinsOf(hub);
  const newProject = () => openSheet((close) => <NewFolderSheet onClose={close} />);

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
            const t = outside ? barTabOf(hub, listKey(id)) : undefined;
            return t ? <TabChip t={t} /> : l ? <FolderCard list={l} /> : null;
          }}
        >
          <div className="foldergrid">
            {lists.map((l, i) => (
              <SortableFolder key={l.id} list={l} arranging={arranging} pins={pins} index={i} />
            ))}
            {arranging ? null : (
              <button type="button" className="foldercard foldercard--new" onClick={newProject}>
                <span className="foldercard__plus">
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
            label={(key) => barTabOf(hub, key)?.label ?? ''}
            liftClass="lift--token"
            outside={toBar.tokens}
            renderOverlay={(key, { outside }) => {
              const t = barTabOf(hub, key);
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

import { useState, type CSSProperties, type ReactNode } from 'react';
import { today as todayStr } from '../../core/dates';
import { useHub } from '../context';
import { hiddenWidgets, hideHome, homePreview, isDefaultHome, isWidget, MAX_HOME_PROJECTS, pinnedProjects, reorderHome, resetHome, showHome, slotTitle, visibleHome, WIDGETS } from '../home';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { FolderTree } from './FolderTree';
import { SavedListSheet } from './SavedList';
import { ProjectMark } from '../ui/ProjectMark';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { todayView } from '../views';
import { listKey, listIdOf } from '../../core/keys';

/**
 * Edit Today, on Today itself: every block shows as itself (a short, still peek of what it
 * holds) on a white card you can pick up and move, with an × to hide it. Hidden blocks wait
 * as hatched cards at the end; tap one to bring it back. Up to 3 projects can join. Each
 * change saves at once; Done leaves.
 */
export function TodayArrange({ peek }: { peek: (key: string) => ReactNode }) {
  const hub = useHub();
  const { toast, openSheet } = useOverlays();
  const [picking, setPicking] = useState(false);
  const ref = todayStr();
  const v = todayView(hub, ref);
  const keys = visibleHome(hub).map((s) => s.key);
  const hidden = hiddenWidgets(hub);
  const pins = pinnedProjects(hub);
  const free = hub.lists().filter((l) => !pins.includes(l.id));
  const full = pins.length >= MAX_HOME_PROJECTS;

  const reset = () => {
    const undo = resetHome(hub);
    setPicking(false);
    toast('Today is back to the default', { action: { label: 'Undo', run: undo } });
  };

  return (
    <div className="homecards">
      <Sortable
        ids={keys}
        grips
        onMove={(next) => reorderHome(hub, next)}
        label={(k) => slotTitle(hub, k)}
        renderOverlay={(k) => <CardFace k={k} peek={peek(k)} sub={homePreview(k, hub, v).text} />}
      >
        {keys.map((k) => (
          <HomeCard key={k} k={k} peek={peek(k)} sub={homePreview(k, hub, v).text} onHide={() => hideHome(hub, k)} />
        ))}
      </Sortable>

      {hidden.map((k) => (
        <button key={k} type="button" className="homeghost hatch" onClick={() => (haptic('tick'), showHome(hub, k))} aria-label={`Show ${WIDGETS[k].title(hub)}`}>
          <span className="homeghost__add">
            <Icon name="plus" className="icon--sm" />
          </span>
          <span className="homeghost__text">
            <span className="homeghost__title">{WIDGETS[k].title(hub)}</span>
            <span className="homeghost__sub">{homePreview(k, hub, v).text}</span>
          </span>
        </button>
      ))}

      {free.length ? (
        <div className={`homeghost hatch homeghost--pick ${picking ? 'is-open' : ''}`}>
          <button
            type="button"
            className="homeghost__row"
            disabled={full}
            aria-expanded={picking}
            onClick={() => setPicking(!picking)}
            title={full ? `Up to ${MAX_HOME_PROJECTS} folders` : undefined}
          >
            <span className="homeghost__add">
              <Icon name="folder" className="icon--sm" />
            </span>
            <span className="homeghost__text">
              <span className="homeghost__title">Pin a folder</span>
              <span className="homeghost__sub">{full ? `Up to ${MAX_HOME_PROJECTS}` : 'Its open things, right here'}</span>
            </span>
          </button>
          {picking && !full ? (
            // The usual folder tree, folded: open a folder to reach the ones inside.
            <div className="homeghost__tree">
              <FolderTree
                marked={(l) => pins.includes(l.id)}
                hint={(l) => (pins.includes(l.id) ? 'on Today' : null)}
                onPick={(id) => {
                  setPicking(false);
                  showHome(hub, listKey(id));
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* A list of my own: by tag, folder, due, urgent, whose */}
      <button type="button" className="homeghost hatch" onClick={() => openSheet((close) => <SavedListSheet onClose={close} />)}>
        <span className="homeghost__add">
          <Icon name="funnel" className="icon--sm" />
        </span>
        <span className="homeghost__text">
          <span className="homeghost__title">Add a filtered list</span>
          <span className="homeghost__sub">A tag, a folder, what’s due next week…</span>
        </span>
      </button>

      {isDefaultHome(hub) ? null : (
        <div className="homereset">
          <button type="button" className="textbtn" onClick={reset}>
            Back to the default
          </button>
        </div>
      )}
    </div>
  );
}

function HomeCard({ k, peek, sub, onHide }: { k: string; peek: ReactNode; sub: string; onHide: () => void }) {
  const hub = useHub();
  const s = useSortableItem(k);
  const title = slotTitle(hub, k);
  return (
    <section ref={s.ref} style={s.style as CSSProperties} className={`homecard ${s.className}`} {...s.props} data-grip="card">
      <CardHead k={k} title={title}>
        <button type="button" className="homecard__x" aria-label={`Hide ${title}`} onClick={onHide}>
          <Icon name="x" className="icon--sm" />
        </button>
        <button type="button" data-grip ref={s.gripRef} {...s.gripProps} className="homecard__grip" aria-label={`Move ${title}`}>
          <Icon name="grip" />
        </button>
      </CardHead>
      <Peek peek={peek} sub={sub} />
    </section>
  );
}

/** The lifted copy. */
function CardFace({ k, peek, sub }: { k: string; peek: ReactNode; sub: string }) {
  const hub = useHub();
  return (
    <section className="homecard is-lifted">
      <CardHead k={k} title={slotTitle(hub, k)}>
        <span className="homecard__grip">
          <Icon name="grip" />
        </span>
      </CardHead>
      <Peek peek={peek} sub={sub} />
    </section>
  );
}

function CardHead({ k, title, children }: { k: string; title: string; children: ReactNode }) {
  const hub = useHub();
  const list = hub.list(listIdOf(k));
  return (
    <header className="homecard__head">
      <span className="homecard__mark">
        {list ? <ProjectMark color={list.color} icon={list.icon} size="sm" /> : isWidget(k) ? <Icon name={WIDGETS[k].icon} /> : k.startsWith('q:') ? <Icon name="funnel" /> : null}
      </span>
      <span className="homecard__title" dir="auto">
        {title}
      </span>
      {children}
    </header>
  );
}

/** A still, short look at the block itself; when it has nothing now, what it would show. */
function Peek({ peek, sub }: { peek: ReactNode; sub: string }) {
  return (
    <div className="homecard__peek" inert>
      {peek ?? null}
      <p className="homecard__sub">{sub}</p>
    </div>
  );
}

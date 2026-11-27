import { Fragment } from 'react';
import type { Hub } from '../../core/hub';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { G } from '../ui/glyphs';

/** One step of the way here: its name, and where tapping it goes. */
interface Crumb {
  key: string;
  label: string;
  go: () => void;
  /** A folder: a dragged task can be dropped on it. */
  drop?: string;
  /** A task: a dragged subtask can be dropped on it (it goes under that task instead). */
  dropItem?: string;
  /** The top (Folders): a dragged folder can be dropped on it, out to the top level. */
  root?: boolean;
}

/**
 * Where you are: every step from the top down to here (Folders › Home › Kitchen › Fix the tap),
 * each one a way back up, then the path's own actions: move it, and (a task) where else it is.
 */
export function PathCrumbs({
  steps,
  onMove,
  moveLabel,
  also,
}: {
  steps: Crumb[];
  /** A small move button at the end of the path. */
  onMove?: () => void;
  moveLabel?: string;
  /** "Also in…" beside it (a task): where else it is, or putting it somewhere else too. */
  also?: { label: string; on: boolean; onClick: () => void };
}) {
  if (!steps.length) return null;
  return (
    <nav className="crumbs crumbs--path" aria-label="Where you are">
      {steps.map((s, i) => (
        <Fragment key={s.key}>
          {i ? <Icon name={G.go} className="crumbs__sep" /> : null}
          <span className="crumbs__step" data-drop-list={s.drop} data-drop-item={s.dropItem} data-drop-root={s.root ? '' : undefined}>
            <button type="button" className="crumbs__go" onClick={s.go} dir="auto">
              {s.label}
            </button>
          </span>
        </Fragment>
      ))}
      {onMove || also ? (
        // The path's own actions, kept together (they wrap as one).
        <span className="crumbs__acts">
          {onMove ? (
            <button type="button" className="crumbs__moveto" onClick={onMove} aria-label={moveLabel} title={moveLabel}>
              <Icon name={G.move} />
              <span>Move to…</span>
            </button>
          ) : null}
          {also ? (
            <button type="button" className={`crumbs__moveto ${also.on ? 'is-on' : ''}`} onClick={also.onClick}>
              <Icon name={G.linked} />
              <span dir="auto">{also.label}</span>
            </button>
          ) : null}
        </span>
      ) : null}
    </nav>
  );
}

/** A folder's way here from the top: Folders, then each folder it sits in. */
export function folderPath(hub: Hub, id: string): Crumb[] {
  return [
    { key: 'projects', label: 'Folders', go: () => navigate({ name: 'lists' }), root: true },
    ...hub.listPath(id).map((l) => ({ key: l.id, label: l.name, go: () => navigate({ name: 'list', id: l.id }), drop: l.id })),
  ];
}

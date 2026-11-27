import { Fragment } from 'react';
import type { Hub } from '../../core/actions';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { G } from '../ui/glyphs';

/** One step of the way here: its name, where tapping it goes, and (on a task I can change) moving it there. */
export interface Crumb {
  key: string;
  label: string;
  go: () => void;
  /** Move what's on this page into this step instead (asked first). */
  move?: () => void;
  /** A project: a dragged task can be dropped on it. */
  drop?: string;
  /** A task: a dragged subtask can be dropped on it (it goes under that task instead). */
  dropItem?: string;
  /** The top (Folders): a dragged folder can be dropped on it, out to the top level. */
  root?: boolean;
}

/**
 * Where you are: every step from the top down to here (Projects › Home › Kitchen › Fix the tap),
 * each one a way back up. On a task, a small ⌄ beside a step moves the task there.
 */
export function PathCrumbs({
  steps,
  onMove,
  moveLabel = 'Move it',
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
            {s.move ? (
              <button type="button" className="crumbs__move" onClick={s.move} aria-label={`Move it into ${s.label}`} title={`Move it into ${s.label}`}>
                <Icon name={G.fold} />
              </button>
            ) : null}
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

/** A project's way here from the top: Projects, then each folder it sits in. */
export function projectPath(hub: Hub, id: string): Crumb[] {
  return [
    { key: 'projects', label: 'Folders', go: () => navigate({ name: 'lists' }), root: true },
    ...hub.listPath(id).map((l) => ({ key: l.id, label: l.name, go: () => navigate({ name: 'list', id: l.id }), drop: l.id })),
  ];
}

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
 * each one a way back up. A task that lives in two places says the other one at the end.
 */
export function PathCrumbs({ steps, also }: { steps: Crumb[]; also?: { label: string; onClick: () => void } }) {
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
      {also ? (
        <button type="button" className="crumbs__also" onClick={also.onClick}>
          <Icon name={G.linked} />
          <span dir="auto">{also.label}</span>
        </button>
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

import { Fragment } from 'react';
import type { Hub } from '../../core/actions';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';

/** One step of the way here: its name, where tapping it goes, and (on a task I can change) moving it there. */
export interface Crumb {
  key: string;
  label: string;
  go: () => void;
  /** Move what's on this page into this step instead (asked first). */
  move?: () => void;
}

/**
 * Where you are: every step from the top down to here (Projects › Home › Kitchen › Fix the tap),
 * each one a way back up. On a task, a small ⌄ beside a step moves the task there.
 */
export function PathCrumbs({ steps }: { steps: Crumb[] }) {
  if (!steps.length) return null;
  return (
    <nav className="crumbs crumbs--path" aria-label="Where you are">
      {steps.map((s, i) => (
        <Fragment key={s.key}>
          {i ? <Icon name="chevron-right" className="crumbs__sep" /> : null}
          <span className="crumbs__step">
            <button type="button" className="crumbs__go" onClick={s.go} dir="auto">
              {s.label}
            </button>
            {s.move ? (
              <button type="button" className="crumbs__move" onClick={s.move} aria-label={`Move it into ${s.label}`} title={`Move it into ${s.label}`}>
                <Icon name="chevron-down" />
              </button>
            ) : null}
          </span>
        </Fragment>
      ))}
    </nav>
  );
}

/** A project's way here from the top: Projects, then each folder it sits in. */
export function projectPath(hub: Hub, id: string): Crumb[] {
  return [
    { key: 'projects', label: 'Projects', go: () => navigate({ name: 'lists' }) },
    ...hub.listPath(id).map((l) => ({ key: l.id, label: l.name, go: () => navigate({ name: 'list', id: l.id }) })),
  ];
}

import { useState } from 'react';
import { today as todayStr } from '../../core/dates';
import { useHub } from '../context';
import {
  DEFAULT_HOME,
  hiddenWidgets,
  hideHome,
  homeOf,
  homePreview,
  isDefaultHome,
  isWidget,
  listIdOf,
  MAX_HOME_PROJECTS,
  pinnedProjects,
  projectKey,
  reorderHome,
  setHome,
  showHome,
  slotTitle,
  summaryOf,
  things,
  visibleHome,
  WIDGETS,
} from '../home';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { ListBullet } from '../ui/primitives';
import { ProjectMark } from '../ui/ProjectMark';
import { choresView, todayView } from '../views';
import { Arranger, type ArrangerRow, type ArrangerToken } from './Arranger';

/**
 * Edit Today: the summary stays first; every other block can move, hide, or come back,
 * and up to 3 projects can join. Each change saves at once (no Cancel). Used inline on
 * Today ("Edit Today") and in Settings.
 */
export function HomeEditor() {
  const hub = useHub();
  const { toast } = useOverlays();
  const [panel, setPanel] = useState(false);
  const ref = todayStr();
  const v = todayView(hub, ref);
  const chores = choresView(hub, ref);
  const sum = summaryOf(hub, v);
  const pins = pinnedProjects(hub);
  const full = pins.length >= MAX_HOME_PROJECTS;
  const free = hub.lists().filter((l) => !pins.includes(l.id));

  const rows: ArrangerRow[] = visibleHome(hub).map(({ key }) => {
    const list = hub.list(listIdOf(key));
    return {
      key,
      title: slotTitle(hub, key),
      mark: list ? <ProjectMark color={list.color} icon={list.icon} size="sm" /> : isWidget(key) ? <Icon name={WIDGETS[key].icon} /> : null,
      sub: homePreview(key, hub, v, chores).text,
    };
  });

  const tokens: ArrangerToken[] = hiddenWidgets(hub).map((k) => ({ key: k, label: WIDGETS[k].title(hub), onClick: () => showHome(hub, k) }));
  if (free.length) {
    tokens.push({
      key: 'project',
      label: 'A project',
      toggle: true,
      open: panel && !full,
      disabled: full,
      title: full ? `Up to ${MAX_HOME_PROJECTS} projects` : undefined,
      onClick: () => setPanel(!panel),
    });
  }

  const reset = () => {
    const before = homeOf(hub);
    setHome(hub, DEFAULT_HOME);
    setPanel(false);
    toast('Today is back to the default', { action: { label: 'Undo', run: () => setHome(hub, before) } });
  };

  return (
    <Arranger
      top={[
        {
          key: 'summary',
          mark: <Icon name="pin" />,
          title: 'Summary',
          sub: `Always first · ${sum.n ? `${things(sum.n)} today` : sum.mood === 'done' ? 'all done' : 'nothing due'}`,
        },
      ]}
      rows={rows}
      onMove={(keys) => reorderHome(hub, keys)}
      onHide={(key) => hideHome(hub, key)}
      trayTitle="Add to Today"
      tokens={tokens}
      panel={
        panel && !full ? (
          <div className="panel--inline">
            <div className="tokens">
              {free.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="token"
                  onClick={() => {
                    haptic('tick');
                    setPanel(false);
                    showHome(hub, projectKey(l.id));
                  }}
                >
                  <ListBullet list={l} size="xs" />
                  <span dir="auto">{l.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null
      }
      reset={isDefaultHome(hub) ? undefined : { label: 'Back to the default', run: reset }}
    />
  );
}

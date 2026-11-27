import { GrowField } from '../ui/AutoTitle';
import { useState } from 'react';
import { suggestIcon } from '../../core/projectIcons';
import { ProjectFields, type ProjectLook } from './ProjectFields';
import { CardIcon, IconPicker } from './IconPicker';
import { useHub } from '../context';
import { navigate } from '../router';
import { Sheet } from '../ui/overlays';
import { lineVars, Button } from '../ui/primitives';
import { useBackGuard } from '../ui/backGuard';
import { listVisLabel } from '../privacy';
import { togglePin } from '../tabs';
import { listKey } from '../../core/keys';

/** New folder: its name on a card of its colour (the icon picked right on it), then its chips. */
export function NewFolderSheet({
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

import { useState } from 'react';
import type { LineColor, ListKind, ShoppingFlavor, Visibility } from '../../core/model';
import { useHub } from '../context';
import { LIST_VIS, visHint, visLabel, VIS_ICON } from '../privacy';
import { haptic } from '../ui/haptics';
import { Icon, type IconName } from '../ui/Icon';
import { parseGlyph, showsGlyph } from '../ui/ProjectMark';
import { lineVars } from '../ui/primitives';
import { EChip, Options, Panel } from './editors';
import { IconPicker } from './IconPicker';
import { Swatches } from './pickers';

/** Who sees a project: Ours, Mine or Only me, with one line on what that means. */
export function ListVisOptions({ value, onPick }: { value: Visibility; onPick: (v: Visibility) => void }) {
  const hub = useHub();
  const partner = hub.partner();
  return (
    <>
      <Options
        value={value}
        onPick={onPick}
        options={(['shared', 'visible', 'private'] as const).map((v) => ({ value: v, label: visLabel(LIST_VIS[v]), icon: VIS_ICON[LIST_VIS[v]] }))}
      />
      <p className="panel__hint">{visHint(LIST_VIS[value], partner?.name ?? null)}</p>
    </>
  );
}

/** How a project looks and where it shows: the same chips on its page and in New project. */
export interface ProjectLook {
  color: LineColor;
  icon?: string;
  visibility: Visibility;
  pinned: boolean;
  kind?: ListKind;
  flavor?: ShoppingFlavor;
}

const KIND: Record<ListKind, { label: string; icon: IconName }> = {
  tasks: { label: 'Tasks', icon: 'lines' },
  shopping: { label: 'Shopping', icon: 'basket' },
  chores: { label: 'Chores', icon: 'broom' },
};

type Field = 'kind' | 'color' | 'icon' | 'vis';

/**
 * "Want to modify something?" and a row of chips: (Kind,) Color, Icon, who sees it, In bar.
 * Each opens its panel right below the row; nothing stacks.
 */
export function ProjectFields({
  value,
  onChange,
  canVis,
  withKind,
}: {
  value: ProjectLook;
  onChange: (patch: Partial<ProjectLook>) => void;
  /** Only the owner (or anyone, for Ours) changes who sees it. */
  canVis: boolean;
  /** New project: what kind it is, too. */
  withKind?: boolean;
}) {
  const [open, setOpen] = useState<Field | null>(null);
  const toggle = (k: Field) => setOpen(open === k ? null : k);
  const vis = LIST_VIS[value.visibility];
  const glyph = parseGlyph(value.icon);
  const kind = value.kind ?? 'tasks';
  return (
    <div className="inline projfields">
      <p className="inline__prompt">Want to modify something?</p>
      <div className="inline__chips">
        {withKind ? (
          <>
            <EChip label={KIND[kind].label} icon={KIND[kind].icon} set open={open === 'kind'} onToggle={() => toggle('kind')} />
            {open === 'kind' ? (
              <Panel>
                <Options
                  value={kind}
                  onPick={(k) => onChange({ kind: k })}
                  options={(['tasks', 'shopping', 'chores'] as const).map((k) => ({ value: k, label: KIND[k].label, icon: KIND[k].icon }))}
                />
                {kind === 'shopping' ? (
                  <div className="panel__row">
                    <Options
                      value={value.flavor ?? 'grocery'}
                      onPick={(f) => onChange({ flavor: f })}
                      options={[
                        { value: 'grocery', label: 'By aisle' },
                        { value: 'home', label: 'By department' },
                      ]}
                    />
                  </div>
                ) : null}
              </Panel>
            ) : null}
          </>
        ) : null}
        <EChip label="Color" lead={<span className="echip__dot" style={lineVars(value.color)} />} set open={open === 'color'} onToggle={() => toggle('color')} />
        {open === 'color' ? (
          <Panel>
            <Swatches value={value.color} onChange={(color) => onChange({ color })} big />
          </Panel>
        ) : null}
        <EChip
          label="Icon"
          icon={glyph?.kind === 'icon' ? glyph.name : 'folder'}
          lead={glyph?.kind === 'emoji' ? <span aria-hidden="true">{glyph.text}</span> : undefined}
          set={showsGlyph(value.icon)}
          open={open === 'icon'}
          onToggle={() => toggle('icon')}
        />
        {open === 'icon' ? (
          <Panel>
            <IconPicker value={value.icon} color={value.color} onChange={(icon) => onChange({ icon })} />
          </Panel>
        ) : null}
        {canVis ? (
          <>
            <EChip label={visLabel(vis)} icon={VIS_ICON[vis]} set={value.visibility !== 'shared'} open={open === 'vis'} onToggle={() => toggle('vis')} />
            {open === 'vis' ? (
              <Panel>
                <ListVisOptions value={value.visibility} onPick={(visibility) => onChange({ visibility })} />
              </Panel>
            ) : null}
          </>
        ) : null}
        {/* Off: a dashed "Add to bar". On: a solid "In the bar" with a check, so it reads at a glance. */}
        <button
          type="button"
          className={`echip echip--toggle ${value.pinned ? 'is-on' : 'echip--ghost'}`}
          aria-pressed={value.pinned}
          onClick={() => {
            haptic(value.pinned ? 'select' : 'tick');
            onChange({ pinned: !value.pinned });
          }}
        >
          <Icon name={value.pinned ? 'check' : 'plus'} className="icon--sm" />
          <span>{value.pinned ? 'In the bar' : 'Add to bar'}</span>
        </button>
      </div>
    </div>
  );
}

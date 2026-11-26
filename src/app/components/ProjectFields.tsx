import { useState } from 'react';
import type { LineColor, ListKind, ShoppingFlavor, Visibility } from '../../core/model';
import { useHub } from '../context';
import { listDefaultVis, visHint, visLabel, VIS_ICON, type VisChoice } from '../privacy';
import { haptic } from '../ui/haptics';
import { Icon, type IconName } from '../ui/Icon';
import { parseGlyph, showsGlyph } from '../ui/ProjectMark';
import { lineVars } from '../ui/primitives';
import { EChip, Options, Panel } from './editors';
import { IconPicker } from './IconPicker';
import { Swatches } from './pickers';

/** What a choice means for a project: who sees it, and whose it is. */
export function listVisOf(hub: ReturnType<typeof useHub>, v: VisChoice): { visibility: Visibility; owner: string | null } {
  if (v === 'ours') return { visibility: 'shared', owner: null };
  if (v === 'theirs') return { visibility: 'visible', owner: hub.partner()?.id ?? hub.meId };
  return { visibility: v === 'private' ? 'private' : 'visible', owner: hub.meId };
}

/**
 * Who sees a project and whose it is: Ours, Mine, my person's, or Only me, with one line on
 * what that means. Giving it to my person keeps it in sight for both; only hiding needs it mine.
 */
export function ListVisOptions({ value, owner, onPick }: { value: Visibility; owner?: string | null; onPick: (v: { visibility: Visibility; owner: string | null }) => void }) {
  const hub = useHub();
  const partner = hub.partner();
  const now = listDefaultVis(hub, { visibility: value, owner: owner ?? null });
  const choices: VisChoice[] = ['ours', 'mine', ...(partner ? (['theirs'] as const) : []), ...(now === 'theirs' ? [] : (['private'] as const))];
  return (
    <>
      <Options
        value={now}
        onPick={(v) => onPick(listVisOf(hub, v))}
        options={choices.map((v) => ({ value: v, label: visLabel(v, partner?.name), icon: VIS_ICON[v] }))}
      />
      <p className="panel__hint">{now === 'theirs' && partner ? `${partner.name}’s project. You both see it and can help.` : visHint(now, partner?.name ?? null)}</p>
    </>
  );
}

/** How a project looks and where it shows: the same chips on its page and in New project. */
export interface ProjectLook {
  color: LineColor;
  icon?: string;
  visibility: Visibility;
  /** Whose it is, when it's someone's (Mine, or my person's). */
  owner?: string | null;
  pinned: boolean;
  kind?: ListKind;
  flavor?: ShoppingFlavor;
}

const KIND: Record<ListKind, { label: string; icon: IconName }> = {
  tasks: { label: 'Tasks', icon: 'lines' },
  shopping: { label: 'Shopping', icon: 'basket' },
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
  noIcon,
}: {
  value: ProjectLook;
  onChange: (patch: Partial<ProjectLook>) => void;
  /** Only the owner (or anyone, for Ours) changes who sees it. */
  canVis: boolean;
  /** New project: what kind it is, too. */
  withKind?: boolean;
  /** The icon is picked on the card itself (New project): no chip for it. */
  noIcon?: boolean;
}) {
  const [open, setOpen] = useState<Field | null>(null);
  const toggle = (k: Field) => setOpen(open === k ? null : k);
  const hub = useHub();
  const vis = listDefaultVis(hub, { visibility: value.visibility, owner: value.owner ?? (value.visibility === 'shared' ? null : hub.meId) });
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
                  options={(['tasks', 'shopping'] as const).map((k) => ({ value: k, label: KIND[k].label, icon: KIND[k].icon }))}
                />
                {kind === 'shopping' ? (
                  <div className="panel__row">
                    <Options
                      value={value.flavor ?? 'grocery'}
                      onPick={(f) => onChange({ flavor: f })}
                      options={[
                        { value: 'grocery', label: 'Grocery categories' },
                        { value: 'home', label: 'Home categories' },
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
        {noIcon ? null : (
          <>
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
          </>
        )}
        {canVis ? (
          <>
            <EChip label={visLabel(vis, hub.partner()?.name)} icon={VIS_ICON[vis]} set={value.visibility !== 'shared'} open={open === 'vis'} onToggle={() => toggle('vis')} />
            {open === 'vis' ? (
              <Panel>
                <ListVisOptions value={value.visibility} owner={value.owner} onPick={(v) => onChange(v)} />
              </Panel>
            ) : null}
          </>
        ) : null}
        {/* Off: a dashed "Pin to bar". On: "Pinned to bar", filled with my colour, so it reads at a glance. */}
        <button
          type="button"
          className={`echip echip--toggle ${value.pinned ? 'is-on' : 'echip--ghost'}`}
          aria-pressed={value.pinned}
          onClick={() => {
            haptic(value.pinned ? 'select' : 'tick');
            onChange({ pinned: !value.pinned });
          }}
        >
          <Icon name="pin" className="icon--sm" />
          <span>{value.pinned ? 'Pinned to bar' : 'Pin to bar'}</span>
        </button>
      </div>
    </div>
  );
}

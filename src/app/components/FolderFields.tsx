import { useState } from 'react';
import type { LineColor, Visibility } from '../../core/model';
import { useHub } from '../context';
import { listDefaultVis, visHint, visLabel, VIS_ICON, type VisChoice } from '../privacy';
import { haptic } from '../ui/haptics';
import { lineVars } from '../ui/primitives';
import { EChip, Options, Panel } from './chips';
import { Swatches } from './pickers';
import { G } from '../ui/glyphs';
import type { Hub } from '../../core/hub';

/** What a choice means for a folder: who sees it, and whose it is. */
function listVisOf(hub: Hub, v: VisChoice): { visibility: Visibility; owner: string | null } {
  if (v === 'ours') return { visibility: 'shared', owner: null };
  if (v === 'theirs') return { visibility: 'visible', owner: hub.partner()?.id ?? hub.meId };
  return { visibility: v === 'private' ? 'private' : 'visible', owner: hub.meId };
}

/**
 * Who sees a folder and whose it is: Ours, Mine, my person's, or Only me, with one line on
 * what that means. Giving it to my person keeps it in sight for both; only hiding needs it mine.
 */
export function ListVisOptions({ value, owner, onPick }: { value: Visibility; owner?: string | null; onPick: (v: { visibility: Visibility; owner: string | null }) => void }) {
  const hub = useHub();
  const partner = hub.partner();
  const now = listDefaultVis(hub, { visibility: value, owner: owner ?? null });
  // Every choice, whatever it is now: a folder set to Hila's can be made Private (mine, hidden from her).
  const choices: VisChoice[] = ['ours', 'mine', ...(partner ? (['theirs'] as const) : []), 'private'];
  return (
    <>
      <Options
        value={now}
        onPick={(v) => onPick(listVisOf(hub, v))}
        options={choices.map((v) => ({ value: v, label: visLabel(v, partner?.name), icon: VIS_ICON[v] }))}
      />
      <p className="panel__hint">{now === 'theirs' && partner ? `${partner.name}’s folder. You both see it and can help.` : visHint(now, partner?.name ?? null)}</p>
    </>
  );
}

/** How a new folder looks and where it shows. */
export interface FolderLook {
  color: LineColor;
  icon?: string;
  visibility: Visibility;
  /** Whose it is, when it's someone's (Mine, or my person's). */
  owner?: string | null;
  pinned: boolean;
}

type Field = 'color' | 'vis';

/**
 * New folder's chips: Color, who sees it, Pin to the bar (its icon is picked on the card itself).
 * Each opens its panel right below the row; nothing stacks.
 */
export function FolderFields({ value, onChange }: { value: FolderLook; onChange: (patch: Partial<FolderLook>) => void }) {
  const [open, setOpen] = useState<Field | null>(null);
  const toggle = (k: Field) => setOpen(open === k ? null : k);
  const hub = useHub();
  const vis = listDefaultVis(hub, { visibility: value.visibility, owner: value.owner ?? (value.visibility === 'shared' ? null : hub.meId) });
  return (
    <div className="inline folderfields">
      <div className="inline__chips">
        <EChip label="Color" lead={<span className="echip__dot" style={lineVars(value.color)} />} set open={open === 'color'} onToggle={() => toggle('color')} />
        {open === 'color' ? (
          <Panel>
            <Swatches value={value.color} onChange={(color) => onChange({ color })} />
          </Panel>
        ) : null}
        <EChip label={visLabel(vis, hub.partner()?.name)} icon={VIS_ICON[vis]} set={value.visibility !== 'shared'} open={open === 'vis'} onToggle={() => toggle('vis')} />
        {open === 'vis' ? (
          <Panel>
            <ListVisOptions value={value.visibility} owner={value.owner} onPick={(v) => onChange(v)} />
          </Panel>
        ) : null}
        {/* Off: a dashed "Pin to the bar". On: "Pinned", filled with my colour: shorter, so turning it on never pushes the row onto a second line. */}
        <EChip
          label={value.pinned ? 'Pinned' : 'Pin to the bar'}
          icon={G.pinToBar}
          set={false}
          pressed={value.pinned}
          ghost={!value.pinned}
          tone={`echip--toggle${value.pinned ? ' is-on' : ''}`}
          onToggle={() => {
            haptic(value.pinned ? 'select' : 'tick');
            onChange({ pinned: !value.pinned });
          }}
        />
      </div>
    </div>
  );
}

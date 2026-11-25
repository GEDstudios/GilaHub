import type { ReactNode } from 'react';
import { LINE_COLORS, type LineColor, type List } from '../../core/model';
import { categoryMeta, categoryOrder, type Flavor } from '../../smart/categorize';
import { useHub } from '../context';
import { Icon, type IconName } from '../ui/Icon';
import { Sheet } from '../ui/overlays';
import { ListBullet, lineVars } from '../ui/primitives';

/** A quiet row inside a grouped card (settings, lists to pick from). */
export function OptRow({
  icon,
  lead,
  title,
  sub,
  value,
  onClick,
  on,
  disabled,
  trail,
}: {
  icon?: IconName;
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  on?: boolean;
  disabled?: boolean;
  trail?: ReactNode;
}) {
  const body = (
    <>
      {lead ?? (icon ? <Icon name={icon} className="optrow__icon" /> : null)}
      <span className="optrow__text">
        <span dir="auto">{title}</span>
        {sub ? <span className="optrow__sub">{sub}</span> : null}
      </span>
      {value !== undefined ? <span className="optrow__value">{value}</span> : null}
      {on ? <Icon name="check" /> : null}
      {trail}
    </>
  );
  return onClick ? (
    <button type="button" className="optrow optrow--tap" onClick={onClick} disabled={disabled} aria-pressed={on}>
      {body}
    </button>
  ) : (
    <div className="optrow">{body}</div>
  );
}

export function ListPickerSheet({
  onClose,
  onPick,
  current,
  filter,
  title = 'Move to',
}: {
  onClose: () => void;
  onPick: (l: List) => void;
  current?: string;
  filter?: (l: List) => boolean;
  title?: string;
}) {
  const hub = useHub();
  const lists = hub.lists().filter((l) => (filter ? filter(l) : true));
  return (
    <Sheet onClose={onClose} title={title}>
      <div className="group">
        {lists.map((l) => (
          <OptRow
            key={l.id}
            lead={<ListBullet list={l} size="md" />}
            title={l.name}
            sub={l.visibility === 'private' ? 'Only me' : l.visibility === 'visible' ? `${hub.member(l.owner)?.name ?? ''}’s` : undefined}
            on={l.id === current}
            onClick={() => {
              onPick(l);
              onClose();
            }}
          />
        ))}
      </div>
    </Sheet>
  );
}

export function AisleSheet({ onClose, flavor, value, onPick }: { onClose: () => void; flavor: Flavor; value: string; onPick: (c: string) => void }) {
  return (
    <Sheet onClose={onClose} title="Which aisle?">
      <div className="group">
        {categoryOrder(flavor).map((c) => {
          const m = categoryMeta(flavor, c);
          return (
            <OptRow
              key={c}
              title={m.en}
              sub={m.he}
              on={c === value}
              onClick={() => {
                onPick(c);
                onClose();
              }}
            />
          );
        })}
      </div>
    </Sheet>
  );
}

/** Six colors, as round dots. */
export function Swatches({ value, onChange, taken }: { value: LineColor; onChange: (c: LineColor) => void; taken?: LineColor[] }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Color">
      {LINE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          className={`swatch ${c === value ? 'is-on' : ''}`}
          style={lineVars(c)}
          onClick={() => onChange(c)}
          disabled={taken?.includes(c) && c !== value}
        />
      ))}
    </div>
  );
}

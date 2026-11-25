import { useMemo, useRef, useState } from 'react';
import { barTarget, withGap, type Aim } from '../barEdit';
import { useHub } from '../context';
import { coveredByTab, isDefaultPins, MAX_PINS, pinAt, pinOptions, pinsOf, resetPins, setPins, tabsOf } from '../tabs';
import { useOverlays } from '../ui/overlays';
import { Sortable } from '../ui/Sortable';
import { BarEdit, BarToken, BarTokenLifted, useFresh } from './BarEdit';

/**
 * The bottom bar, arranged in Settings (round 7, BAR §3): the bar on its gray stage is the
 * editor (drag a tab to move it, drag it up or tap × to take it out), then a tray of what can
 * go in (tap: just before Projects; drag: where you drop it), then "Back to the default".
 * Every change is saved as it happens and shows on the bar itself, so only the reset toasts.
 */
export function BarEditor() {
  const hub = useHub();
  const { toast } = useOverlays();
  const pins = pinsOf(hub);
  const opts = pinOptions(hub);
  const byKey = new Map(opts.map((o) => [o.key, o]));
  const navRef = useRef<HTMLElement>(null);

  // A token being dragged toward the stage bar opens a gap there.
  const [aim, setAimState] = useState<Aim | null>(null);
  const aimRef = useRef<Aim | null>(null);
  const { tabs, gap } = withGap(tabsOf(hub), aim);

  const tokens = opts.filter((o) => !pins.includes(o.key) && !(o.key.startsWith('l:') && coveredByTab(hub, o.key.slice(2), pins)));
  const freshToken = useFresh(tokens.map((t) => t.key));
  const full = pins.length >= MAX_PINS;

  const stage = useMemo(
    () =>
      barTarget({
        nav: () => navRef.current,
        tabOf: (key) => pinOptions(hub).find((o) => o.key === key),
        pinned: () => pinsOf(hub),
        get: () => aimRef.current,
        set: (a) => {
          aimRef.current = a;
          setAimState(a);
        },
        place: (key, at, isFull) => {
          if (!isFull) pinAt(hub, key, at ?? pinsOf(hub).length);
        },
      }),
    [hub],
  );

  return (
    <div className="bareditor">
      <div className="barstage barstage--edit">
        <BarEdit mode="preview" tabs={tabs} gap={gap} navRef={navRef} onPins={(next) => setPins(hub, next)} />
        <p className="barstage__cap barstage__desk">Your phone’s bar. The sidebar follows it.</p>
      </div>
      <div className="tray">
        <p className="tray__label">Add to the bar</p>
        {tokens.length ? (
          <Sortable
            still
            layout="grid"
            ids={tokens.map((t) => t.key)}
            onMove={() => undefined}
            label={(key) => byKey.get(key)?.label ?? ''}
            liftClass="lift--token"
            outside={stage}
            renderOverlay={(key, { outside }) => {
              const t = byKey.get(key);
              return t ? <BarTokenLifted t={t} outside={outside} /> : null;
            }}
          >
            <div className="tokens">
              {tokens.map((t) => (
                <BarToken key={t.key} t={t} fresh={t.key === freshToken} full={full} onAdd={() => setPins(hub, [...pins, t.key])} />
              ))}
            </div>
          </Sortable>
        ) : (
          <p className="tray__empty">Everything’s in the bar.</p>
        )}
      </div>
      {isDefaultPins(pins) ? null : (
        <p className="editlink">
          <button
            type="button"
            className="textbtn"
            onClick={() => toast('The bar is back to the default', { action: { label: 'Undo', run: resetPins(hub) } })}
          >
            Back to the default
          </button>
        </p>
      )}
    </div>
  );
}

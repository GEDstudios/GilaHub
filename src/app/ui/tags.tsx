import type { Item } from '../../core/model';
import { useHub, useRt } from '../context';
import { notifyAbout } from '../notify';
import { reqLabel, visLabel, visTagFor, VIS_ICON, type ReqState } from '../privacy';
import { haptic } from './haptics';
import { Icon } from './Icon';
import { useOverlays } from './overlays';
import { lineVars } from './primitives';
import { useSettleHold } from './useSettle';

/** The lemon "Urgent" word pill: the same in every card and row. `short`: just the lightning, for narrow tiles. */
export function UrgentTag({ title = 'Urgent', short }: { title?: string; short?: boolean }) {
  return (
    <span className={`urgent ${short ? 'urgent--short' : ''}`} title={title} aria-label={title} role="img">
      <Icon name="urgent" className="icon--xs on-color" />
      {short ? null : 'Urgent'}
    </span>
  );
}

/**
 * Whose it is, when that differs from its project (so Ours projects stay quiet):
 * an ink "Private", "Mine" in my color, "{P}'s" in theirs, or "Ours" inside a Mine project.
 */
export function VisTag({ item }: { item: Item }) {
  const hub = useHub();
  const v = visTagFor(hub, item);
  if (!v) return null;
  if (v === 'private') {
    return (
      <span className="vtag vtag--private">
        <Icon name={VIS_ICON.private} className="on-ink" />
        Private
      </span>
    );
  }
  if (v === 'ours') {
    return (
      <span className="vtag vtag--ours">
        <Icon name={VIS_ICON.ours} />
        Ours
      </span>
    );
  }
  const owner = v === 'mine' ? hub.me() : hub.member(hub.ownerOf(item));
  return (
    <span className="vtag vtag--person" style={lineVars(owner?.color)} dir="auto">
      {visLabel(v, owner?.name)}
    </span>
  );
}

/** Who asked whom, in the other person's color with Tasky's cursor. */
export function ReqTag({ state }: { state: ReqState }) {
  return (
    <span className="rtag" style={lineVars(state.other?.color)} dir="auto">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 3l15 7.5-6.5 1.8L10.5 19z" fill="currentColor" />
      </svg>
      {reqLabel(state)}
    </span>
  );
}

/** OK / Not yet for something my partner says is done. Same on Today and on the item page. */
export function RequestActions({ item, className }: { item: Item; className?: string }) {
  const hub = useHub();
  const rt = useRt();
  const { toast } = useOverlays();
  const hold = useSettleHold();
  const doer = hub.member(item.submittedBy)?.name ?? 'them';
  return (
    <span className={`reqacts ${className ?? ''}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="mini mini--ink"
        onClick={() => {
          haptic('success');
          hold?.(item.id);
          const undo = hub.confirm(item.id);
          toast('Confirmed. Thanks!', { action: { label: 'Undo', run: undo } });
        }}
      >
        OK
      </button>
      <button
        type="button"
        className="mini"
        onClick={() => {
          const to = item.submittedBy;
          const undo = hub.sendBack(item.id);
          // Their phone hears it once Undo is no longer on offer.
          toast(`Sent back to ${doer}`, {
            action: { label: 'Undo', run: undo },
            onExpire: () => notifyAbout(rt, hub, item, to, `${hub.me()?.name ?? 'Your partner'} said not yet`, `“${item.title}” needs another go`),
          });
        }}
      >
        Not yet
      </button>
    </span>
  );
}

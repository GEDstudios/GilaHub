import type { Hub } from '../core/actions';
import { humanDate, today as todayStr } from '../core/dates';
import type { Item } from '../core/model';
import { useHub, useRt } from './context';
import { afterTick } from './notify';
import { doneMany, useOverlays, type ToastOpts } from './ui/overlays';

/** A repeating thing was just done today: "Fresh again. Next: Wed 2 Dec · Hila's turn next". */
export function freshAgain(hub: Hub, id: string): string {
  const next = hub.item(id);
  const day = next?.due ? `. Next: ${humanDate(next.due, todayStr())}` : '';
  const turn = next?.assignee === 'turns' && next.turn ? ` · ${next.turn === hub.meId ? 'your' : `${hub.member(next.turn)?.name}’s`} turn next` : '';
  return `Fresh again${day}${turn}`;
}

/**
 * The one tick: every row, the chores list and the item page say the same thing after it.
 * Repeating → "Fresh again…"; a request waiting for an OK → "Sent to X for an OK"; open steps →
 * "Done. n steps still open · Finish them"; otherwise "Done", folding into "3 done". All with Undo.
 */
export function useTick(): (item: Item) => void {
  const hub = useHub();
  const rt = useRt();
  const { toast } = useOverlays();
  return (item) => {
    const say = (msg: string, opts: ToastOpts = {}) => toast(msg, { action: { label: 'Undo', run: undo }, ...opts });
    let undo: () => void;
    if (item.repeat && !item.done) {
      undo = hub.completeRepeating(item.id);
      say(freshAgain(hub, item.id));
      return;
    }
    const openSteps = !item.done && !item.needsOk ? hub.descendants(item.id).filter((d) => !d.done).length : 0;
    undo = hub.toggle(item.id);
    const msg = afterTick(rt, hub, item.id);
    if (msg) say(msg);
    else if (openSteps)
      toast(`Done. ${openSteps} step${openSteps > 1 ? 's' : ''} still open.`, {
        action: {
          label: 'Finish them',
          run: () => {
            undo();
            hub.toggle(item.id, { withChildren: true });
          },
        },
      });
    else if (!item.done) say('Done', { group: 'done', many: doneMany });
  };
}

import type { Hub } from '../core/hub';
import { addDays, humanDate, today as todayStr } from '../core/dates';
import type { Item } from '../core/model';
import { isFlexible } from '../smart/recurrence';
import { useHub, useRt } from './context';
import { afterTick } from './notify';
import { navigate } from './router';
import { doneMany, useOverlays, type ToastOpts } from './ui/overlays';

/**
 * A repeating thing was just done today: "Laundry is fresh again. Next: Wed 2 Dec · Hila's turn
 * next". It names the thing, so it still reads right on another screen or under another toast.
 */
export function freshAgain(hub: Hub, id: string): string {
  const next = hub.item(id);
  const day = next?.due ? `. Next: ${humanDate(next.due, todayStr())}` : '';
  const turn = next?.assignee === 'turns' && next.turn ? ` · ${next.turn === hub.meId ? 'your' : `${hub.member(next.turn)?.name}’s`} turn next` : '';
  return `${next?.title ? `${next.title} is fresh` : 'Fresh'} again${day}${turn}`;
}

/** Does ticking this play the strike-and-fold? Only when it leaves the list as done. */
export function ticksAway(hub: Hub, item: Item): boolean {
  const kind = hub.tickKind(item);
  return kind !== 'undone' && kind !== 'take-back';
}

/**
 * The one tick: every row, the chores list and the item page say the same thing after it.
 * Repeating → "Laundry is fresh again…"; a request waiting for an OK → "Sent to X for an OK";
 * taking that back → "Taken back"; open subtasks → "Done · n subtasks still open" with Finish them and See them; otherwise
 * "Done", folding into "3 done". All with Undo.
 */
export function useTick(): (item: Item) => void {
  const hub = useHub();
  const rt = useRt();
  const { toast } = useOverlays();
  return (item) => {
    const kind = hub.tickKind(item);
    let undo: () => void = () => {};
    const say = (msg: string, opts: ToastOpts = {}) => toast(msg, { action: { label: 'Undo', run: () => undo() }, ...opts });
    if (kind === 'roll') {
      undo = hub.completeRepeating(item.id);
      say(freshAgain(hub, item.id));
      return;
    }
    const openSteps = kind === 'done' && !item.needsOk ? hub.descendants(item.id).filter((d) => !d.done).length : 0;
    undo = hub.toggle(item.id);
    if (kind === 'undone') return;
    if (kind === 'take-back') return say('Taken back');
    const msg = afterTick(rt, hub, item.id);
    if (msg) say(msg);
    else if (openSteps)
      say(`Done · ${openSteps} subtask${openSteps > 1 ? 's' : ''} still open`, {
        action: [
          { label: 'Undo', run: () => undo() },
          {
            label: 'Finish them',
            run: () => {
              undo();
              hub.toggle(item.id, { withChildren: true });
            },
          },
          // Have a look first: the task, done, with its open subtasks.
          { label: 'See them', run: () => navigate({ name: 'item', id: item.id }) },
        ],
      });
    else say('Done', { group: 'done', many: doneMany });
  };
}

/**
 * Not today, for something dated, the same wherever it's offered (the item page, "from earlier"):
 * - a one-off, or a repeat that counts from when it's done: tomorrow, "Tomorrow, then";
 * - a repeat on a fixed schedule: skip to its next time, "Skipped. Next: Fri 27 Nov".
 * Each with Undo.
 */
export function useLater(): { label: (item: Item) => string; run: (item: Item) => void } {
  const hub = useHub();
  const { toast } = useOverlays();
  const skips = (item: Item) => !!item.repeat && !isFlexible(item.repeat);
  return {
    label: (item) => (skips(item) ? 'Skip' : item.repeat ? 'Not today' : 'Tomorrow'),
    run: (item) => {
      const ref = todayStr();
      if (skips(item)) {
        const undo = hub.skip(item.id);
        const due = hub.item(item.id)?.due;
        toast(due ? `Skipped. Next: ${humanDate(due, ref)}` : 'Skipped', { action: { label: 'Undo', run: undo } });
        return;
      }
      const undo = hub.snooze(item.id, addDays(ref, 1));
      toast('Tomorrow, then', { action: { label: 'Undo', run: undo } });
    },
  };
}

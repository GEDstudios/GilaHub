import type { Item } from '../../core/model';
import { useHub, usePartnerHere, useRt } from '../context';
import { notifyMembers } from '../runtime';
import { myName } from '../labels';

/**
 * Tell my partner, while they're on that project right now (they pressed Start there), that
 * something is urgent: "Guy added milk" for a new thing, "Guy marked milk urgent" for one already
 * there. Used by New and the Urgent chip.
 */
export function usePingUrgent() {
  const hub = useHub();
  const rt = useRt();
  const here = usePartnerHere();
  return (item: Item, added: boolean) => {
    if (!here || (here.listId && here.listId !== item.listId && !hub.isWithin(item.listId, here.listId))) return;
    const me = myName(hub);
    void notifyMembers(rt, [here.member], {
      title: added ? `${me} added ${item.title}` : `${me} marked ${item.title} urgent`,
      body: 'Urgent, while you’re on it 🙏',
      url: `/l/${here.listId ?? item.listId}`,
      tag: 'urgent',
    });
  };
}

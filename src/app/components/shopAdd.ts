import type { ItemVisibility, ShoppingAddResult } from '../../core/actions';
import type { Item } from '../../core/model';
import { useHub, usePartnerShopping, useRt } from '../context';
import { visFields, type VisChoice } from '../privacy';
import { notifyMembers } from '../runtime';
import { markFresh } from '../ui/fresh';
import { useOverlays } from '../ui/overlays';

export interface ShopAdd {
  title: string;
  qty?: string | null;
  urgent?: boolean;
  /** Who sees it; undefined = the list's default. */
  vis?: VisChoice;
}

/**
 * Tell a partner who is in the store right now that something is urgent: "Guy added milk" for a
 * new item, "Guy marked milk urgent" for one already on the list. Used by the add row, New and
 * the item sheet's Urgent chip.
 */
export function usePingUrgent() {
  const hub = useHub();
  const rt = useRt();
  const partnerShopping = usePartnerShopping();
  return (item: Item, added: boolean) => {
    if (!partnerShopping) return;
    const me = hub.me()?.name ?? 'Your partner';
    void notifyMembers(rt, [partnerShopping.member], {
      title: added ? `${me} added ${item.title}` : `${me} marked ${item.title} urgent`,
      body: 'Urgent, while you’re there 🙏',
      url: '/shop',
      tag: 'urgent',
    });
  };
}

/**
 * Put something on a shopping list the one way: no duplicates (already there → "+1",
 * crossed off → brought back), the new row glows, and an urgent add pings a partner
 * who is in the store right now. Used by the Shopping add row and by New.
 */
export function useShopAdd() {
  const hub = useHub();
  const { toast } = useOverlays();
  const pingUrgent = usePingUrgent();

  return (listId: string, add: ShopAdd, opts: { quiet?: boolean; announce?: boolean } = {}): ShoppingAddResult | undefined => {
    const title = add.title.trim();
    if (!title) return undefined;
    const f: { visibility?: ItemVisibility; owner?: string } = add.vis ? visFields(hub, add.vis) : {};
    const res = hub.addShopping(listId, title, { qty: add.qty ?? null, urgent: add.urgent, visibility: f.visibility, owner: f.owner ?? null });
    markFresh(res.id, { scroll: opts.announce });
    const item = hub.item(res.id);
    if (!opts.quiet) {
      if (res.kind === 'exists') toast(`${item?.title} is already on the list`, { action: { label: '+1', run: () => hub.bump(res.id) } });
      else if (res.kind === 'revived') toast(`Brought back ${item?.title}`);
      else if (opts.announce) toast(`Added to ${hub.list(listId)?.name ?? 'the list'}`, { ms: 1800 });
    }
    if (add.urgent && item) pingUrgent(item, res.kind !== 'exists');
    return res;
  };
}

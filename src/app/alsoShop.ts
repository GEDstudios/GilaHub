import { useHub } from './context';
import { useOverlays } from './ui/overlays';

/** "Buy a doorknob": the subtask goes on the right shopping list too, and says so (with Undo). */
export function useAlsoShop() {
  const hub = useHub();
  const { toast } = useOverlays();
  return (id: string) => {
    const twin = hub.linkIfShopping(id);
    const it = twin ? hub.item(twin) : undefined;
    if (!it) return;
    toast(`${it.title} is on ${hub.list(it.listId)?.name ?? 'the list'} too`, {
      action: {
        label: 'Undo',
        run: () => {
          hub.unlink(id);
          hub.delete(it.id);
        },
      },
    });
  };
}

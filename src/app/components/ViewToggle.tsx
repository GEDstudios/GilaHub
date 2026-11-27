import type { ListView } from '../../core/model';
import { useHub } from '../context';
import { haptic } from '../ui/haptics';
import { Icon, type IconName } from '../ui/Icon';
import { G } from '../ui/glyphs';

const VIEWS: Array<[ListView, IconName, string]> = [
  ['list', G.viewList, 'List'],
  ['cards', G.viewCards, 'Cards'],
  ['tags', G.viewTags, 'By tag'],
];

/** How a folder is looked at, for both of us: a list, cards, or grouped by tag. */
export function ViewToggle({ listId }: { listId: string }) {
  const hub = useHub();
  const now = hub.viewOf(hub.list(listId));
  return (
    <div className="viewtoggle" role="radiogroup" aria-label="Show as">
      {VIEWS.map(([v, icon, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={now === v}
          aria-label={label}
          title={label}
          className={`viewtoggle__btn ${now === v ? 'is-on' : ''}`}
          onClick={() => {
            haptic('select');
            hub.setListView(listId, v);
          }}
        >
          <Icon name={icon} className="icon--sm" />
        </button>
      ))}
    </div>
  );
}

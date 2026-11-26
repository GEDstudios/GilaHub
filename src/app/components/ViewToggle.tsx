import { setPrefs, usePrefs } from '../prefs';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';

/** List or cards: how a project's tasks (or the shopping) are laid out. Remembered on this device. */
export function ViewToggle({ which }: { which: 'taskView' | 'shopView' }) {
  const prefs = usePrefs();
  const now = prefs[which];
  return (
    <div className="viewtoggle" role="radiogroup" aria-label={which === 'shopView' ? 'Show the shopping as' : 'Show tasks as'}>
      {(
        [
          ['list', 'lines', 'List'],
          ['cards', 'folders', 'Cards'],
        ] as const
      ).map(([v, icon, label]) => (
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
            setPrefs({ [which]: v });
          }}
        >
          <Icon name={icon} className="icon--sm" />
        </button>
      ))}
    </div>
  );
}

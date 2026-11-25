import { useState, type CSSProperties } from 'react';
import type { Flavor } from '../../smart/categorize';
import { aisleIcon } from '../aisles';
import { useHub } from '../context';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Sortable, useSortableItem } from '../ui/Sortable';

/**
 * Arrange aisles, on Shopping itself: the aisles in your walk through the store, as rows you
 * drag into order; tap a name to rename it; add aisles of your own at the end (and take them
 * away again with ×). Each change saves at once and shows for both of you.
 */
export function AisleArrange({ flavors, counts, onDone }: { flavors: Array<{ flavor: Flavor; name: string }>; counts: Map<string, number>; onDone: () => void }) {
  return (
    <div className="aislearr">
      {flavors.map((f) => (
        <FlavorAisles key={f.flavor} flavor={f.flavor} name={flavors.length > 1 ? f.name : null} counts={counts} />
      ))}
      <div className="homereset">
        <button type="button" className="btn btn--sm" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function FlavorAisles({ flavor, name, counts }: { flavor: Flavor; name: string | null; counts: Map<string, number> }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const [fresh, setFresh] = useState('');
  const ids = hub.aisleOrder(flavor);
  const add = () => {
    if (hub.addAisle(flavor, fresh)) {
      haptic('tick');
      setFresh('');
    }
  };
  return (
    <section className="aislearr__flavor">
      {name ? <h2 className="aisle__head">{name}</h2> : null}
      <ul className="rows aislearr__rows">
        <Sortable ids={ids} grips onMove={(next) => hub.arrangeAisles(flavor, next)} label={(id) => hub.aisleMeta(flavor, id).name} renderOverlay={(id) => <ul className="rows"><AisleFace flavor={flavor} id={id} n={counts.get(`${flavor}:${id}`) ?? 0} /></ul>}>
          {ids.map((id) => (
            <AisleRow
              key={id}
              flavor={flavor}
              id={id}
              n={counts.get(`${flavor}:${id}`) ?? 0}
              onRemove={() => {
                const was = hub.aisleOrder(flavor);
                const meta = hub.aisleMeta(flavor, id);
                hub.removeAisle(flavor, id);
                toast(`${meta.name} is gone`, { action: { label: 'Undo', run: () => hub.arrangeAisles(flavor, was) } });
              }}
            />
          ))}
        </Sortable>
      </ul>
      <label className="composer__stepadd aislearr__new">
        <Icon name="plus" className="icon--sm" />
        <input
          value={fresh}
          dir="auto"
          onChange={(e) => setFresh(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="New aisle"
          aria-label={`New aisle${name ? ` in ${name}` : ''}`}
        />
        {fresh.trim() ? (
          <button type="button" className="btn btn--sm composer__stepgo" onMouseDown={(e) => e.preventDefault()} onClick={add}>
            Add
          </button>
        ) : null}
      </label>
    </section>
  );
}

function Mark({ flavor, id }: { flavor: Flavor; id: string }) {
  const hub = useHub();
  const icon = aisleIcon(flavor, id);
  return <span className="aislearr__mark">{icon ? <Icon name={icon} /> : <span aria-hidden="true">{hub.aisleMeta(flavor, id).emoji}</span>}</span>;
}

function AisleRow({ flavor, id, n, onRemove }: { flavor: Flavor; id: string; n: number; onRemove: () => void }) {
  const hub = useHub();
  const s = useSortableItem(id);
  const meta = hub.aisleMeta(flavor, id);
  const [name, setName] = useState(meta.name);
  const save = () => {
    if (name.trim() && name.trim() !== meta.name) hub.renameAisle(flavor, id, name);
    else setName(meta.name);
  };
  return (
    <li ref={s.ref} style={s.style as CSSProperties} className={`row aislearr__row ${s.className}`} {...s.props}>
      <Mark flavor={flavor} id={id} />
      <input
        className="aislearr__name"
        value={name}
        dir="auto"
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label={`Rename ${meta.name}`}
      />
      {n ? <span className="aislearr__n num">{n}</span> : null}
      {meta.custom ? (
        <button type="button" className="homecard__x" aria-label={`Remove ${meta.name}`} onClick={onRemove}>
          <Icon name="x" className="icon--sm" />
        </button>
      ) : null}
      <button type="button" data-grip ref={s.gripRef} {...s.gripProps} className="homecard__grip" aria-label={`Move ${meta.name}`}>
        <Icon name="grip" />
      </button>
    </li>
  );
}

function AisleFace({ flavor, id, n }: { flavor: Flavor; id: string; n: number }) {
  const hub = useHub();
  return (
    <li className="row aislearr__row is-lifted">
      <Mark flavor={flavor} id={id} />
      <span className="aislearr__name">{hub.aisleMeta(flavor, id).name}</span>
      {n ? <span className="aislearr__n num">{n}</span> : null}
      <span className="homecard__grip">
        <Icon name="grip" />
      </span>
    </li>
  );
}

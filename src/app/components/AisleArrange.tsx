import { useState, type CSSProperties } from 'react';
import type { Flavor } from '../../smart/categorize';
import { categoryMark } from '../aisles';
import { IconPicker } from './IconPicker';
import { useHub } from '../context';
import { haptic } from '../ui/haptics';
import { Icon, type IconName } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Sortable, useSortableItem } from '../ui/Sortable';

/**
 * Arrange categories, on Shopping itself: the categories in your walk through the store, as
 * rows you drag into order; tap a name to rename it, its icon to pick another; add categories
 * of your own at the end, with an icon picked as you name them (and take them away with ×). Each change saves at
 * once and shows for both of you.
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
  const [icon, setIcon] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const ids = hub.aisleOrder(flavor);
  const add = () => {
    if (hub.addAisle(flavor, fresh, icon)) {
      haptic('tick');
      setFresh('');
      setIcon(undefined);
      setPicking(false);
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
      <div className="composer__stepadd aislearr__new">
        {/* Its icon first: tap to pick one as you name it. */}
        <button type="button" className="aislearr__markbtn aislearr__newmark" aria-label="Icon for the new category" aria-expanded={picking} onClick={() => setPicking(!picking)}>
          {icon?.startsWith('i:') ? <Icon name={icon.slice(2) as IconName} /> : icon ? <span aria-hidden="true">{icon}</span> : <Icon name="tag" />}
        </button>
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
          placeholder="New category"
          aria-label={`New category${name ? ` in ${name}` : ''}`}
        />
        {fresh.trim() ? (
          <button type="button" className="btn btn--sm composer__stepgo" onMouseDown={(e) => e.preventDefault()} onClick={add}>
            Add
          </button>
        ) : null}
      </div>
      {picking ? (
        <div className="aislearr__pick">
          <IconPicker
            value={icon}
            color="lemon"
            onChange={(v) => {
              setIcon(v);
              setPicking(false);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

function Mark({ flavor, id }: { flavor: Flavor; id: string }) {
  const hub = useHub();
  const m = categoryMark(hub, flavor, id);
  return <span className="aislearr__mark">{m.icon ? <Icon name={m.icon} /> : <span aria-hidden="true">{m.emoji}</span>}</span>;
}

function AisleRow({ flavor, id, n, onRemove }: { flavor: Flavor; id: string; n: number; onRemove: () => void }) {
  const hub = useHub();
  const s = useSortableItem(id);
  const meta = hub.aisleMeta(flavor, id);
  const [name, setName] = useState(meta.name);
  const [picking, setPicking] = useState(false);
  const save = () => {
    if (name.trim() && name.trim() !== meta.name) hub.renameAisle(flavor, id, name);
    else setName(meta.name);
  };
  return (
    <li ref={s.ref} style={s.style as CSSProperties} className={`row aislearr__row ${picking ? 'is-picking' : ''} ${s.className}`} {...s.props}>
      <button type="button" className="aislearr__markbtn" aria-label={`Icon for ${meta.name}`} aria-expanded={picking} onClick={() => setPicking(!picking)}>
        <Mark flavor={flavor} id={id} />
      </button>
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
      {picking ? (
        <div className="aislearr__pick">
          <IconPicker
            value={meta.icon}
            color="lemon"
            onChange={(v) => {
              hub.setAisleIcon(flavor, id, v);
              setPicking(false);
            }}
          />
        </div>
      ) : null}
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

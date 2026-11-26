import { useState, type CSSProperties } from 'react';
import type { Tag } from '../../core/model';
import { fold } from '../../smart/normalize';
import { useHub } from '../context';
import { haptic } from '../ui/haptics';
import { Icon, type IconName } from '../ui/Icon';
import { GLYPHS } from '../ui/icons.gen';
import { Sheet, useOverlays } from '../ui/overlays';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { IconPicker } from './IconPicker';

/** A tag's mark: its icon ("i:" any of the app's, "x:" from the library) or emoji, else the plain tag. */
export function TagMark({ icon, className = 'icon--sm' }: { icon: string | null | undefined; className?: string }) {
  const v = (icon ?? '').trim();
  const cls = `tagmark ${className}`;
  if (v.startsWith('i:') && v.slice(2) in GLYPHS) return <Icon name={v.slice(2) as IconName} className={cls} />;
  if (v.startsWith('x:') && v.length > 2) return <Icon name={v as IconName} className={cls} />;
  if (v && !v.startsWith('i:')) return <span className={`glyph-emoji ${cls}`}>{v}</span>;
  return <Icon name="tag" className={cls} />;
}

/** A row's tags, small, after its other meta (at most two, then "+n"). */
export function TagPills({ ids, skip }: { ids: string[]; skip?: string | null }) {
  const hub = useHub();
  const tags = ids.filter((t) => t !== skip).flatMap((t) => hub.tag(t) ?? []);
  if (!tags.length) return null;
  return (
    <>
      {tags.slice(0, 2).map((t) => (
        <span key={t.id} className="meta meta--tag">
          <TagMark icon={t.icon} className="icon--xs" />
          <span dir="auto">{t.name}</span>
        </span>
      ))}
      {tags.length > 2 ? <span className="meta meta--tag num">+{tags.length - 2}</span> : null}
    </>
  );
}

/** What a set of tags reads as on a chip: "Dairy", "Dairy +1", or "Tags". */
export function tagsLabel(hub: ReturnType<typeof useHub>, ids: string[]): { label: string; lead?: string | null } {
  const tags = ids.flatMap((t) => hub.tag(t) ?? []);
  if (!tags.length) return { label: 'Tags' };
  return { label: tags.length > 1 ? `${tags[0].name} +${tags.length - 1}` : tags[0].name, lead: tags[0].icon ?? null };
}

/**
 * Pick tags: the ones it wears first, then what the words suggest, then the rest in our order.
 * Type to find one, or to make a new one (Enter). Many at once; each tap saves.
 */
export function TagPicker({ value, onChange, suggested = [] }: { value: string[]; onChange: (tags: string[]) => void; suggested?: string[] }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const [q, setQ] = useState('');
  const all = hub.tags();
  const on = new Set(value);
  const sugg = suggested.filter((t) => !on.has(t) && hub.tag(t));
  const query = fold(q.trim().replace(/^#/, ''));
  const exact = all.find((t) => fold(t.name) === query);
  const list: Tag[] = query
    ? all.filter((t) => fold(t.name).includes(query))
    : [...all.filter((t) => on.has(t.id)), ...sugg.flatMap((t) => hub.tag(t) ?? []), ...all.filter((t) => !on.has(t.id) && !sugg.includes(t.id))];
  const flip = (id: string) => {
    haptic('tick');
    onChange(on.has(id) ? value.filter((t) => t !== id) : [...value, id]);
  };
  const make = () => {
    if (!query) return;
    if (exact) {
      if (!on.has(exact.id)) flip(exact.id);
    } else {
      const id = hub.createTag(q);
      if (id) onChange([...value, id]);
    }
    setQ('');
  };
  return (
    <div className="tagpick">
      <label className="tagpick__find">
        <Icon name="search" className="icon--sm" />
        <input
          value={q}
          dir="auto"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              make();
            }
          }}
          placeholder="Find or make a tag"
          aria-label="Find or make a tag"
          enterKeyHint="done"
        />
      </label>
      <div className="tagpick__tags" role="group" aria-label="Tags">
        {list.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tagtoken ${on.has(t.id) ? 'is-on' : ''} ${sugg.includes(t.id) && !query ? 'is-suggested' : ''}`}
            aria-pressed={on.has(t.id)}
            onClick={() => flip(t.id)}
          >
            <TagMark icon={t.icon} />
            <span dir="auto">{t.name}</span>
            {on.has(t.id) ? <Icon name="check" className="icon--xs" /> : null}
          </button>
        ))}
        {query && !exact ? (
          <button type="button" className="tagtoken tagtoken--new" onClick={make}>
            <Icon name="plus" className="icon--sm" />
            <span dir="auto">New tag “{q.trim().replace(/^#/, '')}”</span>
          </button>
        ) : null}
      </div>
      <button type="button" className="textbtn tagpick__manage" onClick={() => openSheet((close) => <TagManager onClose={close} />)}>
        <Icon name="edit" className="icon--sm" />
        Edit tags
      </button>
    </div>
  );
}

/**
 * Our tags, in one place: drag to set their order (it's also the walk through the store), tap a
 * mark to pick its icon, a name to rename it; × takes one off everything. A new one at the end.
 */
export function TagManager({ onClose }: { onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const counts = hub.tagCounts();
  const ids = hub.tags().map((t) => t.id);
  const [fresh, setFresh] = useState('');
  const [icon, setIcon] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const add = () => {
    if (hub.createTag(fresh, icon)) {
      haptic('tick');
      setFresh('');
      setIcon(undefined);
      setPicking(false);
    }
  };
  return (
    <Sheet onClose={onClose} title="Tags">
      <p className="hint tagman__hint">Their order is your walk through the store: Shopping groups things by it.</p>
      <ul className="rows aislearr__rows">
        <Sortable
          ids={ids}
          grips
          onMove={(next) => hub.arrangeTags(next)}
          label={(id) => hub.tag(id)?.name ?? ''}
          renderOverlay={(id) => (
            <ul className="rows">
              <TagFace id={id} n={counts.get(id) ?? 0} />
            </ul>
          )}
        >
          {ids.map((id) => (
            <TagRow
              key={id}
              id={id}
              n={counts.get(id) ?? 0}
              onRemove={() => {
                const t = hub.tag(id);
                const n = counts.get(id) ?? 0;
                const undo = hub.deleteTag(id);
                toast(n ? `${t?.name} is gone · taken off ${n}` : `${t?.name} is gone`, { action: { label: 'Undo', run: undo } });
              }}
            />
          ))}
        </Sortable>
      </ul>
      <div className="composer__stepadd aislearr__new">
        <button type="button" className="aislearr__markbtn aislearr__newmark" aria-label="Icon for the new tag" aria-expanded={picking} onClick={() => setPicking(!picking)}>
          <TagMark icon={icon} className="" />
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
          placeholder="New tag"
          aria-label="New tag"
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
    </Sheet>
  );
}

function TagRow({ id, n, onRemove }: { id: string; n: number; onRemove: () => void }) {
  const hub = useHub();
  const s = useSortableItem(id);
  const tag = hub.tag(id);
  const [name, setName] = useState(tag?.name ?? '');
  const [picking, setPicking] = useState(false);
  if (!tag) return null;
  const save = () => {
    if (name.trim() && name.trim() !== tag.name) hub.updateTag(id, { name });
    else setName(tag.name);
  };
  return (
    <li ref={s.ref} style={s.style as CSSProperties} className={`row aislearr__row ${picking ? 'is-picking' : ''} ${s.className}`} {...s.props}>
      <button type="button" className="aislearr__markbtn" aria-label={`Icon for ${tag.name}`} aria-expanded={picking} onClick={() => setPicking(!picking)}>
        <span className="aislearr__mark">
          <TagMark icon={tag.icon} className="" />
        </span>
      </button>
      <input
        className="aislearr__name"
        value={name}
        dir="auto"
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label={`Rename ${tag.name}`}
      />
      {n ? <span className="aislearr__n num">{n}</span> : null}
      <button type="button" className="homecard__x" aria-label={`Remove ${tag.name}`} onClick={onRemove}>
        <Icon name="x" className="icon--sm" />
      </button>
      <button type="button" data-grip ref={s.gripRef} {...s.gripProps} className="homecard__grip" aria-label={`Move ${tag.name}`}>
        <Icon name="grip" />
      </button>
      {picking ? (
        <div className="aislearr__pick">
          <IconPicker
            value={tag.icon ?? undefined}
            color="lemon"
            onChange={(v) => {
              hub.updateTag(id, { icon: v });
              setPicking(false);
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

function TagFace({ id, n }: { id: string; n: number }) {
  const hub = useHub();
  const tag = hub.tag(id);
  return (
    <li className="row aislearr__row is-lifted">
      <span className="aislearr__markbtn">
        <span className="aislearr__mark">
          <TagMark icon={tag?.icon} className="" />
        </span>
      </span>
      <span className="aislearr__name">{tag?.name}</span>
      {n ? <span className="aislearr__n num">{n}</span> : null}
      <span className="homecard__grip">
        <Icon name="grip" />
      </span>
    </li>
  );
}

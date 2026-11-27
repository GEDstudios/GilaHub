import { useState, type CSSProperties } from 'react';
import type { Tag } from '../../core/model';
import { fold } from '../../smart/normalize';
import { useHub } from '../context';
import { haptic } from '../ui/haptics';
import { FindField, TextButton, Button, GlyphButton } from '../ui/primitives';
import { Icon, type IconName } from '../ui/Icon';
import { GLYPHS } from '../ui/icons.gen';
import { Sheet, useOverlays } from '../ui/overlays';
import { Sortable, useSortableItem } from '../ui/Sortable';
import { IconPicker } from './IconPicker';
import { G } from '../ui/glyphs';
import type { Hub } from '../../core/hub';

/** A tag's mark: its icon ("i:" any of the app's, "x:" from the library) or emoji, else the plain tag. */
export function TagMark({ icon, className = 'icon--sm' }: { icon: string | null | undefined; className?: string }) {
  const v = (icon ?? '').trim();
  const cls = `tagmark ${className}`;
  if (v.startsWith('i:') && v.slice(2) in GLYPHS) return <Icon name={v.slice(2) as IconName} className={cls} />;
  if (v.startsWith('x:') && v.length > 2) return <Icon name={v as IconName} className={cls} />;
  if (v && !v.startsWith('i:')) return <span className={`glyph-emoji ${cls}`}>{v}</span>;
  return <Icon name={G.tag} className={cls} />;
}

/** A row's tags, small, after its other meta (at most two, then "+n"). */
export function TagPills({ ids }: { ids: string[] }) {
  const hub = useHub();
  const tags = ids.flatMap((t) => hub.tag(t) ?? []);
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
export function tagsLabel(hub: Hub, ids: string[]): { label: string; lead?: string | null } {
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
  // A new tag's icon, chosen before it's made.
  const [newIcon, setNewIcon] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const all = hub.tags();
  const on = new Set(value);
  const sugg = suggested.filter((t) => !on.has(t) && hub.tag(t));
  const query = fold(q.trim().replace(/^#/, ''));
  const exact = all.find((t) => fold(t.name) === query);
  // The order is set as it opens, so picking doesn't shuffle it: what it wears, what we used
  // lately, what the words suggest, then the rest in our order. New ones join at the end.
  const [order] = useState(() => [...new Set([...value, ...hub.recentTags(), ...sugg])]);
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  const list: Tag[] = query ? all.filter((t) => fold(t.name).includes(query)) : [...all].sort((a, b) => rank(a.id) - rank(b.id));
  const flip = (id: string) => {
    haptic('tick');
    onChange(on.has(id) ? value.filter((t) => t !== id) : [...value, id]);
  };
  const make = () => {
    if (!query) return;
    if (exact) {
      if (!on.has(exact.id)) flip(exact.id);
    } else {
      const id = hub.createTag(q, newIcon ?? null);
      if (id) onChange([...value, id]);
    }
    setQ('');
    setNewIcon(undefined);
    setPicking(false);
  };
  return (
    <div className="tagpick">
      <FindField value={q} onChange={setQ} onEnter={make} placeholder="Find or make a tag" enterKeyHint="done" />
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
            {on.has(t.id) ? <Icon name={G.done} className="icon--xs" /> : null}
          </button>
        ))}
        {query && !exact ? (
          <span className="tagnew">
            {/* Its icon, picked right here before it's made (tap to choose). */}
            <button
              type="button"
              className={`tagnew__icon ${newIcon ? 'is-set' : ''} ${picking ? 'is-open' : ''}`}
              aria-label={newIcon ? 'Change the new tag’s icon' : 'Pick an icon for the new tag'}
              aria-expanded={picking}
              onClick={() => setPicking(!picking)}
            >
              <TagMark icon={newIcon ?? null} />
            </button>
            <button type="button" className="tagtoken tagtoken--new" onClick={make}>
              <Icon name={G.add} className="icon--sm" />
              <span dir="auto">New tag “{q.trim().replace(/^#/, '')}”</span>
            </button>
          </span>
        ) : null}
      </div>
      {picking && query && !exact ? (
        <div className="panel tagnew__pick">
          <IconPicker
            value={newIcon}
            color="lemon"
            onChange={(v) => {
              setNewIcon(v);
              setPicking(false);
            }}
          />
        </div>
      ) : null}
      <TextButton icon={G.edit} onClick={() => openSheet((close) => <TagManager onClose={close} />)} className="tagpick__manage">
        Edit tags
      </TextButton>
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
                toast(n ? `${t?.name} is gone · taken off ${n}` : `${t?.name} is gone`, { undo });
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
          <Button small onMouseDown={(e) => e.preventDefault()} onClick={add} className="composer__stepgo">
            Add
          </Button>
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
      <GlyphButton icon={G.close} filled label={`Remove ${tag.name}`} onClick={onRemove} />
      <button type="button" data-grip ref={s.gripRef} {...s.gripProps} className="homecard__grip" aria-label={`Move ${tag.name}`}>
        <Icon name={G.grip} />
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
        <Icon name={G.grip} />
      </span>
    </li>
  );
}

import { useState } from 'react';
import type { LineColor } from '../../core/model';
import { Icon, type IconName } from '../ui/Icon';
import { G } from '../ui/glyphs';
import { LIB_GROUPS, searchLibrary, useLibrary } from '../ui/library';
import { FindField, firstGrapheme, lineVars, TextButton } from '../ui/primitives';
import { Glyph, parseGlyph, PLAIN_FOLDER, FOLDER_ICONS, showsGlyph } from '../ui/FolderMark';

/** How many library icons show before "More". */
const PAGE = 96;

/**
 * Pick a line icon, type any emoji, or keep it plain. Our favourites come first; search, or
 * open a group, to reach the whole library (~1,300 more).
 */
export function IconPicker({ value, color, onChange }: { value: string | undefined; color: LineColor; onChange: (icon: string) => void }) {
  const g = parseGlyph(value);
  const plain = !g || value === PLAIN_FOLDER;
  const [emoji, setEmoji] = useState(g?.kind === 'emoji' ? g.text : '');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const lib = useLibrary();
  const browsing = !!q.trim() || group !== null;
  const found = browsing && lib ? searchLibrary(lib, q, group) : [];
  // A library icon picked before stays in sight among the favourites.
  const picked = g?.kind === 'icon' && g.name.startsWith('x:') ? g.name : null;
  const favourites: IconName[] = [...(picked ? [picked] : []), ...FOLDER_ICONS.filter((name) => `i:${name}` !== PLAIN_FOLDER)];

  const cell = (name: IconName, stored: string, label: string) => {
    const on = value === stored;
    return (
      <button key={stored} type="button" role="radio" aria-checked={on} aria-label={label} title={label} className={`iconpick__btn ${on ? 'is-on' : ''}`} onClick={() => onChange(stored)}>
        <Icon name={name} />
      </button>
    );
  };

  return (
    <div className="iconlib" style={lineVars(color)}>
      <FindField
        value={q}
        onChange={(v) => {
          // A search starts from everything; the groups then narrow it.
          if (!q.trim() && v.trim()) setGroup(null);
          setQ(v);
          setShown(PAGE);
        }}
        placeholder="Search icons"
      />
      <div className="iconlib__groups" role="radiogroup" aria-label="Icon groups">
        <button type="button" role="radio" aria-checked={group === null} className={`token ${group === null ? 'is-on' : ''}`} onClick={() => setGroup(null)}>
          {q.trim() ? 'All' : 'Favourites'}
        </button>
        {LIB_GROUPS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="radio"
            aria-checked={group === x.id}
            className={`token ${group === x.id ? 'is-on' : ''}`}
            onClick={() => {
              setGroup(group === x.id ? null : x.id);
              setShown(PAGE);
            }}
          >
            {x.label}
          </button>
        ))}
      </div>

      {browsing ? (
        <>
          <div className="iconpick iconlib__grid" role="radiogroup" aria-label="Icons">
            {!lib ? <p className="iconlib__note">Opening the library…</p> : null}
            {lib && !found.length ? <p className="iconlib__note">No icon called “{q.trim()}”. Try another word, or type an emoji.</p> : null}
            {found.slice(0, shown).map((name) => cell(`x:${name}`, `x:${name}`, name.replace(/-/g, ' ')))}
          </div>
          {found.length > shown ? (
            <TextButton onClick={() => setShown(shown + PAGE * 2)} className="iconlib__more">
              {found.length - shown} more
            </TextButton>
          ) : null}
        </>
      ) : (
        <div className="iconpick" role="radiogroup" aria-label="Icon">
          <button type="button" role="radio" aria-checked={plain} aria-label="No icon" className={`iconpick__btn ${plain ? 'is-on' : ''}`} onClick={() => onChange(PLAIN_FOLDER)}>
            <span className="iconpick__none" />
          </button>
          {favourites.map((name) => cell(name, name.startsWith('x:') ? name : `i:${name}`, name.replace(/^x:/, '').replace(/-/g, ' ')))}
          <label className={`iconpick__btn iconpick__emoji ${g?.kind === 'emoji' ? 'is-on' : ''}`}>
            <input
              value={emoji}
              placeholder="🙂"
              aria-label="Or type an emoji"
              onChange={(e) => {
                const v = firstGrapheme(e.target.value.replace(emoji, '')) || firstGrapheme(e.target.value);
                setEmoji(v);
                onChange(v);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

/** A card's icon, sitting right on the card: tap it to pick another (the picker opens under the card). */
export function CardIcon({ icon, open, onToggle }: { icon: string | undefined; open: boolean; onToggle: () => void }) {
  const has = showsGlyph(icon);
  return (
    <button type="button" className={`cardicon ${has ? '' : 'is-empty'} ${open ? 'is-open' : ''}`} aria-label={has ? 'Icon: tap to change it' : 'Pick an icon'} aria-expanded={open} onClick={onToggle}>
      {has ? <Glyph icon={icon} className="cardicon__glyph" /> : <Icon name={G.add} className="icon--sm" />}
    </button>
  );
}

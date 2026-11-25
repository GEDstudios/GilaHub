import { useState } from 'react';
import type { LineColor } from '../../core/model';
import { Icon } from '../ui/Icon';
import { lineVars } from '../ui/primitives';
import { parseGlyph, PLAIN_FOLDER, PROJECT_ICONS } from '../ui/ProjectMark';

const firstGrapheme = (s: string): string => {
  const t = s.trim();
  if (!t) return '';
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)) return segment;
  return [...t][0];
};

/** Pick a line icon, type any emoji, or keep it plain. */
export function IconPicker({ value, color, onChange }: { value: string | undefined; color: LineColor; onChange: (icon: string) => void }) {
  const g = parseGlyph(value);
  const plain = !g || value === PLAIN_FOLDER;
  const [emoji, setEmoji] = useState(g?.kind === 'emoji' ? g.text : '');
  return (
    <div className="iconpick" role="radiogroup" aria-label="Icon" style={lineVars(color)}>
      <button type="button" role="radio" aria-checked={plain} aria-label="No icon" className={`iconpick__btn ${plain ? 'is-on' : ''}`} onClick={() => onChange(PLAIN_FOLDER)}>
        <span className="iconpick__none" />
      </button>
      {PROJECT_ICONS.filter((name) => `i:${name}` !== PLAIN_FOLDER).map((name) => {
        const on = g?.kind === 'icon' && g.name === name;
        return (
          <button key={name} type="button" role="radio" aria-checked={on} aria-label={name} className={`iconpick__btn ${on ? 'is-on' : ''}`} onClick={() => onChange(`i:${name}`)}>
            <Icon name={name} />
          </button>
        );
      })}
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
  );
}

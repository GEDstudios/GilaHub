import { useEffect, useRef, useState } from 'react';

/**
 * A title edited in place: a borderless textarea that grows with its text. Enter saves,
 * an empty title goes back to what it was. Used on the item's and the project's color card.
 */
export function AutoTitle({ value, onSave, readOnly, label = 'Title' }: { value: string; onSave: (v: string) => void; readOnly?: boolean; label?: string }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [v]);
  return (
    <textarea
      ref={ref}
      className="hero__titleinput"
      dir="auto"
      rows={1}
      value={v}
      readOnly={readOnly}
      aria-label={label}
      enterKeyHint="done"
      onChange={(e) => setV(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === 'Escape') {
          setV(value);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      onBlur={() => {
        const t = v.trim();
        if (t && t !== value) onSave(t);
        else setV(value);
      }}
    />
  );
}

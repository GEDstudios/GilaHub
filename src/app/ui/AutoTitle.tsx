import { useEffect, useRef, useState } from 'react';

/**
 * A title edited in place: a borderless textarea that grows with its text. Enter saves,
 * an empty title goes back to what it was. Used on the item's and the project's color card.
 */
export function AutoTitle({
  value,
  onSave,
  readOnly,
  label = 'Title',
  className = 'hero__titleinput',
  placeholder,
  optional = false,
}: {
  value: string;
  onSave: (v: string) => void;
  readOnly?: boolean;
  label?: string;
  className?: string;
  placeholder?: string;
  /** It can be left empty (a description), and emptying it saves that. */
  optional?: boolean;
}) {
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
      className={className}
      dir="auto"
      rows={1}
      value={v}
      placeholder={placeholder}
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
        if ((t || optional) && t !== value) onSave(t);
        else setV(value);
      }}
    />
  );
}

/**
 * A name being written (a new project's): the same growing, wrapping field, one paragraph long.
 * Enter is "done" (it submits the form it's in), not a new line.
 */
export function GrowField({
  value,
  onChange,
  className,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  label: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      className={className}
      dir="auto"
      rows={1}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      data-autofocus
      enterKeyHint="done"
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).form?.requestSubmit();
        }
      }}
    />
  );
}

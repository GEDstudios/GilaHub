import { leavingByBack } from '../router';
import { useEffect, useRef, useState, useLayoutEffect, type RefObject } from 'react';

/**
 * A title edited in place: a borderless textarea that grows with its text. Enter saves,
 * an empty title goes back to what it was. Used on the item's and the folder's color card.
 */
export function AutoTitle({
  value,
  onSave,
  readOnly,
  label = 'Title',
  className = 'hero__titleinput',
  placeholder,
  optional = false,
  onDraft,
}: {
  value: string;
  onSave: (v: string) => void;
  readOnly?: boolean;
  label?: string;
  className?: string;
  placeholder?: string;
  /** It can be left empty (a description), and emptying it saves that. */
  optional?: boolean;
  /** What's written right now, not saved yet (null once saved or put back): for the page's Back question. */
  onDraft?: (v: string | null) => void;
}) {
  const [v, setV] = useState(value);
  const ref = useAutosize(v);
  useEffect(() => setV(value), [value]);
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
      onChange={(e) => {
        const next = e.target.value.replace(/\n/g, ' ');
        setV(next);
        onDraft?.(next.trim() && next.trim() !== value ? next : null);
      }}
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
        // Left by the phone's Back: the page asks (keep or put back), with what's written still here.
        if (leavingByBack() && onDraft) return;
        if (leavingByBack()) setV(value);
        else if ((t || optional) && t !== value) onSave(t);
        else setV(value);
        onDraft?.(null);
      }}
    />
  );
}

/**
 * A name being written (a new folder's): the same growing, wrapping field, one paragraph long.
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
  const ref = useAutosize(value);
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

/** A textarea that grows with what's in it (one line to start). Pass a ref of your own to share it. */
export function useAutosize(value: string, own?: RefObject<HTMLTextAreaElement | null>) {
  const mine = useRef<HTMLTextAreaElement>(null);
  const ref = own ?? mine;
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [ref, value]);
  return ref;
}

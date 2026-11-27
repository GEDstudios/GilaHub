import { useEffect, useRef, useState } from 'react';
import { afterSheets, leavingByBack, sheetOpened } from '../router';
import { Sheet, useOverlays } from './overlays';
import { G } from './glyphs';
import { Choices } from './primitives';

/**
 * Unsaved changes, and the phone's Back: once something's been written or changed and not kept
 * yet, Back doesn't just leave. It asks: Save, or Discard. Back again on the question leaves,
 * keeping the work (Save); closing it with × or a pull keeps you where you were. (The app's own
 * back arrow saves and leaves without asking.)
 */
export function useBackGuard({
  dirty,
  title,
  text,
  saveLabel = 'Save',
  discardLabel = 'Discard',
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  title: string;
  text?: string;
  saveLabel?: string;
  discardLabel?: string;
  /** Keep it, then leave. */
  onSave: () => void;
  /** Throw it away, then leave. */
  onDiscard: () => void;
}) {
  const { openSheet } = useOverlays();
  const [arm, setArm] = useState(0);
  const latest = useRef({ title, text, saveLabel, discardLabel, onSave, onDiscard });
  latest.current = { title, text, saveLabel, discardLabel, onSave, onDiscard };

  const question = () =>
    openSheet((close) => (
      <LeaveSheet
        {...latest.current}
        onClose={close}
        onSave={() => afterSheets(() => latest.current.onSave())}
        onDiscard={() => afterSheets(() => latest.current.onDiscard())}
        onKeep={() => setArm((n) => n + 1)}
      />
    ));

  // While there's something unsaved, Back is ours first.
  useEffect(() => {
    if (!dirty) return;
    let popped = false;
    const step = sheetOpened(() => {
      popped = true;
      question();
    });
    return () => {
      if (!popped) step.closed();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, arm]);

  return {
    /** For an in-app back: true when it asked (so don't leave yet). */
    ask: (): boolean => {
      if (!dirty) return false;
      question();
      return true;
    },
  };
}

function LeaveSheet({
  title,
  text,
  saveLabel,
  discardLabel,
  onClose,
  onSave,
  onDiscard,
  onKeep,
}: {
  title: string;
  text?: string;
  saveLabel: string;
  discardLabel: string;
  onClose: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onKeep: () => void;
}) {
  const chose = useRef(false);
  // Closed without choosing: Back again means "just leave", keeping the work (its first choice);
  // × or a pull means "not yet", back to writing.
  useEffect(
    () => () => {
      if (chose.current) return;
      if (leavingByBack()) afterSheets(onSave);
      else onKeep();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const pick = (fn: () => void) => {
    chose.current = true;
    onClose();
    fn();
  };
  return (
    <Sheet onClose={onClose} title={title}>
      {text ? <p className="sheet__lede">{text}</p> : null}
      <Choices
        choices={[
          { label: saveLabel, icon: G.done, run: () => pick(onSave) },
          { label: discardLabel, icon: G.delete, quiet: true, danger: true, run: () => pick(onDiscard) },
        ]}
      />
    </Sheet>
  );
}

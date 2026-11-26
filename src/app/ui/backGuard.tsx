import { useEffect, useRef, useState } from 'react';
import { afterSheets, sheetOpened } from '../router';
import { Icon } from './Icon';
import { Sheet, useOverlays } from './overlays';

/**
 * Unsaved changes, and Back: once something's been written or changed and not kept yet, the
 * phone's Back (or the page's own back arrow, through `ask`) doesn't just leave. It asks: Save,
 * or Discard; closing the question (or Back again) keeps you where you were, still writing.
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
  // Closed without choosing (×, a pull, Back): keep writing.
  useEffect(
    () => () => {
      if (!chose.current) onKeep();
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
      <div className="leaveq">
        <button type="button" className="btn btn--block" onClick={() => pick(onSave)}>
          <Icon name="check" className="icon--sm" />
          {saveLabel}
        </button>
        <button type="button" className="btn btn--block btn--quiet leaveq__discard" onClick={() => pick(onDiscard)}>
          <Icon name="trash" className="icon--sm" />
          {discardLabel}
        </button>
      </div>
    </Sheet>
  );
}

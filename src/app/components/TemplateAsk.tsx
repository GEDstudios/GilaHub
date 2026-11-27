import { useEffect, useRef } from 'react';
import type { Hub } from '../../core/actions';
import { useHub } from '../context';
import { applyTemplate, hasTemplate, templateSummary } from '../template';
import { Sheet, useOverlays } from '../ui/overlays';
import { G } from '../ui/glyphs';
import { Choices } from '../ui/primitives';

type Overlays = ReturnType<typeof useOverlays>;

/**
 * A task just moved: say so (with its Undo). Into a folder with a task template, first ask whether
 * it takes the template; nothing changes unless I say so, and the "Moved" line waits for the answer.
 */
export function movedTo(hub: Hub, overlays: Overlays, id: string, from: string | null, to: string, text: string, undoMove: () => void): void {
  if (from === to || !hasTemplate(hub.list(to))) {
    overlays.toast(text, { action: { label: 'Undo', run: undoMove } });
    return;
  }
  overlays.openSheet((close) => <TemplateAskSheet id={id} listId={to} text={text} undoMove={undoMove} onClose={close} />);
}

function TemplateAskSheet({ id, listId, text, undoMove, onClose }: { id: string; listId: string; text: string; undoMove: () => void; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const list = hub.list(listId);
  const item = hub.item(id);
  const used = useRef(false);
  // Closed any way but "Use it": just moved.
  useEffect(
    () => () => {
      if (!used.current) toast(text, { action: { label: 'Undo', run: undoMove } });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  if (!list || !item || !hasTemplate(list)) return null;
  return (
    <Sheet onClose={onClose} title={`Use ${list.name}’s template?`}>
      <p className="sheet__lede" dir="auto">
        {templateSummary(hub, list.template)}
      </p>
      <Choices
        choices={[
          {
            label: 'Use it',
            icon: G.template,
            run: () => {
              const undo = applyTemplate(hub, id, listId);
              used.current = true;
              onClose();
              toast(`${text}, with its template`, {
                action: {
                  label: 'Undo',
                  run: () => {
                    undo();
                    undoMove();
                  },
                },
              });
            },
          },
          { label: 'Keep it as it is', quiet: true, run: onClose },
        ]}
      />
    </Sheet>
  );
}

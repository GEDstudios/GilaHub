import { useState } from 'react';
import { categoryMeta, categoryOrder } from '../../smart/categorize';
import { aisleIcon } from '../aisles';
import { useHub } from '../context';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { ListBullet } from '../ui/primitives';
import { allowedVis, itemVisChoice, setItemVis } from '../privacy';
import { EChip, Options, Panel, VisChip } from './editors';
import { OptRow } from './pickers';
import { usePingUrgent } from './shopAdd';

type Open = 'aisle' | 'list' | 'vis' | null;

/**
 * One thing to buy, edited in place: its name, then a row of chips (how many, which aisle,
 * urgent, which list, who sees it) whose panels open right below, and a note.
 */
export function ShopItemSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const pingUrgent = usePingUrgent();
  const item = hub.item(id);
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [open, setOpen] = useState<Open>(null);
  if (!item) return null;
  const list = hub.list(item.listId);
  const flavor = hub.flavorOf(list);
  const { category } = hub.categoryFor(item);
  const meta = categoryMeta(flavor, category);
  const editable = hub.canEdit(item);
  const vis = itemVisChoice(hub, item);
  const partner = hub.partner();
  const lists = hub.shoppingLists();
  const qtyNum = item.qty && /^\d+$/.test(item.qty) ? +item.qty : null;
  const toggle = (k: Exclude<Open, null>) => setOpen(open === k ? null : k);
  const icon = aisleIcon(flavor, category);

  const commitTitle = () => {
    const t = title.trim();
    if (t && t !== item.title) hub.updateItem(id, { title: t });
  };
  const commitNotes = () => {
    if (notes !== (item.notes ?? '')) hub.updateItem(id, { notes });
  };

  return (
    <Sheet onClose={() => (commitTitle(), commitNotes(), onClose())} label={item.title}>
      <input
        className="sheet__titleinput"
        value={title}
        dir="auto"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        readOnly={!editable}
        aria-label="Name"
      />

      <div className="inline__chips sheet__chips">
        <span className="stepper">
          <button type="button" aria-label="Less" disabled={!editable || !qtyNum || qtyNum <= 1} onClick={() => hub.updateItem(id, { qty: qtyNum && qtyNum > 2 ? String(qtyNum - 1) : null })}>
            −
          </button>
          <input className="num" value={item.qty ?? ''} placeholder="1" readOnly={!editable} onChange={(e) => hub.updateItem(id, { qty: e.target.value || null })} aria-label="Quantity" />
          <button type="button" aria-label="More" disabled={!editable} onClick={() => hub.bump(id)}>
            +
          </button>
        </span>

        <EChip
          label={meta.en}
          icon={icon}
          lead={icon ? undefined : <span aria-hidden="true">{meta.e}</span>}
          set
          open={open === 'aisle'}
          onToggle={() => toggle('aisle')}
          disabled={!editable}
        />
        {open === 'aisle' ? (
          <Panel>
            <Options
              value={category}
              onPick={(c) => {
                hub.setCategory(id, c);
                setOpen(null);
              }}
              options={categoryOrder(flavor).map((c) => {
                const m = categoryMeta(flavor, c);
                const i = aisleIcon(flavor, c);
                return { value: c, label: i ? m.en : `${m.e} ${m.en}`, icon: i };
              })}
            />
          </Panel>
        ) : null}

        <button
          type="button"
          className={`echip ${item.urgent ? 'is-urgent' : ''}`}
          onClick={() => {
            hub.updateItem(id, { urgent: !item.urgent });
            if (!item.urgent) pingUrgent(item, false);
          }}
          aria-pressed={!!item.urgent}
          disabled={!editable}
        >
          <Icon name="urgent" className="icon--sm" />
          <span>Urgent</span>
        </button>

        {lists.length > 1 && editable ? (
          <>
            <EChip label={list?.name ?? 'List'} lead={<ListBullet list={list} size="xs" />} set open={open === 'list'} onToggle={() => toggle('list')} />
            {open === 'list' ? (
              <Panel>
                <Options
                  value={item.listId}
                  onPick={(lid) => {
                    hub.move(id, { listId: lid });
                    setOpen(null);
                  }}
                  options={lists.map((l) => ({
                    value: l.id,
                    label: (
                      <>
                        <ListBullet list={l} size="xs" />
                        <span dir="auto">{l.name}</span>
                      </>
                    ),
                  }))}
                />
              </Panel>
            ) : null}
          </>
        ) : null}

        {editable && hub.canSetPrivacy(item) ? (
          <VisChip
            value={vis}
            allowed={allowedVis(hub, list)}
            open={open === 'vis'}
            onToggle={() => toggle('vis')}
            onChange={(nv) => {
              if (nv === 'private' && vis !== 'private' && partner) toast(`Hidden from ${partner.name}`);
              setItemVis(hub, id, nv);
            }}
          />
        ) : null}
      </div>

      <textarea
        className="notes"
        dir="auto"
        rows={2}
        placeholder="Add a note…"
        value={notes}
        readOnly={!editable}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commitNotes}
        aria-label="Note"
      />

      {editable ? (
        <div className="group sheet__end">
          <OptRow
            icon="trash"
            title="Remove from list"
            danger
            onClick={() => {
              const undo = hub.delete(id);
              onClose();
              toast(`Removed ${item.title}`, { action: { label: 'Undo', run: undo } });
            }}
          />
        </div>
      ) : null}
    </Sheet>
  );
}

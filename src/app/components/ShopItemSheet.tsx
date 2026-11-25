import { useState } from 'react';
import type { ItemVisibility } from '../../core/actions';
import { categoryMeta } from '../../smart/categorize';
import { useHub } from '../context';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { lineVars } from '../ui/primitives';
import { Options, visHint } from './editors';
import { AisleSheet } from './pickers';

export function ShopItemSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const hub = useHub();
  const { openSheet, toast } = useOverlays();
  const item = hub.item(id);
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  if (!item) return null;
  const list = hub.list(item.listId);
  const flavor = hub.flavorOf(list);
  const { category } = hub.categoryFor(item);
  const meta = categoryMeta(flavor, category);
  const editable = hub.canEdit(item);
  const vis = hub.visibilityOf(item);
  const partnerName = hub.partner()?.name ?? 'your partner';
  const lists = hub.shoppingLists();
  const qtyNum = item.qty && /^\d+$/.test(item.qty) ? +item.qty : null;

  const commitTitle = () => {
    const t = title.trim();
    if (t && t !== item.title) hub.updateItem(id, { title: t });
  };

  return (
    <Sheet onClose={() => (commitTitle(), onClose())} label={item.title}>
      <div className="ccard ccard--md ccard--edit" style={lineVars(list?.color)}>
        <input className="ccard__input" value={title} dir="auto" onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle} readOnly={!editable} aria-label="Name" />
        <span className="ccard__sub">
          {list?.name} · {meta.en}
        </span>
      </div>
      {!editable ? <p className="hint">This is {hub.member(hub.ownerOf(item))?.name}’s. You can still tick it off.</p> : null}

      <div className="choose">
        <span className="choose__label">How many</span>
        <div className="options">
          <span className="stepper">
            <button type="button" aria-label="Less" disabled={!editable || !qtyNum || qtyNum <= 1} onClick={() => hub.updateItem(id, { qty: qtyNum && qtyNum > 2 ? String(qtyNum - 1) : null })}>
              −
            </button>
            <input
              className="num"
              value={item.qty ?? ''}
              placeholder="1"
              readOnly={!editable}
              onChange={(e) => hub.updateItem(id, { qty: e.target.value || null })}
              aria-label="Quantity"
            />
            <button type="button" aria-label="More" disabled={!editable} onClick={() => hub.bump(id)}>
              +
            </button>
          </span>
          <button
            type="button"
            className={`option ${item.urgent ? 'is-urgent' : ''}`}
            onClick={() => editable && hub.updateItem(id, { urgent: !item.urgent })}
            aria-pressed={!!item.urgent}
          >
            <span className="echip__diamond" aria-hidden="true" /> Urgent
          </button>
          <button
            type="button"
            className="option"
            disabled={!editable}
            onClick={() => openSheet((close) => <AisleSheet onClose={close} flavor={flavor} value={category} onPick={(c) => hub.setCategory(id, c)} />)}
          >
            {meta.en} <Icon name="chevron-down" className="icon--sm" />
          </button>
        </div>
      </div>

      {lists.length > 1 && editable ? (
        <div className="choose">
          <span className="choose__label">List</span>
          <Options value={item.listId} onPick={(lid) => hub.move(id, { listId: lid })} options={lists.map((l) => ({ value: l.id, label: l.name }))} />
        </div>
      ) : null}

      {editable ? (
        <div className="choose">
          <span className="choose__label">Who it’s for</span>
          <Options
            value={vis}
            onPick={(nv) => {
              if (nv === 'private' && vis !== 'private' && hub.partner()) toast(`Hidden from ${partnerName}`);
              hub.setItemVisibility(id, nv as ItemVisibility);
            }}
            options={(list?.visibility === 'private' ? (['private'] as const) : (['ours', 'mine', 'private'] as const)).map((v) => ({
              value: v,
              label: v === 'ours' ? 'Both of us' : v === 'mine' ? 'Me' : 'Only me',
              icon: v === 'ours' ? ('ours' as const) : v === 'mine' ? ('mine' as const) : ('lock' as const),
            }))}
          />
          <p className="panel__hint">{vis === 'mine' ? 'Marked as yours. Anyone can still buy it.' : visHint(vis, partnerName)}</p>
        </div>
      ) : null}

      <textarea
        className="notes"
        dir="auto"
        rows={2}
        placeholder="Add a note: brand, size, “the blue one”…"
        value={notes}
        readOnly={!editable}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== (item.notes ?? '') && hub.updateItem(id, { notes })}
        aria-label="Note"
      />

      {editable ? (
        <button
          type="button"
          className="textbtn textbtn--danger"
          onClick={() => {
            const undo = hub.delete(id);
            onClose();
            toast(`Removed ${item.title}`, { action: { label: 'Undo', run: undo } });
          }}
        >
          <Icon name="trash" className="icon--sm" /> Remove from list
        </button>
      ) : null}
    </Sheet>
  );
}

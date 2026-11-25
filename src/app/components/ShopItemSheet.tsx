import { useState } from 'react';
import { categoryMeta } from '../../smart/categorize';
import { useHub } from '../context';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { ListBullet, Seg, Switch } from '../ui/primitives';
import { AisleSheet, OptRow, VIS_HINT, VisibilityControl } from './pickers';

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
      <input
        className="titleinput"
        value={title}
        dir="auto"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        readOnly={!editable}
        aria-label="Name"
        style={{ paddingRight: 44 }}
      />
      {!editable ? <p className="hint" style={{ margin: '6px 0 0' }}>This is {hub.member(hub.ownerOf(item))?.name}’s — you can still tick it off.</p> : null}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="optrow">
          <span className="optrow__icon">
            <Icon name="tag" className="icon--sm" />
          </span>
          <span className="optrow__text">How many</span>
          <button type="button" className="iconbtn" aria-label="Less" disabled={!editable || !qtyNum || qtyNum <= 1} onClick={() => hub.updateItem(id, { qty: qtyNum && qtyNum > 2 ? String(qtyNum - 1) : null })}>
            −
          </button>
          <input
            className="input num"
            style={{ width: 92, height: 40, textAlign: 'center', fontSize: 16 }}
            value={item.qty ?? ''}
            placeholder="—"
            readOnly={!editable}
            onChange={(e) => hub.updateItem(id, { qty: e.target.value || null })}
            aria-label="Quantity"
          />
          <button type="button" className="iconbtn" aria-label="More" disabled={!editable} onClick={() => hub.bump(id)}>
            <Icon name="plus" className="icon--sm" />
          </button>
        </div>
        <OptRow
          lead={<span className="optrow__icon" style={{ fontSize: 17 }}>{meta.e}</span>}
          title="Aisle"
          value={meta.en}
          disabled={!editable}
          onClick={() => openSheet((close) => <AisleSheet onClose={close} flavor={flavor} value={category} onPick={(c) => hub.setCategory(id, c)} />)}
        />
        <div className="optrow">
          <span className="optrow__icon">◆</span>
          <span className="optrow__text">
            Urgent <span className="optrow__sub">Pins it to the top</span>
          </span>
          <Switch on={!!item.urgent} onChange={(on) => hub.updateItem(id, { urgent: on })} label="Urgent" />
        </div>
      </div>

      {lists.length > 1 && editable ? (
        <div className="field">
          <span className="field__label">List</span>
          <Seg
            label="List"
            value={item.listId}
            onChange={(lid) => hub.move(id, { listId: lid })}
            options={lists.map((l) => ({
              value: l.id,
              label: (
                <>
                  <ListBullet list={l} size="xs" /> <span dir="auto">{l.name}</span>
                </>
              ),
            }))}
          />
        </div>
      ) : null}

      {editable ? (
        <div className="field">
          <span className="field__label">Who can see it</span>
          <VisibilityControl
            value={vis}
            allowed={list?.visibility === 'private' ? ['private'] : ['ours', 'mine', 'private']}
            partnerName={partnerName}
            onChange={(nv) => {
              if (nv === 'private' && vis !== 'private' && hub.partner()) toast(`Hidden from ${partnerName}`);
              hub.setItemVisibility(id, nv);
            }}
          />
          <p className="hint" style={{ margin: '8px 2px 0' }}>{vis === 'mine' ? 'Marked as for you — anyone can still buy it.' : VIS_HINT(vis, partnerName)}</p>
        </div>
      ) : null}

      <div className="field">
        <span className="field__label">Note</span>
        <textarea
          className="input"
          dir="auto"
          rows={2}
          style={{ minHeight: 64 }}
          placeholder="Brand, size, “the blue one”…"
          value={notes}
          readOnly={!editable}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (item.notes ?? '') && hub.updateItem(id, { notes })}
        />
      </div>

      {editable ? (
        <button
          type="button"
          className="btn btn--ghost btn--block"
          style={{ marginTop: 18 }}
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

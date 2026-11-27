import { useState } from 'react';
import type { Item, List } from '../../core/model';
import { PlaceTree } from '../components/PlaceTree';
import { stockTone, useStockSet } from '../components/StockCount';
import { PathCrumbs } from '../components/PathCrumbs';
import { useHub } from '../context';
import { getPrefs, setPrefs, usePrefs } from '../prefs';
import { navigate } from '../router';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, ListBullet, Section, Stepper } from '../ui/primitives';
import { TOAST } from '../ui/tokens';
import { G } from '../ui/glyphs';

/**
 * Stock: everything we count, from every folder, in one place. What's running low first (and
 * where it went to be bought), then each folder's. − / + right on each line; tap a name for the
 * rest (its levels, where it goes). Add something new to count right here. Nothing here is ever
 * "done", so nothing is cleared away.
 */
export function StockScreen() {
  const hub = useHub();
  const prefs = usePrefs();
  const { openSheet, toast } = useOverlays();
  const [name, setName] = useState('');
  const all = hub.stockItems().sort((a, b) => a.title.localeCompare(b.title));
  const low = all.filter((i) => hub.stockLow(i));
  const byFolder = new Map<string, Item[]>();
  for (const i of all) if (!hub.stockLow(i)) byFolder.set(i.listId, [...(byFolder.get(i.listId) ?? []), i]);
  const home = hub.list(prefs.stockFolder ?? undefined);

  // Where new ones go: my choice, else a "Stock" folder (made the first time).
  const homeFolder = (): string => {
    const chosen = hub.list(getPrefs().stockFolder ?? undefined);
    if (chosen) return chosen.id;
    const made = hub.createList({ name: 'Stock', icon: 'i:package' });
    setPrefs({ stockFolder: made });
    return made;
  };
  const add = () => {
    const title = name.trim();
    if (!title) return;
    const listId = homeFolder();
    const id = hub.addItem(listId, { title });
    hub.setStock(id, { stock: 2, stockFull: 4, stockAddAt: 1, stockUrgentAt: 0 });
    setName('');
    haptic('tick');
    toast(`${title}: 2 of 4`, { ms: TOAST.short });
  };
  const pickHome = () =>
    openSheet((close) => (
      <Sheet onClose={close} title="New things to count go in…">
        <PlaceTree
          value={home ? { listId: home.id, parentId: null } : null}
          onPick={(p) => {
            if (p) setPrefs({ stockFolder: p.listId });
            close();
          }}
        />
      </Sheet>
    ));

  return (
    <>
      <Band crumbs={<PathCrumbs steps={[{ key: 'projects', label: 'Folders', go: () => navigate({ name: 'lists' }) }]} />} title="Stock" sub={all.length ? `${all.length} ${all.length === 1 ? 'thing' : 'things'}${low.length ? ` · ${low.length} running low` : ''}` : 'What you keep at home, counted'} />
      <div className="column stock">
        <div className="stockadd">
          <input
            className="field stockadd__field"
            dir="auto"
            value={name}
            placeholder="Something to count (olive oil, batteries…)"
            aria-label="Something new to count"
            enterKeyHint="done"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button type="button" className="btn stockadd__btn" disabled={!name.trim()} onClick={add} aria-label="Add">
            <Icon name={G.add} />
          </button>
        </div>
        <button type="button" className="textbtn stockadd__where" onClick={pickHome}>
          {home ? (
            <>
              Goes in <ListBullet list={home} size="xs" /> {home.name}
            </>
          ) : (
            'Goes in a Stock folder'
          )}
          <Icon name={G.fold} className="icon--xs" />
        </button>

        {low.length ? (
          <Section title="Running low" count={low.length}>
            <ul className="rows">
              {low.map((i) => (
                <StockRow key={i.id} item={i} showList />
              ))}
            </ul>
          </Section>
        ) : null}

        {[...byFolder.entries()].map(([listId, items]) => {
          const l = hub.list(listId) as List;
          return (
            <Section
              key={listId}
              title={
                <button type="button" className="section__go" onClick={() => navigate({ name: 'list', id: listId })}>
                  <ListBullet list={l} size="xs" />
                  <span dir="auto">{l.name}</span>
                  <Icon name={G.go} className="section__goarrow" />
                </button>
              }
              count={items.length}
            >
              <ul className="rows">
                {items.map((i) => (
                  <StockRow key={i.id} item={i} />
                ))}
              </ul>
            </Section>
          );
        })}

        {!all.length ? (
          <p className="hint stock__empty">
            Count anything you keep at home. When it runs low it goes on Shopping by itself, and buying it counts it back up. Any task can be counted too: Stock, on the task.
          </p>
        ) : null}
      </div>
    </>
  );
}

/** One thing we count: its name (tap for the rest), where it is or went, and − n +. */
function StockRow({ item, showList }: { item: Item; showList?: boolean }) {
  const hub = useHub();
  const set = useStockSet(item.id);
  const n = item.stock ?? 0;
  const link = item.stockLink ? hub.item(item.stockLink) : undefined;
  const onList = link && !link.done ? hub.list(link.listId) : undefined;
  const tone = stockTone(hub, item);
  return (
    <li className={`row row--tap stockrow ${tone ? `is-${tone}` : ''}`} onClick={() => navigate({ name: 'item', id: item.id })}>
      <div className="row__body">
        <span className="row__title" dir="auto">
          {item.title}
        </span>
        <span className="row__meta">
          {showList ? (
            <span className="meta">
              <ListBullet list={hub.list(item.listId)} size="xs" />
              <span dir="auto">{hub.list(item.listId)?.name}</span>
            </span>
          ) : null}
          {onList ? (
            <span className="meta meta--stock is-low">
              <Icon name={G.onList} /> On {onList.name}
            </span>
          ) : item.stockFull != null ? (
            <span className="meta">of {item.stockFull}</span>
          ) : null}
        </span>
      </div>
      <Stepper look="card" tone={tone} label={item.title} value={n} onChange={(v) => set({ stock: v ?? 0 })} />
    </li>
  );
}

import { useState } from 'react';
import type { Item, List } from '../../core/model';
import { FolderTree } from '../components/FolderTree';
import { PathCrumbs } from '../components/PathCrumbs';
import { useHub } from '../context';
import { getPrefs, setPrefs, usePrefs } from '../prefs';
import { navigate } from '../router';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, ListBullet, Section } from '../ui/primitives';

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
    hub.setStock(id, { stock: 1, stockAddAt: 1 });
    setName('');
    haptic('tick');
    toast(`${title}: counting, 1 in stock`, { ms: 1800 });
  };
  const pickHome = () =>
    openSheet((close) => (
      <Sheet onClose={close} title="New things to count go in…">
        <FolderTree
          marked={(l) => l.id === home?.id}
          onPick={(id) => {
            setPrefs({ stockFolder: id });
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
            <Icon name="plus" />
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
          <Icon name="chevron-down" className="icon--xs" />
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
                  <Icon name="chevron-right" className="section__goarrow" />
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
  const { toast } = useOverlays();
  const n = item.stock ?? 0;
  const link = item.stockLink ? hub.item(item.stockLink) : undefined;
  const onList = link && !link.done ? hub.list(link.listId) : undefined;
  const out = item.stockUrgentAt != null && n <= item.stockUrgentAt;
  const set = (next: number) => {
    const before = item.stockLink ?? null;
    const undo = hub.setStock(item.id, { stock: next });
    haptic('select');
    const now = hub.item(item.id);
    if (now?.stockLink && now.stockLink !== before) toast(`${item.title}: on ${hub.list(hub.item(now.stockLink)?.listId)?.name ?? 'the list'}`, { action: { label: 'Undo', run: undo } });
  };
  return (
    <li className={`row row--tap stockrow ${out ? 'is-out' : hub.stockLow(item) ? 'is-low' : ''}`} onClick={() => navigate({ name: 'item', id: item.id })}>
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
              <Icon name="cart" /> On {onList.name}
            </span>
          ) : (
            <span className="meta">Goes on the list at {item.stockAddAt ?? 1}</span>
          )}
        </span>
      </div>
      <span className="stepper stockrow__step" onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label={`${item.title}: one less`} disabled={n <= 0} onClick={() => set(n - 1)}>
          −
        </button>
        <span className="num stockline__n">{n}</span>
        <button type="button" aria-label={`${item.title}: one more`} onClick={() => set(n + 1)}>
          +
        </button>
      </span>
    </li>
  );
}

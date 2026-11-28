import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { Item, List } from '../../core/model';
import { useHub } from '../context';
import { navigate } from '../router';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Button, FoldButton, ListBullet, DropChip, PullHint } from '../ui/primitives';
import { Sortable, type Point } from '../ui/Sortable';
import { SettleContext, useSettle } from '../ui/useSettle';
import type { FolderGroup } from '../views';
import { ItemRow, SortableItemRow } from './ItemRow';
import { QuickAddSheet } from './QuickAddSheet';
import { movedTo } from './TemplateAsk';
import { getPrefs, setPrefs } from '../prefs';
import { usePrefs } from '../usePrefs';
import { useGroupDrag } from '../ui/groupDrag';
import { TagMark } from './Tags';
import { listIdOf } from '../../core/keys';
import { G } from '../ui/glyphs';
import { dropMarks } from '../ui/dropMark';
import { dweller, placer, unfoldTo, type Placement } from '../outline';

/** The folder under the hand, if any: one marked [data-drop-list], or a folder's tab in the bar. */
function dropListAt(p: Point): { el: HTMLElement; listId: string } | null {
  for (const e of document.elementsFromPoint(p.x, p.y)) {
    const t = e.closest<HTMLElement>('[data-drop-list], .tabbar [data-key^="l:"]');
    if (!t) continue;
    const listId = t.dataset.dropList ?? (t.dataset.key ? listIdOf(t.dataset.key) : null) ?? undefined;
    if (listId) return { el: t, listId };
  }
  return null;
}

/**
 * A folder's open things, the same for every folder: the Urgent card on top, then one group
 * (a plain list), a group per tag (the aisles, in our order), or one per folder inside. Hold a
 * row to move it; drop it in another group and it takes that tag, or moves to that folder.
 * Ticked rows strike and fold before they leave for the tray.
 */
export function FolderItems({
  groups: live,
  urgent,
  cards,
  draggable,
  showList,
  flash,
  pageId,
}: {
  /** The folder this page is (its inner folders' headings show the way down from it). */
  pageId?: string;
  groups: FolderGroup[];
  urgent: Item[];
  cards: boolean;
  draggable: boolean;
  /** Rows say which folder they're in (a tag's group mixes folders). */
  showList: boolean;
  flash: Set<string>;
}) {
  const hub = useHub();
  const overlays = useOverlays();
  const { toast, openSheet } = overlays;
  const settle = useSettle<Item>();
  const prefs = usePrefs();
  // As lists, the groups go in my order for this page (a group I never moved keeps its place
  // after the ones I did); the folders' own order isn't touched. The folder's own tasks lead.
  const mine = pageId ? (prefs.groupOrder[pageId] ?? []) : [];
  const rank = (g: FolderGroup, at: number) => (!g.label ? -1 : g.tag !== undefined || !mine.includes(g.key) ? mine.length + at : mine.indexOf(g.key));
  const ordered = live
    .map((g, at) => ({ g, r: rank(g, at), at }))
    .sort((a, b) => a.r - b.r || a.at - b.at)
    .map((x) => x.g);
  // A group whose last thing was just ticked stays until that row has settled.
  const last = useRef<FolderGroup[]>([]);
  const groups = [...ordered];
  last.current.forEach((g, at) => {
    if (!groups.some((x) => x.key === g.key) && g.items.some((i) => settle.held.has(i.id))) groups.splice(Math.min(at, groups.length), 0, { ...g, items: [] });
  });
  last.current = ordered;

  // A folder's way down from this page: the folders between, then itself (one shown from
  // elsewhere is just itself).
  const pathTo = (l: List): List[] => {
    const up = hub.listPath(l.id);
    const at = pageId ? up.findIndex((x) => x.id === pageId) : -1;
    return at < 0 ? [l] : [...up.slice(at + 1), l];
  };
  // A group can be folded to its heading (mine, remembered on my devices).
  const foldKey = (g: FolderGroup) => `${pageId ?? ''}|${g.key}`;
  const isFolded = (g: FolderGroup) => !!g.label && prefs.foldedGroups.includes(foldKey(g));
  const flipFold = (g: FolderGroup) => {
    haptic('select');
    const k = foldKey(g);
    const now = getPrefs().foldedGroups;
    setPrefs({ foldedGroups: now.includes(k) ? now.filter((x) => x !== k) : [...now, k].slice(-300) });
  };
  const ids = groups.filter((g) => !isFolded(g)).flatMap((g) => g.items.map((i) => i.id));
  const groupOf = new Map(groups.flatMap((g) => g.items.map((i) => [i.id, g] as const)));
  const lastPt = useRef<[number, number] | null>(null);
  useEffect(() => {
    const track = (e: PointerEvent) => {
      lastPt.current = [e.clientX, e.clientY];
    };
    // Where it presses too: a finger held still to lift a row never moves, and "pulled right" is
    // counted from there.
    window.addEventListener('pointerdown', track, { capture: true, passive: true });
    window.addEventListener('pointermove', track, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', track, { capture: true });
      window.removeEventListener('pointermove', track, { capture: true });
    };
  }, []);

  // Drop a task on a folder (a folder here, a step of the path, a folder in the bar): it moves there.
  const lifted = useRef<string | null>(null);
  const mark = useMemo(dropMarks, []);
  // Or among another task's subtasks, or pulled right (under the task above where it would land;
  // a folded one unfolds after a moment so it can go among them): it becomes a subtask, right
  // where the gap opens (outline.ts). The list's own drag does the reordering between tasks.
  // How the chip in the hand says it goes in (set as it aims, so the chip follows along).
  const [nesting, setNesting] = useState(false);
  const liftX = useRef<number | null>(null);
  const placed = useRef<Placement | null>(null);
  const dwell = useMemo(() => dweller(), []);
  const place = useMemo(() => placer(hub, { among: false }), [hub]);
  const placeHere = (p: Point): Placement | null => {
    const item = hub.item(lifted.current);
    if (!item) return null;
    const pl = place(item, p, liftX.current ?? p.x);
    if (pl !== 'keep') placed.current = pl;
    return placed.current;
  };
  const into = {
    hit: (p: Point) => {
      if (placeHere(p)) return true;
      const t = dropListAt(p);
      return !!t && t.listId !== hub.item(lifted.current)?.listId;
    },
    // Under a task: it darkens and a gap opens where it goes; into a folder: it darkens.
    aim: (p: Point | null) => {
      const pl = p ? placed.current : null;
      mark(pl ? { into: pl.into, gap: pl.gap } : { into: (p && dropListAt(p)?.el) || null });
      dwell.at(pl?.unfold);
      if (p && !!pl !== nesting) setNesting(!!pl);
    },
    drop: (id: string, p: Point) => {
      const pl = placed.current;
      mark(null);
      dwell.stop();
      const item = hub.item(id);
      if (pl && item) {
        const was = { listId: item.listId, parentId: item.parentId ?? null };
        hub.move(id, { listId: pl.listId, parentId: pl.parentId, before: pl.before ?? undefined });
        unfoldTo(pl.parentId);
        haptic('success');
        movedTo(hub, overlays, id, was.listId, was.listId, `${item.title}: under “${hub.item(pl.parentId)?.title ?? 'it'}”`, () => hub.move(id, was));
        return;
      }
      const t = dropListAt(p);
      const to = hub.list(t?.listId);
      if (!t || !item || !to) return;
      const was = { listId: item.listId, parentId: item.parentId ?? null };
      hub.move(id, { listId: to.id, parentId: null });
      haptic('success');
      movedTo(hub, overlays, id, was.listId, to.id, `Moved to ${to.name}`, () => hub.move(id, was));
    },
    lift: (id: string) => {
      lifted.current = id;
      liftX.current = lastPt.current?.[0] ?? null;
      placed.current = null;
    },
    end: () => {
      lifted.current = null;
      liftX.current = null;
      placed.current = null;
      mark(null);
      dwell.stop();
      setNesting(false);
    },
  };

  const onMove = (next: string[], id: string) => {
    const from = groupOf.get(id);
    if (!from) return;
    const at = next.indexOf(id);
    // Where it landed: the group under the hand, else the one it now sits beside.
    const pt = lastPt.current;
    const key = pt ? document.elementsFromPoint(pt[0], pt[1]).map((e) => e.closest('[data-group]')?.getAttribute('data-group')).find(Boolean) : null;
    const to = groups.find((g) => g.key === key) ?? groupOf.get(next[at - 1]) ?? groupOf.get(next[at + 1]) ?? from;
    if (to !== from) {
      if (to.tag !== undefined) {
        hub.moveToTag(id, from.tag ?? null, to.tag);
        toast(to.tag ? `Tagged ${hub.tag(to.tag)?.name ?? ''}` : 'Untagged');
      } else if (to.listId) {
        const item = hub.item(id);
        const was = { listId: item?.listId ?? from.listId ?? to.listId, parentId: item?.parentId ?? null };
        hub.move(id, { listId: to.listId });
        // From group to group is a move like any other: a folder with a template asks about it.
        movedTo(hub, overlays, id, was.listId, to.listId, `Moved to ${hub.list(to.listId)?.name ?? 'there'}`, () => hub.move(id, was));
      }
      haptic('drop');
    }
    hub.reorderIn(
      next.filter((x) => x === id || groupOf.get(x) === to),
      id,
    );
  };

  // By tag: a tag's heading drags its whole group up or down. That's our tag order (it's the
  // same everywhere: the walk through the store), so both of us see it.
  // As lists: any folder's group moves among the others, in my order for this page only.
  const sortScope = (g: FolderGroup): string | null => {
    if (g.tag) return 'tags';
    return g.listId && g.label && pageId ? 'lists' : null;
  };
  const tagGroups = groups.filter((g) => g.tag).map((g) => g.tag as string);
  const sortable = groups.filter((g) => sortScope(g)).length > 1;
  useGroupDrag(sortable, (key, beforeKey) => {
    const g = groups.find((x) => x.key === key);
    const b = beforeKey ? groups.find((x) => x.key === beforeKey) : undefined;
    if (!g) return;
    if (g.tag) {
      const tag = g.tag;
      const before = b?.tag ?? null;
      const was = hub.tags().map((t) => t.id);
      const rest = was.filter((x) => x !== tag);
      const at = before ? rest.indexOf(before) : rest.indexOf(tagGroups.filter((x) => x !== tag).at(-1) ?? '') + 1;
      rest.splice(at < 0 ? rest.length : at, 0, tag);
      if (rest.join() === was.join()) return;
      hub.arrangeTags(rest);
      toast(`${hub.tag(tag)?.name ?? 'Tag'} moved`, { undo: () => hub.arrangeTags(was) });
    } else if (g.listId && pageId) {
      const keys = groups.filter((x) => sortScope(x) === 'lists').map((x) => x.key);
      const next = keys.filter((k) => k !== key);
      const at = b ? next.indexOf(b.key) : next.length;
      next.splice(at < 0 ? next.length : at, 0, key);
      const was = getPrefs().groupOrder;
      setPrefs({ groupOrder: { ...was, [pageId]: next } });
      toast(`${g.label} moved`, { undo: () => setPrefs({ groupOrder: was }) });
    }
  });

  const rowsClass = `rows ${cards ? 'rows--cards' : ''}`;
  const shownUrgent = settle.view('urgent', urgent);
  const body = (
    <>
      {groups.map((g) => {
        const shown = settle.view(g.key, g.items);
        // An empty group says nothing (the folder's own, too, while its folders inside have tasks).
        if (!shown.length && (g.label || groups.length > 1)) return null;
        const list = g.listId ? hub.list(g.listId) : undefined;
        // Rows name their folder only where the group mixes folders.
        const mixed = showList && new Set(g.items.map((i) => i.listId)).size > 1;
        return (
          <section key={g.key} className={`aisle ${g.label ? '' : 'aisle--plain'} ${isFolded(g) ? 'is-folded' : ''}`} aria-label={g.label ?? undefined} data-group={g.key} data-list={g.listId ?? undefined} data-tag={g.tag ?? undefined} data-sort={sortable && sortScope(g) ? g.key : undefined} data-sort-scope={sortScope(g) ?? undefined}>
            {g.label ? (
              <h2 className={`aisle__head ${sortable && sortScope(g) ? 'aisle__head--drag' : ''}`} title={sortable && sortScope(g) ? 'Hold to move this group' : undefined}>
                {sortable && sortScope(g) ? <Icon name={G.grip} className="aisle__grip" /> : null}
                {g.tag !== undefined ? (
                  <>
                    <TagMark icon={g.tag ? g.icon : null} className="" />
                    {g.label}
                  </>
                ) : list ? (
                  // A folder inside: the way to it from this page (B › C), each step going there.
                  <span className="aisle__path">
                    {pathTo(list).map((l, i, all) => (
                      <Fragment key={l.id}>
                        {i ? <Icon name={G.subtask} className="aisle__sep" /> : null}
                        <button type="button" className={`aisle__go aisle__golabel ${i < all.length - 1 ? 'is-up' : ''}`} onClick={() => navigate({ name: 'list', id: l.id })}>
                          {i === all.length - 1 ? <ListBullet list={l} size="xs" /> : null}
                          <span dir="auto">{l.name}</span>
                        </button>
                      </Fragment>
                    ))}
                  </span>
                ) : (
                  g.label
                )}
                <span className="num">{g.items.length}</span>
                <FoldButton open={!isFolded(g)} label={typeof g.label === 'string' ? g.label : 'this group'} onToggle={() => flipFold(g)} />
              </h2>
            ) : null}
            {isFolded(g) ? null : (
            <ul className={rowsClass}>
              {shown.map(({ row: i, settling }) =>
                draggable && !settling ? (
                  <SortableItemRow key={i.id} item={i} showList={mixed} skipTag={g.tag} flash={flash.has(i.id)} />
                ) : (
                  <ItemRow key={i.id} item={i} showList={mixed} skipTag={g.tag} settling={settling} flash={flash.has(i.id)} />
                ),
              )}
            </ul>
            )}
            {list && g.label && g.tag === undefined && !isFolded(g) ? (
              // Add straight into this folder, without going in.
              <button type="button" className="groupadd" aria-label={`Add to ${list.name}`} onClick={() => openSheet((close) => <QuickAddSheet onClose={close} listId={list.id} />)}>
                <Icon name={G.add} />
              </button>
            ) : null}
          </section>
        );
      })}
    </>
  );

  return (
    <SettleContext.Provider value={settle}>
      {shownUrgent.length ? (
        // The page's one lemon card: what's urgent, in the page's order (by tag: the walk).
        <section className="aisle aisle--urgent" aria-label="Urgent">
          <ul className={rowsClass}>
            <li className="aisle__cap">
              <h2 className="aisle__captitle">Urgent</h2>
              <span className="ccard__badge num">{urgent.length}</span>
            </li>
            {shownUrgent.map(({ row: i, settling }) => (
              <ItemRow key={i.id} item={i} showList={showList && new Set(urgent.map((u) => u.listId)).size > 1} inUrgent settling={settling} flash={flash.has(i.id)} />
            ))}
          </ul>
        </section>
      ) : null}
      {draggable ? (
        <Sortable
          ids={ids}
          onMove={onMove}
          layout={cards ? 'grid' : 'rows'}
          bounds="none"
          outside={into}
          // Up and down is its place, right is its level: the one in the hand says so.
          hint={!cards && ids.length > 1 ? <PullHint /> : undefined}
          label={(id) => hub.item(id)?.title ?? ''}
          renderOverlay={(id, { outside }) => {
            const item = hub.item(id);
            // Over a folder: the task as a small chip, going in.
            if (item && outside)
              return <DropChip label={item.title} nesting={nesting} />;
            return item ? (
              <ul className={rowsClass}>
                <ItemRow item={item} showList={showList} skipTag={groupOf.get(id)?.tag} />
              </ul>
            ) : null;
          }}
        >
          {body}
        </Sortable>
      ) : (
        body
      )}
    </SettleContext.Provider>
  );
}

/**
 * Ongoing: what we're doing now (a task swiped right). The ones still to do are real rows, the
 * ticked ones chips that tap back out, the bar how far along it is, and Clear files the ticked away.
 */
export function OngoingTray({ open, done, onOut, onClear }: { open: Item[]; done: Item[]; onOut: (i: Item) => void; onClear: () => void }) {
  const total = open.length + done.length;
  const pct = total ? Math.round((done.length / total) * 100) : 0;
  const settle = useSettle<Item>();
  const rows = settle.view('ongoing', open);
  return (
    <SettleContext.Provider value={settle}>
      <section className={`ongoing ${open.length === 0 ? 'is-full' : ''}`} aria-label={`Ongoing: ${done.length} of ${total} done`}>
        <div className="ongoing__head">
          <span className="ongoing__mark" key={total}>
            <Icon name={G.ongoing} />
            {open.length ? <span className="ongoing__n num">{open.length}</span> : null}
          </span>
          <span>Ongoing</span>
          <span className="ongoing__bar" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="ongoing__of num">
            {done.length}/{total}
          </span>
        </div>
        {done.length ? (
          <Button small quiet={open.length > 0} className="ongoing__clear" onClick={onClear}>
            Clear
          </Button>
        ) : null}
        {rows.length ? (
          <ul className="rows ongoing__rows">
            {rows.map(({ row: i, settling }) => (
              <ItemRow key={i.id} item={i} inTray settling={settling} />
            ))}
          </ul>
        ) : null}
        {done.length ? (
          <div className="ongoing__done">
            {done.map((i) => (
              <button key={i.id} type="button" className="donechip" onClick={() => onOut(i)} aria-label={`Not done: ${i.title}`}>
                <Icon name={G.done} className="icon--sm" />
                <span dir="auto">{i.title}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </SettleContext.Provider>
  );
}

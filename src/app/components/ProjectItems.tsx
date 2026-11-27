import { Fragment, useEffect, useRef } from 'react';
import type { Item, List } from '../../core/model';
import { useHub } from '../context';
import { navigate } from '../router';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { ListBullet } from '../ui/primitives';
import { Sortable, useSortableItem, type Point } from '../ui/Sortable';
import { SettleContext, useSettle } from '../ui/useSettle';
import type { ProjectGroup } from '../views';
import { ItemRow } from './ItemRow';
import { QuickAddSheet } from './QuickAddSheet';
import { movedTo } from './TemplateAsk';
import { getPrefs, setPrefs, usePrefs } from '../prefs';
import { useGroupDrag } from '../ui/groupDrag';
import { TagMark } from './Tags';
import { listIdOf } from '../../core/keys';
import { G } from '../ui/glyphs';

const idOf = (i: Item) => i.id;

/** The project under the hand, if any: one marked [data-drop-list], or a project's tab in the bar. */
function dropListAt(p: Point): { el: HTMLElement; listId: string } | null {
  for (const e of document.elementsFromPoint(p.x, p.y)) {
    const t = e.closest<HTMLElement>('[data-drop-list], .tabbar [data-key^="l:"]');
    if (!t) continue;
    const listId = t.dataset.dropList ?? (t.dataset.key ? listIdOf(t.dataset.key) : null) ?? undefined;
    if (listId) return { el: t, listId };
  }
  return null;
}

type RowProps = { item: Item; settling?: boolean; showList?: boolean; skipTag?: string | null; flash?: boolean };

function SortableRow(p: RowProps) {
  const s = useSortableItem(p.item.id, { disabled: p.settling });
  return <ItemRow {...p} liRef={s.ref} liStyle={s.style} liClass={s.className} dragProps={s.props} />;
}

/**
 * A project's open things, the same for every project: the Urgent card on top, then one group
 * (a plain list), a group per tag (the aisles, in our order), or one per project inside. Hold a
 * row to move it; drop it in another group and it takes that tag, or moves to that project.
 * Ticked rows strike and fold before they leave for the tray.
 */
export function ProjectItems({
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
  groups: ProjectGroup[];
  urgent: Item[];
  cards: boolean;
  draggable: boolean;
  /** Rows say which project they're in (a tag's group mixes projects). */
  showList: boolean;
  flash: Set<string>;
}) {
  const hub = useHub();
  const overlays = useOverlays();
  const { toast, openSheet } = overlays;
  const settle = useSettle(idOf);
  const prefs = usePrefs();
  // As lists, the groups go in my order for this page (a group I never moved keeps its place
  // after the ones I did); the folders' own order isn't touched. The folder's own tasks lead.
  const mine = pageId ? (prefs.groupOrder[pageId] ?? []) : [];
  const rank = (g: ProjectGroup, at: number) => (!g.label ? -1 : g.tag !== undefined || !mine.includes(g.key) ? mine.length + at : mine.indexOf(g.key));
  const ordered = live
    .map((g, at) => ({ g, r: rank(g, at), at }))
    .sort((a, b) => a.r - b.r || a.at - b.at)
    .map((x) => x.g);
  // A group whose last thing was just ticked stays until that row has settled.
  const last = useRef<ProjectGroup[]>([]);
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
  const foldKey = (g: ProjectGroup) => `${pageId ?? ''}|${g.key}`;
  const isFolded = (g: ProjectGroup) => !!g.label && prefs.foldedGroups.includes(foldKey(g));
  const flipFold = (g: ProjectGroup) => {
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
    window.addEventListener('pointermove', track, { capture: true, passive: true });
    return () => window.removeEventListener('pointermove', track, { capture: true });
  }, []);

  // Drop a task on a project (a folder here, a step of the path, a project in the bar): it moves there.
  const lifted = useRef<string | null>(null);
  const lit = useRef<HTMLElement | null>(null);
  const light = (el: HTMLElement | null) => {
    if (lit.current === el) return;
    lit.current?.classList.remove('is-droptarget');
    el?.classList.add('is-droptarget');
    if (el) haptic('select');
    lit.current = el;
  };
  // Or onto the middle of another task: it goes under it, as a subtask. (The rows' resting places
  // decide, not where they've slid to make room, so the target holds still.)
  // Or, as in most to-do apps, drag it to the right: it goes under the task above it.
  const nestRef = useRef<string | null>(null);
  const liftX = useRef<number | null>(null);
  const nestAt = (p: Point): { el: HTMLElement; id: string } | null => {
    const from = lifted.current;
    if (!from) return null;
    const ok = (id: string) => {
      const it = hub.item(id);
      // Never under itself or one of its own subtasks.
      return !!it && !it.parentId && !it.done && hub.canEdit(it) && !hub.isUnder(id, from);
    };
    const rows = [...document.querySelectorAll<HTMLElement>('.aisle li.row:not(.row--nested)[data-id]')]
      .filter((li) => li.dataset.id !== from && !li.closest('.dragwrap'))
      .map((li) => {
        const r = li.getBoundingClientRect();
        const t = getComputedStyle(li).transform;
        const top = r.top - (t === 'none' ? 0 : new DOMMatrixReadOnly(t).m42);
        return { li, id: li.dataset.id!, top, height: r.height, left: r.left, right: r.right };
      });
    // Right on a task (its middle): under that one.
    for (const r of rows) {
      const band = (p.y - r.top) / r.height;
      if (p.x < r.left || p.x > r.right || band < 0.3 || band > 0.7) continue;
      return ok(r.id) ? { el: r.li, id: r.id } : null;
    }
    // Pulled to the right of where it was picked up: under the task just above.
    if (liftX.current !== null && p.x - liftX.current > 56) {
      const above = rows.filter((r) => r.top + r.height / 2 < p.y).sort((a, b) => b.top - a.top)[0];
      return above && ok(above.id) ? { el: above.li, id: above.id } : null;
    }
    return null;
  };
  const into = {
    hit: (p: Point) => {
      const n = nestAt(p);
      nestRef.current = n?.id ?? null;
      if (n) return true;
      const t = dropListAt(p);
      return !!t && t.listId !== hub.item(lifted.current)?.listId;
    },
    aim: (p: Point | null) => light(p ? (nestAt(p)?.el ?? dropListAt(p)?.el ?? null) : null),
    drop: (id: string, p: Point) => {
      const n = nestAt(p);
      if (n) {
        light(null);
        const item = hub.item(id);
        const under = hub.item(n.id);
        if (!item || !under) return;
        const was = { listId: item.listId, parentId: item.parentId ?? null };
        hub.move(id, { listId: under.listId, parentId: under.id });
        // Show it where it went: its new task opens its subtasks.
        const unf = getPrefs().unfolded;
        if (!unf.includes(under.id)) setPrefs({ unfolded: [...unf, under.id].slice(-200) });
        haptic('success');
        movedTo(hub, overlays, id, was.listId, was.listId, `${item.title}: under “${under.title}”`, () => hub.move(id, was));
        return;
      }
      const t = dropListAt(p);
      const item = hub.item(id);
      const to = hub.list(t?.listId);
      light(null);
      if (!t || !item || !to) return;
      const was = { listId: item.listId, parentId: item.parentId ?? null };
      hub.move(id, { listId: to.id, parentId: null });
      haptic('success');
      movedTo(hub, overlays, id, was.listId, to.id, `Moved to ${to.name}`, () => hub.move(id, was));
    },
    lift: (id: string) => {
      lifted.current = id;
      liftX.current = lastPt.current?.[0] ?? null;
    },
    end: () => {
      lifted.current = null;
      liftX.current = null;
      nestRef.current = null;
      light(null);
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
  const sortScope = (g: ProjectGroup): string | null => {
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
      toast(`${hub.tag(tag)?.name ?? 'Tag'} moved`, { action: { label: 'Undo', run: () => hub.arrangeTags(was) } });
    } else if (g.listId && pageId) {
      const keys = groups.filter((x) => sortScope(x) === 'lists').map((x) => x.key);
      const next = keys.filter((k) => k !== key);
      const at = b ? next.indexOf(b.key) : next.length;
      next.splice(at < 0 ? next.length : at, 0, key);
      const was = getPrefs().groupOrder;
      setPrefs({ groupOrder: { ...was, [pageId]: next } });
      toast(`${g.label} moved`, { action: { label: 'Undo', run: () => setPrefs({ groupOrder: was }) } });
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
        // Rows name their project only where the group mixes projects.
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
                <button
                  type="button"
                  className={`aisle__fold ${isFolded(g) ? '' : 'is-open'}`}
                  aria-expanded={!isFolded(g)}
                  aria-label={`${isFolded(g) ? 'Show' : 'Fold'} ${g.label}`}
                  title={isFolded(g) ? 'Show its tasks' : 'Fold it'}
                  onClick={() => flipFold(g)}
                >
                  <Icon name={G.fold} />
                </button>
              </h2>
            ) : null}
            {isFolded(g) ? null : (
            <ul className={rowsClass}>
              {shown.map(({ row: i, settling }) =>
                draggable && !settling ? (
                  <SortableRow key={i.id} item={i} showList={mixed} skipTag={g.tag} flash={flash.has(i.id)} />
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
          label={(id) => hub.item(id)?.title ?? ''}
          renderOverlay={(id, { outside }) => {
            const item = hub.item(id);
            // Over a project: the task as a small chip, going in.
            if (item && outside)
              return (
                <span className="dropchip">
                  <Icon name={nestRef.current ? G.subtask : G.move} className="icon--sm" />
                  <span dir="auto">{item.title}</span>
                </span>
              );
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

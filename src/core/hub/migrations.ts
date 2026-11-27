import { diffDays, today as todayStr } from '../dates';
import type { AisleConf } from '../model';
import { byOrder, keyBetween } from '../order';
import { aisleGlyph, categorize, categoryMeta, categoryOrder, type Flavor } from '../../smart/categorize';
import { suggestIcon } from '../folderIcons';
import { shiftForAway } from '../../smart/recurrence';
import { FOLDER_TEMPLATES } from '../seed';
import { Hub } from './base';

/** Bringing older data up to date (run once at start). */

declare module './base' {
  interface Hub {
    /**
     * Folders from before they came with icons get one (once per device): a template's, else
     * one from the name. Every phone works it out the same way, over the folders both of us
     * see, so both write the same icon.
     */
    fillIcons(): void;

    /**
     * Old defaults, brought up to date: "Housework" was renamed "Chores", and chores folders are
     * now ordinary folders (each chore keeps its repeat, "from when it's done" included).
     */
    renameOldDefaults(): void;

    /**
     * Shopping lists become ordinary folders inside one Shopping folder, and their aisles
     * become tags (named, ordered and drawn as we had them). Once, on any device: everything it
     * writes is the same wherever it runs, so two phones doing it at once agree.
     */
    uniformProjects(): void;

    /**
     * Shopping is a folder like any other, looked at by tag (the aisles). One step after
     * uniformProjects, for phones that moved before folders had views. Once; the same everywhere.
     */
    viewsFromKinds(): void;

    /** Away mode is gone: one left on (from before) ends, its chore clocks caught up. */
    endAwayMode(): void;

    /**
     * Open a loop of folders. One device can't make one (a move into its own insides is refused),
     * but two can: I put Trip inside Packing while my person puts Packing inside Trip, and both
     * arrive. Neither is at the top of Folders any more, so both are out of sight. The one with
     * the smallest id steps out to the top; the choice is the same wherever this runs, so two
     * phones doing it at once agree. (Tasks have their own: Hub.mendTree.) Returns how many it opened.
     */
    mendFolders(): number;

    isAway(): boolean;

    /** Away mode: freeze every chore clock; on return, shift flexible chores and collapse fixed ones. */
    setAway(on: boolean): void;
  }
}

Hub.prototype.fillIcons = function (this: Hub): void {
  this.store.batch(() => {
    const taken = new Set<string>();
    for (const l of this.lists()) {
      let icon = l.icon;
      if (!icon) {
        icon = FOLDER_TEMPLATES.find((x) => x.name === l.name)?.icon ?? suggestIcon(l.name, l.flavor ? 'shopping' : l.kind, l.flavor, undefined, taken);
        this.store.mutate('list', l.id, { icon });
      }
      // My To-Do started with a star; a star now means "keep it on Today", so it's a tick.
      if (l.id === this.personalFolderId() && icon === 'i:star') this.store.mutate('list', l.id, { icon: 'i:task' });
      if (l.visibility !== 'private') taken.add(icon);
    }
  });
};

Hub.prototype.renameOldDefaults = function (this: Hub): void {
  for (const l of this.store.all('list')) {
    if (l.deleted || !this.store.get('list', l.id)) continue;
    if ((l.kind as string) === 'chores') this.store.mutate('list', l.id, { kind: 'tasks', ...(l.name === 'Housework' ? { name: 'Chores' } : {}) });
  }
};

Hub.prototype.uniformProjects = function (this: Hub): void {
  const legacy = this.store.all('list').filter((l) => l.kind === 'shopping');
  if (!legacy.length) return this.viewsFromKinds();
  this.store.batch(() => {
    // Our aisles, as they were: names, icons, the walk, the ones we took away.
    let prev: string | null = this.tags().at(-1)?.order ?? null;
    for (const flavor of ['grocery', 'home'] as const) {
      const s = this.settings();
      const raw = flavor === 'grocery' ? s?.groceryAisles : s?.homeAisles;
      const conf: AisleConf[] = Array.isArray(raw) ? raw.filter((a) => a && typeof a.id === 'string') : [];
      const seen = new Set(conf.map((a) => a.id));
      const walk = [...conf.filter((a) => !a.hidden).map((a) => a.id), ...categoryOrder(flavor).filter((c) => !seen.has(c))];
      const byId = new Map(conf.map((a) => [a.id, a]));
      for (const c of walk) {
        if (c === 'other') continue;
        const id = this.tagIdFor(flavor, c);
        if (this.store.record('tag', id)) continue;
        const mine = byId.get(c);
        const glyph = c.includes(':') ? null : aisleGlyph(flavor, c);
        const order = keyBetween(prev, null);
        prev = order;
        this.store.mutate('tag', id, {
          name: mine?.name || (c.includes(':') ? 'Category' : categoryMeta(flavor, c).en),
          icon: mine?.icon || (glyph ? `i:${glyph}` : mine?.emoji || (c.includes(':') ? null : categoryMeta(flavor, c).e)),
          order,
          createdAt: Date.now(),
          createdBy: this.meId,
        });
      }
      for (const a of conf) if (a.hidden && a.id !== 'other' && !this.store.record('tag', this.tagIdFor(flavor, a.id))) this.store.mutate('tag', this.tagIdFor(flavor, a.id), { name: categoryMeta(flavor, a.id).en, order: keyBetween(prev, null), deleted: true });
    }
    // Every thing to buy wears its aisle.
    const ids = new Set(legacy.map((l) => l.id));
    for (const i of this.store.all('item')) {
      if (!ids.has(i.listId) || Array.isArray(i.tags) || i.parentId) continue;
      const flavor = (this.list(i.listId)?.flavor ?? 'grocery') as Flavor;
      const cat = i.category ?? categorize(i.title, flavor, (k) => this.learned(k)).category;
      const tag = cat && cat !== 'other' ? this.tagIdFor(flavor, cat) : null;
      this.store.mutate('item', i.id, { tags: tag && this.tag(tag) ? [tag] : [] });
    }
    // One Shopping folder (the same id on both phones), with the lists inside it.
    let root = this.store.all('list').find((l) => l.shopRoot);
    if (!root && !this.store.record('list', 'shopping')?.v.deleted) {
      const first = [...legacy].sort(byOrder)[0];
      const before = this.lists().filter((l) => !l.parentId && l.order < first.order).at(-1);
      this.store.mutate('list', 'shopping', {
        name: 'Shopping',
        kind: 'tasks',
        shopRoot: true,
        // The colour shopping already had.
        color: first.color,
        icon: 'i:basket',
        owner: null,
        visibility: 'shared',
        order: keyBetween(before?.order ?? null, first.order),
        createdAt: Date.now(),
        createdBy: this.meId,
      });
      root = this.store.get('list', 'shopping');
    }
    for (const l of legacy) {
      const inside = !!root && this.isWithin(l.id, root.id);
      this.store.mutate('list', l.id, { kind: 'tasks', flavor: l.flavor ?? 'grocery', view: 'tags', ...(root && !inside ? { parentId: root.id } : {}) });
    }
    if (root && !root.view) this.store.mutate('list', root.id, { view: 'tags' });
  });
};

Hub.prototype.viewsFromKinds = function (this: Hub): void {
  const todo = this.store.all('list').filter((l) => (l.shopRoot || l.flavor) && !l.view);
  if (!todo.length) return;
  this.store.batch(() => {
    for (const l of todo) this.store.mutate('list', l.id, { view: 'tags' });
  });
};

/** Of each loop of parents among these rows, its smallest id. */
function loopHeads(rows: Array<{ id: string; parentId?: string | null }>): string[] {
  const parent = new Map(rows.map((r) => [r.id, r.parentId ?? null]));
  const heads = new Set<string>();
  const settled = new Set<string>();
  for (const r of rows) {
    const path: string[] = [];
    let cur: string | null = r.id;
    while (cur && parent.has(cur) && !settled.has(cur) && !path.includes(cur)) {
      path.push(cur);
      cur = parent.get(cur) ?? null;
    }
    if (cur && path.includes(cur)) heads.add(path.slice(path.indexOf(cur)).reduce((a, b) => (a < b ? a : b)));
    for (const p of path) settled.add(p);
  }
  return [...heads];
}

Hub.prototype.mendFolders = function (this: Hub): number {
  const heads = loopHeads(this.store.all('list'));
  // Nothing wrong (nearly always): no write, so nobody is told the data changed.
  if (!heads.length) return 0;
  this.store.batch(() => {
    for (const id of heads) this.store.mutate('list', id, { parentId: null });
  });
  return heads.length;
};

Hub.prototype.endAwayMode = function (this: Hub): void {
  if (this.isAway()) this.setAway(false);
};

Hub.prototype.isAway = function (this: Hub): boolean {
  return !!this.settings()?.awaySince;
};

Hub.prototype.setAway = function (this: Hub, on: boolean): void {
  const since = this.settings()?.awaySince;
  this.store.batch(() => {
    if (on) {
      this.store.mutate('settings', 'house', { awaySince: todayStr(), awayBy: this.meId });
      return;
    }
    if (since) {
      const days = Math.max(0, diffDays(since, todayStr()));
      for (const it of this.store.all('item')) {
        if (!it.repeat || it.paused || !it.due) continue;
        const shifted = shiftForAway(it.repeat, it.due, days);
        if (shifted && shifted !== it.due) this.store.mutate('item', it.id, { due: shifted });
      }
    }
    this.store.mutate('settings', 'house', { awaySince: null, awayBy: null });
  });
};

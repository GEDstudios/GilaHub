/**
 * Gila Hub data model.
 *
 * Everything is an entity in a table, synced field-by-field (last writer wins).
 * Lists hold items; items nest infinitely through `parentId`.
 */

export type Table = 'member' | 'list' | 'item' | 'log' | 'memory' | 'store' | 'settings' | 'idea' | 'moment';

/** Encryption scope: 'h' = household key (both partners), 'p:<memberId>' = personal key. */
export type Scope = 'h' | `p:${string}`;

/** Palette ids — the Tasky color system (see docs/02-BRAND.md). */
export type LineColor = 'lemon' | 'pink' | 'lilac' | 'sky' | 'mint' | 'amber' | 'orange' | 'ink';

/** The colors offered in pickers. 'orange' and 'ink' stay valid for older data. */
export const LINE_COLORS: LineColor[] = ['lemon', 'pink', 'lilac', 'sky', 'mint', 'amber'];

export interface Member {
  id: string;
  name: string;
  color: LineColor;
  createdAt: number;
  /** Wants a push when the partner starts shopping (default on). */
  shopAlerts?: boolean;
  /** Wants a push when the partner asks for something, or does what I asked (default on). The sender reads it. */
  requestAlerts?: boolean;
  /** My bottom bar, between Today and Projects, in order, no practical limit: 'shop', 'chores', 'search' or 'l:<listId>'. */
  tabs?: string[];
  /** My Today page, in order (undefined = the defaults). Synced to my devices; see app/home.ts. */
  home?: HomeSlot[];
}

/**
 * One block on my Today page. Widgets: 'asks' | 'today' | 'week' | 'upcoming' | 'partner' |
 * 'shop' | 'chores' (kept with on:false when hidden); pinned projects: 'l:<listId>' (removed when unpinned).
 */
export interface HomeSlot {
  key: string;
  on: boolean;
}

export type ListKind = 'tasks' | 'shopping' | 'chores';

/**
 * shared  — "Ours": both see and edit, nobody owns it.
 * visible — "Mine": belongs to `owner`, partner can see it.
 * private — "Only me": encrypted with the owner's personal key; invisible to the partner.
 */
export type Visibility = 'shared' | 'visible' | 'private';

export type ShoppingFlavor = 'grocery' | 'home';

export interface List {
  id: string;
  name: string;
  kind: ListKind;
  /** For shopping lists: which catalog/aisles to use. */
  flavor?: ShoppingFlavor;
  color: LineColor;
  /** Optional emoji; otherwise the bullet shows the first letter of the name. */
  icon?: string;
  owner: string | null;
  visibility: Visibility;
  order: string;
  archived?: boolean;
  createdAt: number;
  createdBy: string;
  deleted?: boolean;
}

export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

export type RepeatRule =
  | {
      /** Every N units. */
      type: 'interval';
      every: number;
      unit: RepeatUnit;
      /**
       * 'done'     — flexible: next time counts from when it was actually done (default for chores).
       * 'schedule' — fixed: stays on the calendar no matter when it was done.
       */
      from: 'done' | 'schedule';
    }
  | {
      /** On specific weekdays (0 = Sunday). Always calendar-anchored. */
      type: 'weekdays';
      days: number[];
      every?: number;
    }
  | {
      /** On days of the month: 1–31, or -1 for the last day. Always calendar-anchored. */
      type: 'monthdays';
      days: number[];
    };

/** Who a task or chore is for. */
export type Assignee = string | 'both' | 'turns' | null;

export interface Item {
  id: string;
  listId: string;
  parentId: string | null;
  title: string;
  notes?: string | null;
  done: boolean;
  doneAt?: number | null;
  doneBy?: string | null;
  order: string;
  /** Local calendar date "YYYY-MM-DD". */
  due?: string | null;
  /** Local time "HH:mm". */
  dueTime?: string | null;
  /** Minutes before due date/time to remind; null = no reminder. 0 = at time. */
  remind?: number | null;
  repeat?: RepeatRule | null;
  assignee?: Assignee;
  /** For "turns": whose turn it is now. */
  turn?: string | null;
  /** Personal item in a shared list ("Mine"). null = ours. */
  owner?: string | null;
  /** "Only me": encrypted with owner's personal key, hidden from partner. Inherited by subtasks. */
  private?: boolean;
  /** Urgent / important flag. */
  urgent?: boolean;
  /** Low priority, the opposite: it sinks below the rest, quieter. Never both. */
  low?: boolean;
  /** Who last turned urgent on (the other one's Shopping flashes it). */
  urgentBy?: string | null;
  /** Shopping: who brought it back onto the list, and when (a re-added staple; a first add is createdBy/createdAt). */
  addedBy?: string | null;
  addedAt?: number | null;
  /** Shopping: quantity text like "2", "500g", "1 ק"ג". */
  qty?: string | null;
  /** Shopping: aisle category id (overrides automatic). */
  category?: string | null;
  /** Shopping: preferred store id. */
  storeId?: string | null;
  /** Shopping: cleared from the cart after a trip. */
  archived?: boolean;
  /** Recurring: last completion. */
  lastDoneAt?: number | null;
  lastDoneBy?: string | null;
  /** Recurring: paused (seasonal). */
  paused?: boolean;
  /** A request: who asked (the assignee is who was asked). */
  requestedBy?: string | null;
  /** The asker wants to OK it before it counts as done. */
  needsOk?: boolean;
  /** "I did it" — waiting for the asker's OK. */
  submittedAt?: number | null;
  submittedBy?: string | null;
  /** The asker said "Not yet": the doer sees it until they tick again. */
  sentBackAt?: number | null;
  sentBackBy?: string | null;
  /** Shopping: the purchase log written when it was checked. */
  logId?: string | null;
  /**
   * The same thing in another place ("Buy a doorknob" under "Replace the doorknob", and
   * "doorknob" on Home shopping): each points at the other, and ticking one ticks both.
   */
  linkId?: string | null;
  createdAt: number;
  createdBy: string;
  deleted?: boolean;
}

/** Completion history for repeating tasks/chores and purchases of shopping items. */
export interface LogEntry {
  id: string;
  itemId: string;
  kind: 'done' | 'bought';
  /** Normalized item name for purchase analytics ("buy again"). */
  key?: string;
  name?: string;
  listId?: string;
  at: number;
  by: string;
  /** One-tap ♡ from the partner. */
  thankedBy?: string | null;
  thankedAt?: number | null;
  deleted?: boolean;
}

/** Household-wide settings (single entity, id "house"). */
export interface Settings {
  id: string;
  /** Away mode: chore clocks are frozen since this date. */
  awaySince?: string | null;
  awayBy?: string | null;
  /** Our aisles, in walking order, with our names and our own aisles (unset = the defaults). */
  groceryAisles?: AisleConf[];
  homeAisles?: AisleConf[];
}

/** One aisle as we arranged it: a built-in category id or our own ("c:…"), maybe renamed. */
export interface AisleConf {
  id: string;
  name?: string;
  emoji?: string;
  /** Our pick of icon: "i:<glyph>" or an emoji (as projects have). */
  icon?: string;
}

/** Learned category for a normalized item name — shared by both partners. */
export interface Memory {
  /** id = `${flavor}:${normalized name}` */
  id: string;
  category: string;
  emoji?: string;
}

export interface Store {
  id: string;
  name: string;
  /** Category ids in walking order, learned or arranged. */
  aisles: string[];
  deleted?: boolean;
}

/**
 * An idea for Gila Hub itself (the Ideas tag). Always household scope: both of us read,
 * edit, resolve and reorder every one.
 */
export interface Idea {
  id: string;
  text: string;
  /** Who wrote it (member id). */
  by: string;
  createdAt: number;
  /** Manual order, lower first. Unset: newest first, above the ordered ones. */
  order?: number;
  /** Set when someone changed the text (the meta line says "edited by" when it isn't the author). */
  editedBy?: string | null;
  editedAt?: number | null;
  resolvedAt?: number | null;
  resolvedBy?: string | null;
  /** Set when someone brought a resolved one back (its author hears about it). */
  reopenedAt?: number | null;
  reopenedBy?: string | null;
  deleted?: boolean;
}

/**
 * A moment worth keeping: a feeling and a line, from either of us (Moments, on Today's "This
 * week"). Household scope, so we both look back on all of them.
 */
export interface Moment {
  id: string;
  text: string;
  /** One emoji for how it felt. */
  feel: string;
  by: string;
  /** The day it happened, "YYYY-MM-DD" (usually today). */
  day: string;
  createdAt: number;
  deleted?: boolean;
}

export interface TableTypes {
  member: Member;
  list: List;
  item: Item;
  log: LogEntry;
  memory: Memory;
  store: Store;
  settings: Settings;
  idea: Idea;
  moment: Moment;
}

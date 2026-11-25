/**
 * Gila Hub data model.
 *
 * Everything is an entity in a table, synced field-by-field (last writer wins).
 * Lists hold items; items nest infinitely through `parentId`.
 */

export type Table = 'member' | 'list' | 'item' | 'log' | 'memory' | 'store' | 'settings';

/** Encryption scope: 'h' = household key (both partners), 'p:<memberId>' = personal key. */
export type Scope = 'h' | `p:${string}`;

/** Palette ids ("lines") — see src/styles/tokens.css and docs/BRAND.md. */
export type LineColor =
  | 'tomato'
  | 'tangerine'
  | 'sunflower'
  | 'lime'
  | 'forest'
  | 'teal'
  | 'royal'
  | 'plum'
  | 'cocoa'
  | 'pebble';

export const LINE_COLORS: LineColor[] = [
  'tomato',
  'tangerine',
  'sunflower',
  'lime',
  'forest',
  'teal',
  'royal',
  'plum',
  'cocoa',
  'pebble',
];

export interface Member {
  id: string;
  name: string;
  color: LineColor;
  createdAt: number;
  /** Wants a push when the partner starts shopping (default on). */
  shopAlerts?: boolean;
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
  /** Shopping: the purchase log written when it was checked. */
  logId?: string | null;
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

export interface TableTypes {
  member: Member;
  list: List;
  item: Item;
  log: LogEntry;
  memory: Memory;
  store: Store;
  settings: Settings;
}

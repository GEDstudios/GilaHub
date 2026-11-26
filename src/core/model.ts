/**
 * Gila Hub data model.
 *
 * Everything is an entity in a table, synced field-by-field (last writer wins).
 * Lists hold items; items nest infinitely through `parentId`.
 */

export type Table = 'member' | 'list' | 'item' | 'log' | 'memory' | 'store' | 'settings' | 'idea' | 'moment' | 'note' | 'tag' | 'photo';

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
  /** My recovery code's id on the relay (from the code; it can't give the code back), and when it was made. */
  recoveryId?: string | null;
  recoverySetAt?: number | null;
  /** When a task has a day and no time, its notification comes at this time ("HH:MM"; unset: 09:00). Each of us has our own. */
  remindAt?: string | null;
  /** My private To-Do was made (its id): never made again, even if I delete it. */
  personalFolder?: string | null;
  /** How I look at each folder (list, cards, by tag): mine, not my partner's. Unset: the folder's own default. */
  views?: Record<string, ListView> | null;
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

/**
 * Every project is 'tasks': there is one kind of project. Chores and then shopping lists used to
 * be kinds of their own; 'shopping' is only read from older data (Hub.uniformProjects moves it).
 */
export type ListKind = 'tasks' | 'shopping';

/**
 * shared  — "Ours": both see and edit, nobody owns it.
 * visible — "Mine": belongs to `owner`, partner can see it.
 * private — "Only me": encrypted with the owner's personal key; invisible to the partner.
 */
export type Visibility = 'shared' | 'visible' | 'private';

export type ShoppingFlavor = 'grocery' | 'home';

/** A project's look: rows, cards, or rows grouped by their first tag (the aisles). */
export type ListView = 'list' | 'cards' | 'tags';

export interface List {
  id: string;
  name: string;
  kind: ListKind;
  /** Older data: a shopping list's leaning (groceries or things for the home). Read only. */
  flavor?: ShoppingFlavor;
  /** The Shopping project: "Buy a doorknob" under a task also lands here. (It's a project like any other.) */
  shopRoot?: boolean;
  /** Where each of us starts looking at it (list, cards, by tag); each keeps their own (Member.views). */
  view?: ListView;
  color: LineColor;
  /** Optional emoji; otherwise the bullet shows the first letter of the name. */
  icon?: string;
  owner: string | null;
  visibility: Visibility;
  order: string;
  /** A line or two about it, under its name. */
  description?: string | null;
  /** How new tasks here start (a folder's task template); the words and chips still win. */
  template?: TaskTemplate | null;
  /** Other folders whose tasks show here too (one way: theirs show here, ours don't show there). */
  shows?: string[] | null;
  /** My own private To-Do (one per person, made for them; Hub.ensurePersonalFolder). */
  personal?: boolean;
  /** The project it sits inside (a folder in a folder). Unset, or one I can't see: top level. */
  parentId?: string | null;
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
  /** Notify again on this rhythm (every day, on set days…) until it's done. Not for repeating things. */
  nag?: RepeatRule | null;
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
  /** Who last turned urgent on (the other one's Shopping flashes it). */
  urgentBy?: string | null;
  /** Shopping: who brought it back onto the list, and when (a re-added staple; a first add is createdBy/createdAt). */
  addedBy?: string | null;
  addedAt?: number | null;
  /** Shopping: quantity text like "2", "500g", "1 ק"ג". */
  qty?: string | null;
  /** Its tags (Tag ids), in no particular order. Unset: never tagged (a thing to buy is then read for its aisle). */
  tags?: string[] | null;
  /** Older data: a thing to buy's aisle category id. Read only, as a tag (Hub.tagsOf). */
  category?: string | null;
  /** Shopping: preferred store id. */
  storeId?: string | null;
  /** Done and cleared from its project's tray ("Clear"; by itself after 12h). */
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
  /** In Ongoing (swiped right): being done now, since then, by whom. Stays on once ticked, until cleared. */
  ongoingAt?: number | null;
  ongoingBy?: string | null;
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
  /** A built-in one we took away: out of the walk; what it held goes to Other. */
  hidden?: boolean;
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
  /**
   * A screenshot (drawn on), as a JPEG data URL cut into parts so each syncs within an op's
   * limit: shot0…shot{shotN-1}, each "<shotV>:<part>" so parts of different pictures never mix.
   */
  shotN?: number | null;
  shotV?: string | null;
  [part: `shot${number}`]: string | null | undefined;
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

/**
 * A sticky note one of us left on a screen for the other ("Don't forget the milk 💛" on
 * Shopping). It stays stuck there until they peel it off. Household scope; not in backups.
 */
export interface Note {
  id: string;
  text: string;
  by: string;
  /** Who it's for (my partner). */
  to: string | null;
  /** The screen it's on: "today", "shop", "chores", "lists", "list:<id>", "item:<id>". */
  place: string;
  color: LineColor;
  createdAt: number;
  /** Where it's stuck, once someone moved it: left edge as a share of the page's width, top in px, and its turn in degrees. */
  x?: number | null;
  y?: number | null;
  rot?: number | null;
  /** Its size, times the usual (NOTE_MIN to NOTE_MAX). */
  scale?: number | null;
  /** How its photo sits: cut to a shape, in a border, at a place (NoteFace). */
  photoShape?: string | null;
  photoBorder?: string | null;
  photoAt?: string | null;
  /** Where the photo sits, as "x,y,size,turn" on the 124-point paper (it may hang off a little). */
  photoPos?: string | null;
  /** The words' size, set by hand (paper units); none = fit to the note. */
  textSize?: number | null;
  /** Drawn on the note itself: strokes as JSON [{c, w, p: "x,y x,y"}] on its 124-point paper. */
  ink?: string | null;
  /** A photo on it (drawn on), in parts like an idea's picture (Hub.setShot). */
  shotN?: number | null;
  shotV?: string | null;
  [part: `shot${number}`]: string | null | undefined;
  /** Read and peeled off (ticked) by the one it was for: it goes to the collected notes. */
  peeledAt?: number | null;
  deleted?: boolean;
}

/**
 * A tag, shared by both of us: any task can wear any tags, and every screen filters by them.
 * Built-in ones carry the catalog's aisles ("g:dairy", "h:kitchen"); our own are "c:…". Their
 * order is the walk through the store (Shopping groups things by their first tag in it).
 */
export interface Tag {
  id: string;
  name: string;
  /** "i:<glyph>", "x:<glyph>" or an emoji; none: a plain tag. */
  icon?: string | null;
  order: string;
  createdAt: number;
  createdBy: string;
  deleted?: boolean;
}

/**
 * A photo on a task or a folder ("item:<id>", "list:<id>"), kept in parts like a note's picture
 * (Hub.setShot), sealed the way the thing it's on is (an Only me task's photos are only mine).
 */
export interface Photo {
  id: string;
  on: string;
  by: string;
  createdAt: number;
  shotN?: number | null;
  shotV?: string | null;
  [part: `shot${number}`]: string | null | undefined;
  deleted?: boolean;
}

/** A folder's task template: what a new task added there starts with. */
export interface TaskTemplate {
  assignee?: Assignee | null;
  needsOk?: boolean;
  urgent?: boolean;
  /** Minutes before due to notify (0 = when due), as Item.remind. */
  remind?: number | null;
  repeat?: RepeatRule | null;
  /** Who sees it: 'ours' | 'mine' | 'theirs' | 'private'. */
  visibility?: 'ours' | 'mine' | 'theirs' | 'private' | null;
  tags?: string[];
  /** Due this many days after it's added (0 = the same day; null = no date). */
  dueIn?: number | null;
  /** At this time ("HH:MM"), on that day. */
  dueTime?: string | null;
  /** Notify again until done, on this rhythm (as Item.nag). */
  nag?: RepeatRule | null;
  /** A note it starts with. */
  notes?: string | null;
  /** Subtasks it starts with, in order. */
  steps?: string[] | null;
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
  note: Note;
  tag: Tag;
  photo: Photo;
}

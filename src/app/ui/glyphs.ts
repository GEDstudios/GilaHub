import type { IconName } from './icons.gen';

/**
 * One meaning, one glyph. Components name what they mean (G.subtask, G.close), never a raw glyph,
 * so the same idea always looks the same and one glyph never means two things. To change how
 * something looks everywhere, change it here.
 */
export const G = {
  // things
  task: 'task',
  subtask: 'subtask',
  folder: 'folder',
  /** The Folders page (its tab, the crumbs' root). */
  folders: 'folders',
  note: 'note',
  photo: 'image',
  tag: 'tag',
  template: 'layout',
  stock: 'package',
  /** Ongoing: being done now (a task swiped right; "on it" and its alerts). */
  ongoing: 'play-circle',
  idea: 'lightbulb',
  device: 'device',
  /** The count on the app's icon. */
  badge: 'badge',

  // actions
  add: 'plus',
  less: 'minus',
  close: 'x',
  delete: 'trash',
  done: 'check',
  move: 'move',
  copy: 'copy',
  edit: 'edit',
  draw: 'scribble',
  erase: 'eraser',
  undo: 'undo',
  reload: 'refresh',
  search: 'search',
  /** A filtered list on Today. */
  filter: 'funnel',
  pinToBar: 'pin',
  share: 'share',
  download: 'download',
  upload: 'upload',
  archive: 'archive',

  // what a task is set to
  urgent: 'urgent',
  repeat: 'repeat',
  remind: 'bell',
  /** Notify again until it's done. */
  nag: 'bell-ringing',
  date: 'calendar',
  time: 'clock',
  person: 'user',
  ask: 'request',
  /** The same thing, also somewhere else. */
  linked: 'link',
  /** A folder showing tasks from other folders. */
  shows: 'shows',
  /** Keep it on Today (a task in Highlights, a folder on Today). */
  highlight: 'star',
  today: 'sun',
  thanks: 'heart',
  thanked: 'heart-fill',
  tour: 'sparkle',

  // privacy (privacy.ts VIS_ICON reads these)
  private: 'lock',
  ours: 'ours',
  mine: 'mine',
  theirs: 'theirs',

  // settings
  key: 'key',
  sound: 'speaker',
  vibrate: 'vibrate',
  browser: 'browser',
  cursor: 'cursor-arrow',
  /** "Hold to pick it up" hints. */
  holdHint: 'hand-pointing',
  recent: 'history',

  // controls
  back: 'arrow-back',
  /** Go on to something (a row that opens a page). */
  go: 'chevron-right',
  continue: 'arrow',
  /** Folds and unfolds (turns as it opens). */
  fold: 'chevron-down',
  prev: 'chevron-left',
  next: 'chevron-right',
  more: 'more',
  grip: 'grip',

  // views of a folder
  viewList: 'lines',
  viewCards: 'cards',
  viewTags: 'tag',
} as const satisfies Record<string, IconName>;

/** The same meanings as text, for notification titles (which can't hold a glyph). */
export const G_TEXT = { urgent: '⚡', remind: '🔔', done: '✅', ask: '🙋', note: '📝' } as const;

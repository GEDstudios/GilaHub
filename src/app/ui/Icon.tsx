import type { CSSProperties, ReactNode } from 'react';

export type IconName =
  | 'plus'
  | 'check'
  | 'x'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-down'
  | 'chevron-up'
  | 'arrow'
  | 'arrow-back'
  | 'search'
  | 'gear'
  | 'bell'
  | 'repeat'
  | 'calendar'
  | 'clock'
  | 'user'
  | 'lock'
  | 'ours'
  | 'mine'
  | 'bag'
  | 'sparkle'
  | 'sun'
  | 'lines'
  | 'trash'
  | 'more'
  | 'edit'
  | 'grip'
  | 'copy'
  | 'archive'
  | 'heart'
  | 'heart-fill'
  | 'plane'
  | 'undo'
  | 'move'
  | 'share'
  | 'note'
  | 'steps'
  | 'device'
  | 'download'
  | 'upload'
  | 'refresh'
  | 'snooze'
  | 'skip'
  | 'pause'
  | 'tag'
  | 'cart'
  | 'link'
  | 'eye'
  | 'moon'
  | 'hand'
  | 'pin';

const P: Record<IconName, ReactNode> = {
  pin: <path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  'chevron-right': <path d="M9.5 5.5L16 12l-6.5 6.5" />,
  'chevron-left': <path d="M14.5 5.5L8 12l6.5 6.5" />,
  'chevron-down': <path d="M5.5 9.5L12 16l6.5-6.5" />,
  'chevron-up': <path d="M5.5 14.5L12 8l6.5 6.5" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  'arrow-back': <path d="M19 12H5M11 6l-6 6 6 6" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 1112 0v5.5l1.5 1.5h-15z" />
      <path d="M10 20.5h4" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 3.5l3 3-3 3" />
      <path d="M20 6.5H9a5 5 0 00-5 5v.5" />
      <path d="M7 20.5l-3-3 3-3" />
      <path d="M4 17.5h11a5 5 0 005-5V12" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0115 0" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 118 0v2.5" />
    </>
  ),
  ours: (
    <>
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
    </>
  ),
  mine: (
    <>
      <circle cx="9" cy="12" r="6" fill="currentColor" />
      <circle cx="15" cy="12" r="6" strokeDasharray="2.6 2.4" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8.5h14l-1.2 11.2a1.5 1.5 0 01-1.5 1.3H7.7a1.5 1.5 0 01-1.5-1.3z" />
      <path d="M9 10V7a3 3 0 016 0v3" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5z" />
      <path d="M18.5 15.5c.3 1.9.9 2.6 2.8 2.8-1.9.3-2.5.9-2.8 2.8-.3-1.9-.9-2.5-2.8-2.8 1.9-.2 2.5-.9 2.8-2.8z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.8v2M12 19.2v2M21.2 12h-2M4.8 12h-2M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4M18.5 18.5l-1.4-1.4M6.9 6.9L5.5 5.5" />
    </>
  ),
  lines: (
    <>
      <circle cx="5.5" cy="6.5" r="1.6" fill="currentColor" />
      <circle cx="5.5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="5.5" cy="17.5" r="1.6" fill="currentColor" />
      <path d="M10 6.5h10M10 12h10M10 17.5h10" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7" />
      <path d="M6.5 7l.9 12.2a1.5 1.5 0 001.5 1.3h6.2a1.5 1.5 0 001.5-1.3L17.5 7" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  edit: <path d="M4.5 19.5l1-4.2L15.8 5a2.1 2.1 0 013 3L8.5 18.3zM13.5 7.3l3.2 3.2" />,
  grip: (
    <>
      {[7, 12, 17].map((y) => (
        <g key={y}>
          <circle cx="9" cy={y} r="1.3" fill="currentColor" stroke="none" />
          <circle cx="15" cy={y} r="1.3" fill="currentColor" stroke="none" />
        </g>
      ))}
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2" />
      <path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4.5" rx="1.2" />
      <path d="M5 9v9.5a1.5 1.5 0 001.5 1.5h11a1.5 1.5 0 001.5-1.5V9M10 13h4" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.2a4.3 4.3 0 017.5 2.6C19.5 15.4 12 20 12 20z" />,
  'heart-fill': <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.2a4.3 4.3 0 017.5 2.6C19.5 15.4 12 20 12 20z" fill="currentColor" />,
  plane: <path d="M10.5 13.5L3 11l1.2-1.6 8.3.9 4.6-5.2a1.9 1.9 0 012.8 2.6l-5.1 4.7.9 8.3L14 21l-2.5-7.5L8 17v2.5L6.5 21 5 18l-3-1.5L3.5 15H6z" />,
  undo: (
    <>
      <path d="M8 4.5L4 8.5l4 4" />
      <path d="M4 8.5h10a6 6 0 010 12h-3" />
    </>
  ),
  move: (
    <>
      <path d="M4 12h11M11 7.5l4.5 4.5-4.5 4.5" />
      <path d="M14 4.5h4a2 2 0 012 2v11a2 2 0 01-2 2h-4" />
    </>
  ),
  share: (
    <>
      <path d="M12 15V3.5M7.5 8L12 3.5 16.5 8" />
      <path d="M5 12.5v6a2 2 0 002 2h10a2 2 0 002-2v-6" />
    </>
  ),
  note: (
    <>
      <path d="M5 4.5h14v11l-4.5 4.5H5z" />
      <path d="M14.5 20v-4.5H19M8.5 9h7M8.5 12.5h4" />
    </>
  ),
  steps: (
    <>
      <path d="M5 5.5h9M9 12h10M9 18.5h10" />
      <path d="M5 5.5v13h4M5 12h4" />
    </>
  ),
  device: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12A7.5 7.5 0 116 7.5" />
      <path d="M6 3.5v4h4" />
    </>
  ),
  snooze: (
    <>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M9.5 10.5h5l-5 5h5M4.5 4.5L7 2.5M19.5 4.5L17 2.5" />
    </>
  ),
  skip: (
    <>
      <path d="M5 6l8 6-8 6z" />
      <path d="M18 6v12" />
    </>
  ),
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  tag: (
    <>
      <path d="M3.5 12.3V4.5a1 1 0 011-1h7.8l8.2 8.2-8.8 8.8z" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4.5h2.2l2.3 11h10.5l2-8H6.4" />
      <circle cx="9" cy="19.5" r="1.4" />
      <circle cx="17" cy="19.5" r="1.4" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z" />,
  hand: (
    <>
      <path d="M8 13V5.5a1.5 1.5 0 013 0V11M11 10.5v-7a1.5 1.5 0 013 0V11M14 6a1.5 1.5 0 013 0v7" />
      <path d="M17 9.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1a7 7 0 01-6-3.4l-2.3-4a1.5 1.5 0 012.6-1.5L8 13" />
    </>
  ),
};

export function Icon({ name, className, style, title }: { name: IconName; className?: string; style?: CSSProperties; title?: string }) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {P[name]}
    </svg>
  );
}

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { runAdd } from '../addAction';
import { useNoteHere } from './Notes';
import { QuickAddSheet } from './QuickAddSheet';
import { useHub } from '../context';
import { useRoute } from '../router';
import { NewFolderSheet } from './NewFolderSheet';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { primeKeyboard } from '../ui/keyboard';
import { haptic } from '../ui/haptics';
import { G } from '../ui/glyphs';
import { CLICK_SWALLOW_MS, DIST, SLOP } from '../ui/tokens';

/** New: what the current screen registered (addAction.ts), else the plain composer. */
export function useAdd() {
  const { openSheet } = useOverlays();
  return () => runAdd(() => openSheet((close) => <QuickAddSheet onClose={close} />));
}

/** The +'s choices, each drawn as the little thing it makes. */
function MenuGlyph({ kind }: { kind: 'task' | 'project' | 'note' }) {
  if (kind === 'task')
    return (
      // The folder's and the note's language: a flat pink disc, one ink line a touch heavier than
      // theirs (a circle reads lighter than a box), open at the top right where the tick leaves it.
      <svg className="addmenu__glyph" aria-hidden="true" viewBox="0 0 40 40">
        <circle cx="19.5" cy="21" r="14" fill="var(--pink)" />
        <circle cx="19.5" cy="21" r="14" fill="none" stroke="#0a0a04" strokeWidth="1.9" strokeLinecap="round" strokeDasharray="72.82 15.15" transform="rotate(-16.3 19.5 21)" />
        <path d="M12.1 21.4L16.9 26.2L31.8 7.2" fill="none" stroke="#0a0a04" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (kind === 'project')
    return (
      <svg className="addmenu__glyph" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M4 11.5a3 3 0 0 1 3-3h8.2l3.3 3.4H33a3 3 0 0 1 3 3V29a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="var(--sky)" stroke="#0a0a04" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M4 17.5a2.5 2.5 0 0 1 2.5-2.5h27a2.5 2.5 0 0 1 2.5 2.5V29a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="color-mix(in srgb, var(--sky) 55%, #fff)" stroke="#0a0a04" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg className="addmenu__glyph addmenu__glyph--note" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M7 8h26v17.5L24.5 34H7z" fill="var(--lemon)" stroke="#0a0a04" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M33 25.5L24.5 34v-6.5a2 2 0 0 1 2-2z" fill="color-mix(in srgb, var(--lemon) 60%, #0a0a04)" stroke="#0a0a04" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="14" y="4.5" width="12" height="6" rx="1" fill="rgb(255 255 255 / 0.75)" transform="rotate(-5 20 7.5)" />
      <path d="M12 17h13M12 21.5h9" stroke="rgb(10 10 4 / 0.55)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The +: what to make. Pressing it opens three choices over it at once (the + turns into an x): a
 * task (or a subtask, as the screen says), a folder (inside this one, on a folder's page), or a
 * sticky note for my person on this screen. A tap leaves them open to tap; or keep the finger
 * down, slide up to one (it lights up) and let go there: one gesture makes it. Let go anywhere
 * else, or back on the +, and nothing is made. N still makes a task straight away.
 */
export function AddMenu({ add, addLabel }: { add: () => void; addLabel: string }) {
  const route = useRoute();
  const hub = useHub();
  const { openSheet } = useOverlays();
  const note = useNoteHere();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  // A new page closes it (by where it is, not by the route object, which is new every render).
  const where = JSON.stringify(route);
  useEffect(() => setOpen(false), [where]);
  const here = route.name === 'list' ? hub.list(route.id) : route.name === 'item' ? hub.list(hub.item(route.id)?.listId) : route.name === 'shop' ? hub.shopRoot() : undefined;
  const inside = route.name === 'list' || route.name === 'shop' ? here : undefined;
  const choices: Array<{ key: string; label: string; face: ReactNode; run: () => void }> = [
    {
      key: 'task',
      label: addLabel === 'New' ? 'Task' : addLabel,
      face: <MenuGlyph kind="task" />,
      run: () => {
        primeKeyboard();
        add();
      },
    },
    {
      key: 'project',
      label: inside ? `Folder inside ${inside.name}` : 'Folder',
      face: <MenuGlyph kind="project" />,
      run: () => openSheet((close) => <NewFolderSheet onClose={close} parentId={inside?.id} />),
    },
    ...(note ? [{ key: 'note', label: `Sticky note for ${note.to}`, face: <MenuGlyph kind="note" />, run: note.open }] : []),
  ];
  // One finger on the +: did this press open it, and has it slid off to choose?
  const press = useRef<{ id: number; x: number; y: number; slid: boolean; opened: boolean } | null>(null);
  // The click a press ends in has been dealt with already (only the keyboard's click toggles).
  const pressed = useRef(false);
  const menu = useRef<HTMLDivElement>(null);
  const [aim, setAim] = useState<string | null>(null);
  const aimed = useRef<string | null>(null);
  const aimAt = (key: string | null) => {
    if (key === aimed.current) return;
    aimed.current = key;
    setAim(key);
    if (key) haptic('select');
  };
  /** The choice under the finger, or the nearest within reach; none over the + itself. */
  const choiceAt = (x: number, y: number, fab: HTMLElement): string | null => {
    const f = fab.getBoundingClientRect();
    if (Math.hypot(x - (f.left + f.width / 2), y - (f.top + f.height / 2)) <= f.width / 2) return null;
    let best: string | null = null;
    let near: number = DIST.reach;
    for (const el of menu.current?.querySelectorAll<HTMLElement>('.addmenu__item') ?? []) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (d < near) {
        near = d;
        best = el.dataset.key ?? null;
      }
    }
    return best;
  };
  const onDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, slid: false, opened: !open };
    // Moves keep coming to the + wherever the finger goes.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (!open) {
      haptic('select');
      setOpen(true);
    }
  };
  const onSlide = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.slid && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP.hold) p.slid = true;
    if (p.slid) aimAt(choiceAt(e.clientX, e.clientY, e.currentTarget));
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    pressed.current = true;
    setTimeout(() => (pressed.current = false), CLICK_SWALLOW_MS);
    const pick = p.slid ? choices.find((c) => c.key === choiceAt(e.clientX, e.clientY, e.currentTarget)) : undefined;
    aimAt(null);
    if (pick) {
      haptic('select');
      setOpen(false);
      pick.run();
    } else if (p.slid || !p.opened) {
      // Slid and let go on nothing (or back on the +): never mind. A tap on an open + closes it.
      if (!p.opened) haptic('select');
      setOpen(false);
    }
  };
  const onCancel = () => {
    const p = press.current;
    press.current = null;
    aimAt(null);
    if (p?.opened) setOpen(false);
  };
  return (
    <>
      {open ? <div className="addmenu__veil" onClick={() => setOpen(false)} aria-hidden="true" /> : null}
      {open ? (
        <div className="addmenu" role="menu" aria-label="New" ref={menu}>
          {choices.map((c, i) => (
            <button
              key={c.key}
              type="button"
              role="menuitem"
              data-key={c.key}
              className={`addmenu__item addmenu__item--${c.key} ${aim === c.key ? 'is-aimed' : ''}`}
              style={{ animationDelay: `${i * 35}ms` } as CSSProperties}
              onClick={() => {
                haptic('select');
                setOpen(false);
                c.run();
              }}
            >
              <span className="addmenu__label" dir="auto">
                {c.label}
              </span>
              <span className="addmenu__face">{c.face}</span>
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className={`fab ${open ? 'is-open' : ''}`}
        aria-label={open ? 'Close' : 'New'}
        aria-expanded={open}
        aria-haspopup="menu"
        title={open ? 'Close' : 'New: a task, a folder or a note'}
        aria-keyshortcuts="N"
        onPointerDown={onDown}
        onPointerMove={onSlide}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          // A press has said what it wanted already; this is the keyboard.
          if (pressed.current) return;
          haptic('select');
          setOpen(!open);
        }}
      >
        <Icon name={G.add} />
      </button>
    </>
  );
}

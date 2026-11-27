import { startTour, tourDone, tourList, tourWatch } from './tour';
import { updateReady } from './update';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { seedHousehold } from '../core/seed';
import { addDays, today as todayStr } from '../core/dates';
import { afterTick } from './notify';
import type { Persistence } from '../core/db';
import type { LineColor } from '../core/model';
import { loadSession, newSession, saveSession, sessionFromInvite } from '../core/session';
import { runAdd, useAddLabel } from './addAction';
import { IdeaTag, useIdeasBadge, useOpenIdeas } from './components/Ideas';
import { NotesLayer, useNoteHere } from './components/Notes';
import { announce, Arrivals, sawItHappen, useArrivalWatch } from './components/Arrivals';
import { SearchLayer } from './components/SearchLayer';
import { openSearch } from './search';
import { ShortcutsSheet, useHistory } from './undo';
import { quietly } from '../core/history';
import { pendingDraft, QuickAddSheet } from './components/QuickAddSheet';
import { TabBar } from './components/TabBar';
import { RuntimeProvider, useHub, useRt } from './context';
import { usePrefs } from './prefs';
import { LocalReminders, ReminderSync } from './reminders';
import { currentPath, navigate, useRoute } from './router';
import { openPersistence, startRuntime, swContainer, updateBadge, type Runtime } from './runtime';
import { ItemScreen } from './screens/ItemScreen';
import { ListScreen } from './screens/ListScreen';
import { Lists, NewProjectSheet } from './screens/Lists';
import { Onboarding, type OnboardResult } from './screens/Onboarding';
import { Settings } from './screens/Settings';
import { SyncDot } from './components/SyncBadge';
import { Today } from './screens/Today';
import { Icon } from './ui/Icon';
import { OverlayProvider, useOverlays } from './ui/overlays';
import { useBarEdit } from './barEdit';
import { Avatar, lightVar, lineVars, Logo } from './ui/primitives';
import { primeKeyboard } from './ui/keyboard';
import { haptic } from './ui/haptics';
import { cursorImage, setCursors } from './ui/cursors';
import { startLiveCursor } from './ui/liveCursor';
import { ProjectMark } from './ui/ProjectMark';
import { activeTabKey, pinsOf, tabsOf } from './tabs';
import { projectCount, todayRef, todayView } from './views';
import { listIdOf } from '../core/keys';
import { G } from './ui/glyphs';

type Phase = { name: 'boot' } | { name: 'onboard'; persistence: Persistence } | { name: 'ready'; rt: Runtime } | { name: 'error'; message: string };

/** New: what the current screen registered (addAction.ts), else the plain composer. */
function useAdd() {
  const { openSheet } = useOverlays();
  return () => runAdd(() => openSheet((close) => <QuickAddSheet onClose={close} />));
}

/**
 * A computer's top bar: the phone's tab bar, moved up and laid out flat. The brand; the tabs
 * (Today, your pins, Projects) in the middle; search, ideas and the two of us on the right.
 * Adding (the black +) and a note for my person float bottom right, as they do on the phone.
 */
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
 * The +: what to make. A tap opens three choices over it (the + turns into an x): a task (or a
 * subtask, as the screen says), a project (inside this one, on a project's
 * page), or a sticky note for my person on this screen. N still makes a task straight away.
 */
function AddMenu({ add, addLabel }: { add: () => void; addLabel: string }) {
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
      run: () => openSheet((close) => <NewProjectSheet onClose={close} parentId={inside?.id} />),
    },
    ...(note ? [{ key: 'note', label: `Sticky note for ${note.to}`, face: <MenuGlyph kind="note" />, run: note.open }] : []),
  ];
  return (
    <>
      {open ? <div className="addmenu__veil" onClick={() => setOpen(false)} aria-hidden="true" /> : null}
      {open ? (
        <div className="addmenu" role="menu" aria-label="New">
          {choices.map((c, i) => (
            <button
              key={c.key}
              type="button"
              role="menuitem"
              className={`addmenu__item addmenu__item--${c.key}`}
              style={{ animationDelay: `${(choices.length - 1 - i) * 35}ms` } as CSSProperties}
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
        onClick={() => {
          haptic('select');
          setOpen(!open);
        }}
      >
        <Icon name={G.add} />
      </button>
    </>
  );
}

function TopNav() {
  const route = useRoute();
  const hub = useHub();
  const openIdeas = useOpenIdeas();
  const ideas = useIdeasBadge();
  const prefs = usePrefs();
  const on = activeTabKey(hub, route);
  const v = todayView(hub, todayRef());
  // Today's due, and each pinned project's open things (with what's inside it).
  const counts: Record<string, number> = { today: v.dueCount };
  for (const k of pinsOf(hub)) {
    const l = hub.list(listIdOf(k));
    if (l) counts[k] = projectCount(hub, l).n;
  }
  const tabs = tabsOf(hub).filter((t) => t.key !== 'search');
  // A folder held over this bar: where it would land.
  const { aim } = useBarEdit();
  const me = hub.me();
  const partner = hub.partner();
  return (
    <header className="topnav">
      <div className="topnav__in">
        <button type="button" className="topnav__brand" onClick={() => navigate('/')} aria-label="Today">
          <Logo size={24} />
        </button>
        {/* Also where a folder dragged up lands, pinned (barEdit: [data-key], ends are anchors). */}
        <nav className={`topnav__tabs ${aim ? 'is-receiving' : ''} ${aim?.refusing ? 'is-refusing' : ''}`} aria-label="Places">
          {tabs.map((t, i) => {
            const anchor = t.key === 'today' || t.key === 'projects';
            const pinAt = tabs.slice(0, i).filter((x) => x.key !== 'today' && x.key !== 'projects').length;
            return (
            <button
              key={t.key}
              type="button"
              className={`topnav__tab ${on === t.key ? 'is-on' : ''} ${anchor ? 'is-anchor' : ''} ${aim && !aim.refusing && aim.at !== null && !anchor && aim.at === pinAt ? 'is-before' : ''} ${aim && !aim.refusing && aim.at !== null && t.key === 'projects' && aim.at >= tabs.length - 2 ? 'is-before' : ''}`}
              aria-current={on === t.key ? 'page' : undefined}
              onClick={() => navigate(t.path)}
              data-drop-list={listIdOf(t.key) ?? undefined}
              data-tab={t.key}
              data-key={t.key}
            >
              {t.icon ? <Icon name={t.icon} /> : <ProjectMark color={t.color} icon={t.glyph} size="sm" />}
              <span dir="auto">{t.label}</span>
              {counts[t.key] ? <span className="topnav__count num">{counts[t.key]}</span> : null}
            </button>
            );
          })}
        </nav>
        <div className="topnav__end">
          <button type="button" className="topnav__search" onClick={() => openSearch()} aria-label="Search" aria-keyshortcuts="/">
            <Icon name={G.search} className="icon--sm" />
            <span>Search</span>
            <span className="kbd">/</span>
          </button>
          {prefs.ideasTag ? (
            <button type="button" className="topnav__icon" onClick={openIdeas} aria-label={`Ideas${ideas.n ? `, ${ideas.n} open` : ''}`} title="Ideas for Gila Hub">
              <Icon name={G.idea} />
              {ideas.fresh && ideas.partner ? <span className="topnav__dot" style={lineVars(ideas.partner.color)} /> : ideas.n ? <span className="topnav__n num">{ideas.n}</span> : null}
            </button>
          ) : null}
          <button type="button" className={`topnav__us ${route.name === 'settings' ? 'is-on' : ''}`} onClick={() => navigate({ name: 'settings' })} aria-label="Settings" title="Settings">
            <span className="topnav__faces">
              <Avatar member={me} size="sm" />
              {partner ? <Avatar member={partner} size="sm" /> : null}
            </span>
            <SyncDot />
          </button>
        </div>
      </div>
    </header>
  );
}

function Screen() {
  const route = useRoute();
  const hub = useHub();
  switch (route.name) {
    case 'today':
      return <Today />;
    case 'shop': {
      // An old link to the Shopping tab: the Shopping project, like any other.
      const root = hub.shopRoot();
      return root ? <ListScreen key={root.id} id={root.id} /> : <Lists />;
    }
    case 'chores':
      // Chores are ordinary projects now: an old link lands on Projects.
      return <Lists />;
    case 'lists':
      return <Lists />;
    case 'list':
      return <ListScreen key={route.id} id={route.id} />;
    case 'item':
      return <ItemScreen key={route.id} id={route.id} />;
    case 'settings':
      return <Settings />;
  }
}

/** Background duties: my color, badge, reminders, sync wake-ups, keyboard. */
function Duties() {
  const rt = useRt();
  const hub = useHub();
  const prefs = usePrefs();
  const { toast, openSheet } = useOverlays();
  const add = useAdd();
  const me = hub.me();
  useArrivalWatch(hub);

  // Start here: tick off what the data shows was done; when it's all done, bow out.
  useEffect(() => {
    if (!tourWatch(hub)) return;
    const list = tourList(hub);
    if (!list) return;
    quietly(hub.store, () => hub.updateList(list.id, { archived: true }));
    toast('You know your way around', { action: { label: 'Keep it', run: () => hub.updateList(list.id, { archived: false }) } });
  });
  useEffect(() => {
    const onScrub = () => tourDone(hub, 'bar');
    window.addEventListener('gila:scrubbed', onScrub);
    return () => window.removeEventListener('gila:scrubbed', onScrub);
  }, [hub]);

  const partnerColor = hub.partner()?.color;
  useEffect(() => {
    if (!me) return;
    const root = document.documentElement.style;
    root.setProperty('--me', `var(--${me.color})`);
    // Icons light up in my color; my partner's things carry theirs (docs/03, Icons).
    root.setProperty('--me-light', lightVar(me.color));
    root.setProperty('--them', partnerColor ? lightVar(partnerColor) : 'var(--tile-2)');
    // The mouse wears our hands, lit in my colour.
    setCursors(lightVar(me.color));
  }, [me?.color, me, partnerColor]);

  useEffect(() => {
    void updateBadge(todayView(hub, todayRef()).dueCount, prefs.badge);
  });

  useEffect(() => {
    const reminders = new ReminderSync(rt);
    const local = new LocalReminders(hub, (r) => {
      // Already done (from the notification itself, maybe): nothing to say.
      const id = /^\/i\/([A-Za-z0-9]+)/.exec(r.note.url ?? '')?.[1];
      if (id && hub.item(id)?.done) return;
      // Only while I'm looking; in the background the phone's own notification says it.
      if (sawItHappen(r.at)) announce({ kind: 'reminder', title: r.note.title, body: r.note.body, url: r.note.url });
      // With a relay, push already delivers the system notification.
      if (!rt.relay && 'Notification' in window && Notification.permission === 'granted') {
        void swContainer()?.getRegistration().then((reg) => reg?.showNotification(r.note.title, { body: r.note.body, tag: r.note.tag, data: { url: r.note.url } }));
      }
    });
    const run = () => {
      reminders.schedule();
      local.refresh();
    };
    run();
    const off = rt.store.subscribe(run);
    const offRelay = rt.onRelay(run);
    quietly(hub.store, () => hub.autoArchive());
    try {
      if (!localStorage.getItem('gila-hub:project-icons')) {
        quietly(hub.store, () => hub.fillIcons());
        localStorage.setItem('gila-hub:project-icons', '1');
      }
    } catch {
      /* storage blocked: next time */
    }
    const timer = setInterval(() => {
      quietly(hub.store, () => hub.autoArchive());
      local.refresh();
    }, 15 * 60_000);
    return () => {
      off();
      offRelay();
      local.stop();
      clearInterval(timer);
    };
  }, [rt, hub, toast]);

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'visible') void rt.ensureSync();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    const relayRetry = setInterval(() => !rt.relay && void rt.ensureSync(), 60_000);
    const onSwMessage = (e: MessageEvent) => {
      if (e.data?.type === 'navigate' && typeof e.data.url === 'string') navigate(e.data.url);
      // A notification's Done / Tomorrow, tapped while the app sits in the background: done here, quietly.
      if (e.data?.type === 'act' && typeof e.data.id === 'string') {
        const it = rt.hub.item(e.data.id);
        if (it && e.data.act === 'done' && !it.done && rt.hub.canEdit(it)) {
          rt.hub.toggle(it.id);
          afterTick(rt, rt.hub, it.id);
          toast(`✓ ${it.title}`);
        } else if (it && e.data.act === 'later') {
          rt.hub.snooze(it.id, addDays(todayStr(), 1));
          toast(`${it.title}: tomorrow`);
        }
      }
      // A push while I'm looking: in the app, not over it.
      if (e.data?.type === 'push' && e.data.note?.title) announce({ title: e.data.note.title, body: e.data.note.body, url: e.data.note.url, kind: /^\/i\//.test(e.data.note.url ?? '') ? 'reminder' : 'other' });
    };
    const sw = swContainer();
    sw?.addEventListener('message', onSwMessage);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      clearInterval(relayRetry);
      sw?.removeEventListener('message', onSwMessage);
    };
  }, [rt, toast]);

  useEffect(() => {
    const onUpdate = () => toast('A new version is ready', { action: { label: 'Refresh', run: () => location.reload() }, ms: 120_000 });
    // It may have been found before this screen was up (the check runs at launch).
    if (updateReady()) onUpdate();
    window.addEventListener('gila:update', onUpdate);
    return () => window.removeEventListener('gila:update', onUpdate);
  }, [toast]);

  // Undo and redo: anywhere but in a field (there the field's own undo works on its text).
  const history = useHistory(hub);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (!mod || e.altKey || !(k === 'z' || k === 'y')) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      const redo = k === 'y' || e.shiftKey;
      const ok = redo ? history.redo() : history.undo();
      haptic('select');
      if (!ok) toast(redo ? 'Nothing to redo' : 'Nothing to undo');
      else
        toast(redo ? 'Done again' : 'Undone', {
          action: { label: redo ? 'Undo' : 'Redo', run: () => void (redo ? history.undo() : history.redo()) },
        });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, toast]);

  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') {
        e.preventDefault();
        if (!document.querySelector('.sheet')) openSheet((close) => <ShortcutsSheet onClose={close} />);
        return;
      }
      // Not under a sheet, nor in an edit mode (Arrange the bar): keys there belong to it.
      if (document.querySelector('.sheet') || document.documentElement.classList.contains('is-editing')) return;
      // G, then a letter: go somewhere.
      if (performance.now() - g < 1200) {
        g = 0;
        const to = { t: { name: 'today' }, f: { name: 'lists' }, s: { name: 'settings' } }[e.key.toLowerCase()] as Parameters<typeof navigate>[0] | undefined;
        if (to) {
          e.preventDefault();
          navigate(to);
          return;
        }
      }
      if (e.key === 'g' || e.key === 'G') {
        g = performance.now();
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        openSearch();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        add();
      } else if (/^[1-9]$/.test(e.key)) {
        const t = tabsOf(hub)[+e.key - 1];
        if (t) navigate(t.path);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [add, hub, openSheet]);

  return null;
}

function Shell() {
  const route = useRoute();
  const add = useAdd();
  const addLabel = useAddLabel();
  // An old /search link (or bookmark): Today, with search open over it.
  useEffect(() => {
    if (currentPath() === '/search') {
      navigate('/', { replace: true });
      openSearch();
    }
  }, []);
  // Something was being written in New when the app reloaded: open it again, as it was.
  const hub = useHub();
  const { openSheet } = useOverlays();
  useEffect(() => {
    const draft = pendingDraft(hub);
    if (draft) openSheet((close) => <QuickAddSheet onClose={close} restore={draft} />);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="app">
      <TopNav />
      <main className="main">
        <Screen />
      </main>
      <TabBar />
      {route.name === 'settings' ? null : <AddMenu add={add} addLabel={addLabel} />}
      <IdeaTag />
      <NotesLayer />
      <Arrivals />
      <SearchLayer />
      <Duties />
    </div>
  );
}

async function completeOnboarding(persistence: Persistence, r: OnboardResult): Promise<Runtime> {
  const session = r.invite ? sessionFromInvite(r.invite) : newSession('');
  // An invite or a recovery code brings this device into a household that's already there.
  await saveSession(persistence, session, !!r.invite);
  const rt = await startRuntime(persistence, session);
  if (r.kind === 'new' || r.kind === 'partner') {
    rt.store.batch(() => {
      rt.hub.upsertMember(session.memberId, { name: r.name!, color: r.color as LineColor, createdAt: Date.now(), shopAlerts: true });
      if (r.kind === 'new') seedHousehold(rt.hub, r.projects ?? [], r.colors);
    });
    // The way in: a small Start here project of your own whose things say what to do.
    startTour(rt.hub);
  }
  return rt;
}

/** Boot exactly once per page load (StrictMode runs effects twice in development). */
let booting: Promise<Phase> | null = null;
function boot(): Promise<Phase> {
  booting ??= (async (): Promise<Phase> => {
    try {
      const persistence = await openPersistence();
      const session = await loadSession(persistence);
      if (!session) return { name: 'onboard', persistence };
      const rt = await startRuntime(persistence, session);
      void navigator.storage?.persist?.().catch(() => {});
      return { name: 'ready', rt };
    } catch (e) {
      console.error(e);
      return { name: 'error', message: 'Gila Hub couldn’t open its storage on this device.' };
    }
  })();
  return booting;
}

/**
 * On a computer, the cursor comes alive from the first screen (welcome included): it leans,
 * wiggles and waves (ui/liveCursor.ts). Lemon until I've a colour; Duties then lights it in mine.
 */
function LiveCursor() {
  const prefs = usePrefs();
  useEffect(() => {
    if (!cursorImage('arrow')) setCursors('#e8ff1f');
    return startLiveCursor(prefs.livelyCursor);
  }, [prefs.livelyCursor]);
  return null;
}

export function App() {
  return (
    <>
      <LiveCursor />
      <AppPhases />
    </>
  );
}

function AppPhases() {
  const [phase, setPhase] = useState<Phase>({ name: 'boot' });

  useEffect(() => {
    let alive = true;
    void boot().then((p) => alive && setPhase(p));
    return () => {
      alive = false;
    };
  }, []);

  if (phase.name === 'boot') return <div className="boot" aria-busy="true" />;
  if (phase.name === 'error')
    return (
      <div className="onboard">
        <div className="onboard__body">
          <h1 className="onboard__q">{phase.message}</h1>
          <p>Private browsing can block storage. Try a normal window.</p>
        </div>
      </div>
    );
  if (phase.name === 'onboard')
    return (
      <OverlayProvider>
        <Onboarding
          onDone={async (r) => {
            const rt = await completeOnboarding(phase.persistence, r);
            try {
              history.replaceState(null, '', '/');
            } catch {
              /* sandboxed frame */
            }
            void navigator.storage?.persist?.().catch(() => {});
            setPhase({ name: 'ready', rt });
          }}
        />
      </OverlayProvider>
    );
  return (
    <RuntimeProvider rt={phase.rt}>
      <OverlayProvider>
        <Shell />
      </OverlayProvider>
    </RuntimeProvider>
  );
}

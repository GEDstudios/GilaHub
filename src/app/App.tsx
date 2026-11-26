import { startTour, tourDone, tourList, tourWatch } from './tour';
import { updateReady } from './update';
import { useEffect, useState } from 'react';
import { seedHousehold } from '../core/actions';
import { addDays, today as todayStr } from '../core/dates';
import { afterTick } from './notify';
import type { Persistence } from '../core/db';
import type { LineColor } from '../core/model';
import { loadSession, newSession, saveSession, sessionFromInvite } from '../core/session';
import { runAdd, useAddLabel } from './addAction';
import { IdeaTag, useIdeasBadge, useOpenIdeas } from './components/Ideas';
import { NoteButton, NotesLayer } from './components/Notes';
import { announce, Arrivals, sawItHappen, useArrivalWatch } from './components/Arrivals';
import { SearchLayer } from './components/SearchLayer';
import { openSearch } from './search';
import { QuickAddSheet } from './components/QuickAddSheet';
import { TabBar } from './components/TabBar';
import { RuntimeProvider, useHub, useRt } from './context';
import { usePrefs } from './prefs';
import { LocalReminders, ReminderSync } from './reminders';
import { currentPath, navigate, useRoute } from './router';
import { openPersistence, startRuntime, swContainer, updateBadge, type Runtime } from './runtime';
import { ItemScreen } from './screens/ItemScreen';
import { ListScreen } from './screens/ListScreen';
import { Lists } from './screens/Lists';
import { Onboarding, type OnboardResult } from './screens/Onboarding';
import { Settings } from './screens/Settings';
import { Shopping } from './screens/Shopping';
import { SyncDot } from './components/SyncBadge';
import { Today } from './screens/Today';
import { Icon } from './ui/Icon';
import { OverlayProvider, useOverlays } from './ui/overlays';
import { Avatar, Fab, lightVar, lineVars, Logo } from './ui/primitives';
import { cursorImage, setCursors } from './ui/cursors';
import { startLiveCursor } from './ui/liveCursor';
import { ProjectMark } from './ui/ProjectMark';
import { activeTabKey, tabsOf } from './tabs';
import { todayRef, todayView } from './views';

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
function TopNav() {
  const route = useRoute();
  const hub = useHub();
  const openIdeas = useOpenIdeas();
  const ideas = useIdeasBadge();
  const prefs = usePrefs();
  const on = activeTabKey(hub, route);
  const v = todayView(hub, todayRef());
  const counts: Record<string, number> = { today: v.dueCount, shop: v.shopping.count };
  const tabs = tabsOf(hub).filter((t) => t.key !== 'search');
  const me = hub.me();
  const partner = hub.partner();
  return (
    <header className="topnav">
      <div className="topnav__in">
        <button type="button" className="topnav__brand" onClick={() => navigate('/')} aria-label="Today">
          <Logo size={24} />
        </button>
        <nav className="topnav__tabs" aria-label="Places">
          {tabs.map((t) => (
            <button key={t.key} type="button" className={`topnav__tab ${on === t.key ? 'is-on' : ''}`} aria-current={on === t.key ? 'page' : undefined} onClick={() => navigate(t.path)}>
              {t.icon ? <Icon name={t.icon} /> : <ProjectMark color={t.color} icon={t.glyph} size="sm" />}
              <span dir="auto">{t.label}</span>
              {counts[t.key] ? <span className="topnav__count num">{counts[t.key]}</span> : null}
            </button>
          ))}
        </nav>
        <div className="topnav__end">
          <button type="button" className="topnav__search" onClick={() => openSearch()} aria-label="Search" aria-keyshortcuts="/">
            <Icon name="search" className="icon--sm" />
            <span>Search</span>
            <span className="kbd">/</span>
          </button>
          {prefs.ideasTag ? (
            <button type="button" className="topnav__icon" onClick={openIdeas} aria-label={`Ideas${ideas.n ? `, ${ideas.n} open` : ''}`} title="Ideas for Gila Hub">
              <Icon name="lightbulb" />
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
  switch (route.name) {
    case 'today':
      return <Today />;
    case 'shop':
      return <Shopping />;
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
  const { toast } = useOverlays();
  const add = useAdd();
  const me = hub.me();
  useArrivalWatch(hub);

  // Start here: tick off what the data shows was done; when it's all done, bow out.
  useEffect(() => {
    if (!tourWatch(hub)) return;
    const list = tourList(hub);
    if (!list) return;
    hub.updateList(list.id, { archived: true });
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
    hub.autoArchive();
    try {
      if (!localStorage.getItem('gila-hub:project-icons')) {
        hub.fillIcons();
        localStorage.setItem('gila-hub:project-icons', '1');
      }
    } catch {
      /* storage blocked: next time */
    }
    const timer = setInterval(() => {
      hub.autoArchive();
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
        if (it && e.data.act === 'done' && !it.done && rt.hub.canTick(it)) {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      // Not under a sheet, nor in an edit mode (Arrange the bar): keys there belong to it.
      if (document.querySelector('.sheet') || document.documentElement.classList.contains('is-editing')) return;
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
  }, [add, hub]);

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
  return (
    <div className="app">
      <TopNav />
      <main className="main">
        <Screen />
      </main>
      <TabBar />
      {route.name === 'settings' ? null : <Fab label={addLabel} onClick={add} />}
      <IdeaTag />
      <NoteButton />
      <NotesLayer />
      <Arrivals />
      <SearchLayer />
      <Duties />
    </div>
  );
}

async function completeOnboarding(persistence: Persistence, r: OnboardResult): Promise<Runtime> {
  const session = r.invite ? sessionFromInvite(r.invite) : newSession('');
  await saveSession(persistence, session);
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

import { useEffect, useState } from 'react';
import { seedHousehold } from '../core/actions';
import type { Persistence } from '../core/db';
import type { LineColor } from '../core/model';
import { loadSession, newSession, saveSession, sessionFromInvite } from '../core/session';
import { runAdd, useAddLabel } from './addAction';
import { IdeaTag } from './components/Ideas';
import { QuickAddSheet } from './components/QuickAddSheet';
import { TabBar } from './components/TabBar';
import { RuntimeProvider, useHub, useRt } from './context';
import { usePrefs } from './prefs';
import { LocalReminders, ReminderSync } from './reminders';
import { navigate, useRoute } from './router';
import { openPersistence, startRuntime, swContainer, updateBadge, type Runtime } from './runtime';
import { Chores } from './screens/Chores';
import { ItemScreen } from './screens/ItemScreen';
import { ListScreen } from './screens/ListScreen';
import { Lists } from './screens/Lists';
import { Onboarding, type OnboardResult } from './screens/Onboarding';
import { Search } from './screens/Search';
import { Settings } from './screens/Settings';
import { Shopping } from './screens/Shopping';
import { SyncDot } from './components/SyncBadge';
import { Today } from './screens/Today';
import { Icon } from './ui/Icon';
import { OverlayProvider, useOverlays } from './ui/overlays';
import { lightVar, Logo } from './ui/primitives';
import { ProjectMark } from './ui/ProjectMark';
import { activeTabKey, tabsOf } from './tabs';
import { openCount, todayRef, todayView } from './views';

type Phase = { name: 'boot' } | { name: 'onboard'; persistence: Persistence } | { name: 'ready'; rt: Runtime } | { name: 'error'; message: string };

/** New: what the current screen registered (addAction.ts), else the plain composer. */
function useAdd() {
  const { openSheet } = useOverlays();
  return () => runAdd(() => openSheet((close) => <QuickAddSheet onClose={close} />));
}

function Sidebar() {
  const route = useRoute();
  const hub = useHub();
  const add = useAdd();
  const addLabel = useAddLabel();
  const tabs = tabsOf(hub);
  const on = activeTabKey(hub, route);
  const v = todayView(hub, todayRef());
  const counts: Record<string, number> = { today: v.dueCount, shop: v.shopping.count };
  return (
    <aside className="sidebar" aria-label="Navigation">
      <div className="sidebar__brand">
        <Logo size={28} />
      </div>
      <button type="button" className="sidebar__new" onClick={add} title={addLabel} aria-label={addLabel === 'New' ? 'New' : `New: ${addLabel}`} aria-keyshortcuts="N">
        <Icon name="plus" className="icon--sm" /> New
        <span className="kbd">N</span>
      </button>
      <nav className="sidebar__nav">
        {tabs.map((t) => (
          <button key={t.key} type="button" className={`navitem ${on === t.key ? 'is-on' : ''}`} onClick={() => navigate(t.path)}>
            {t.icon ? <Icon name={t.icon} /> : <ProjectMark color={t.color} icon={t.glyph} size="sm" />}
            <span className="navitem__label" dir="auto">
              {t.label}
            </span>
            {counts[t.key] ? <span className="navitem__count">{counts[t.key]}</span> : t.key === 'search' ? <span className="navitem__count kbd">/</span> : null}
          </button>
        ))}
        {tabs.some((t) => t.key === 'search') ? null : (
          <button type="button" className={`navitem ${route.name === 'search' ? 'is-on' : ''}`} onClick={() => navigate({ name: 'search' })}>
            <Icon name="search" />
            <span className="navitem__label">Search</span>
            <span className="navitem__count kbd">/</span>
          </button>
        )}
      </nav>
      <div className="sidebar__label">Projects</div>
      <nav className="sidebar__nav">
        {hub.lists().map((l) => (
          <button
            key={l.id}
            type="button"
            className={`navitem ${route.name === 'list' && route.id === l.id ? 'is-on' : ''}`}
            onClick={() => navigate({ name: 'list', id: l.id })}
          >
            <ProjectMark color={l.color} icon={l.icon} size="sm" />
            <span className="navitem__label" dir="auto">
              {l.name}
            </span>
            {l.visibility === 'private' ? <Icon name="lock" className="icon--sm" /> : null}
            <span className="navitem__count">{openCount(hub, l.id) || ''}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar__foot">
        <button type="button" className={`navitem ${route.name === 'settings' ? 'is-on' : ''}`} onClick={() => navigate({ name: 'settings' })}>
          <Icon name="gear" />
          <span className="navitem__label">Settings</span>
          <SyncDot />
        </button>
      </div>
    </aside>
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
      return <Chores />;
    case 'lists':
      return <Lists />;
    case 'list':
      return <ListScreen key={route.id} id={route.id} />;
    case 'item':
      return <ItemScreen key={route.id} id={route.id} />;
    case 'settings':
      return <Settings />;
    case 'search':
      return <Search />;
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

  const partnerColor = hub.partner()?.color;
  useEffect(() => {
    if (!me) return;
    const root = document.documentElement.style;
    root.setProperty('--me', `var(--${me.color})`);
    // Icons light up in my color; my partner's things carry theirs (docs/03, Icons).
    root.setProperty('--me-light', lightVar(me.color));
    root.setProperty('--them', partnerColor ? lightVar(partnerColor) : 'var(--tile-2)');
  }, [me?.color, me, partnerColor]);

  useEffect(() => {
    void updateBadge(todayView(hub, todayRef()).dueCount, prefs.badge);
  });

  useEffect(() => {
    const reminders = new ReminderSync(rt);
    const local = new LocalReminders(hub, (r) => {
      toast(`Reminder: ${r.note.title}`);
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
    };
    const sw = swContainer();
    sw?.addEventListener('message', onSwMessage);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      clearInterval(relayRetry);
      sw?.removeEventListener('message', onSwMessage);
    };
  }, [rt]);

  useEffect(() => {
    const onUpdate = () => toast('A new version is ready', { action: { label: 'Refresh', run: () => location.reload() }, ms: 120_000 });
    window.addEventListener('gila:update', onUpdate);
    return () => window.removeEventListener('gila:update', onUpdate);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('.sheet')) return;
      if (e.key === '/') {
        e.preventDefault();
        navigate({ name: 'search' });
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
  // Settings arranges the bar and shows its own preview, so the floating one steps aside there.
  const route = useRoute();
  const bar = route.name !== 'settings';
  useEffect(() => {
    document.documentElement.classList.toggle('no-tabbar', !bar);
  }, [bar]);
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Screen />
      </main>
      {bar ? <TabBar /> : null}
      <IdeaTag />
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

export function App() {
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

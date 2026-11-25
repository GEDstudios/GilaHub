import { useEffect, useState } from 'react';
import { seedHousehold } from '../core/actions';
import type { Persistence } from '../core/db';
import type { LineColor } from '../core/model';
import { loadSession, newSession, saveSession, sessionFromInvite } from '../core/session';
import { runAdd } from './addAction';
import { QuickAddSheet } from './components/QuickAddSheet';
import { RuntimeProvider, useHub, usePartnerShopping, useRt } from './context';
import { applyTheme, getPrefs, usePrefs } from './prefs';
import { LocalReminders, ReminderSync } from './reminders';
import { navigate, useRoute, type Route } from './router';
import { openPersistence, startRuntime, swContainer, updateBadge, type Runtime } from './runtime';
import { Chores } from './screens/Chores';
import { ItemScreen } from './screens/ItemScreen';
import { ListScreen } from './screens/ListScreen';
import { Lists } from './screens/Lists';
import { Onboarding, type OnboardResult } from './screens/Onboarding';
import { Search } from './screens/Search';
import { Settings } from './screens/Settings';
import { Shopping } from './screens/Shopping';
import { SyncBadge, Today } from './screens/Today';
import { Icon, type IconName } from './ui/Icon';
import { OverlayProvider, useOverlays } from './ui/overlays';
import { ListBullet, Logo } from './ui/primitives';
import { openCount, todayRef, todayView } from './views';

type Phase = { name: 'boot' } | { name: 'onboard'; persistence: Persistence } | { name: 'ready'; rt: Runtime } | { name: 'error'; message: string };

const TABS: Array<{ route: Route['name']; label: string; icon: IconName; path: string }> = [
  { route: 'today', label: 'Today', icon: 'sun', path: '/' },
  { route: 'shop', label: 'Shopping', icon: 'bag', path: '/shop' },
  { route: 'chores', label: 'Chores', icon: 'sparkle', path: '/chores' },
  { route: 'lists', label: 'Projects', icon: 'lines', path: '/lists' },
];

function activeTab(r: Route, rt: Runtime): Route['name'] {
  if (r.name === 'list') return rt.hub.list(r.id)?.kind === 'chores' ? 'chores' : 'lists';
  if (r.name === 'item') {
    const kind = rt.hub.list(rt.hub.item(r.id)?.listId)?.kind;
    return kind === 'chores' ? 'chores' : kind === 'shopping' ? 'shop' : 'lists';
  }
  return r.name;
}

function useAdd() {
  const { openSheet } = useOverlays();
  return () => runAdd(() => openSheet((close) => <QuickAddSheet onClose={close} />));
}

function TabBar() {
  const route = useRoute();
  const rt = useRt();
  useHub();
  const shopping = usePartnerShopping();
  const add = useAdd();
  const on = activeTab(route, rt);
  const tab = (t: (typeof TABS)[number]) => (
    <a
      key={t.route}
      href={t.path}
      className={`tab ${on === t.route ? 'is-on' : ''}`}
      aria-current={on === t.route ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(t.path);
      }}
    >
      <Icon name={t.icon} />
      {t.label}
      {t.route === 'shop' && shopping ? <span className="tab__live live" /> : null}
    </a>
  );
  return (
    <>
      <nav className="tabbar" aria-label="Main">
        {tab(TABS[0])}
        {tab(TABS[1])}
        <span aria-hidden="true" />
        {tab(TABS[2])}
        {tab(TABS[3])}
      </nav>
      <button type="button" className="fab" aria-label="Add" onClick={add}>
        <Icon name="plus" className="icon--lg" />
      </button>
    </>
  );
}

function Sidebar() {
  const route = useRoute();
  const rt = useRt();
  const hub = useHub();
  const on = activeTab(route, rt);
  const add = useAdd();
  const v = todayView(hub, todayRef());
  const counts: Partial<Record<Route['name'], number>> = { today: v.dueCount, shop: v.shopping.count };
  return (
    <aside className="sidebar" aria-label="Navigation">
      <div className="sidebar__brand">
        <Logo size={30} />
      </div>
      <button type="button" className="btn btn--block sidebar__new" onClick={add}>
        <Icon name="plus" className="icon--sm" /> New
      </button>
      <nav className="sidebar__nav">
        {TABS.map((t) => (
          <button key={t.route} type="button" className={`navitem ${on === t.route ? 'is-on' : ''}`} onClick={() => navigate(t.path)}>
            <Icon name={t.icon} />
            {t.label}
            {counts[t.route] ? <span className="navitem__count">{counts[t.route]}</span> : null}
          </button>
        ))}
        <button type="button" className={`navitem ${route.name === 'search' ? 'is-on' : ''}`} onClick={() => navigate({ name: 'search' })}>
          <Icon name="search" />
          Search <span className="navitem__count kbd">/</span>
        </button>
      </nav>
      <div className="sidebar__label">Projects</div>
      <nav className="sidebar__nav">
        {hub.lists().map((l) => (
          <button
            key={l.id}
            type="button"
            className={`navitem ${route.name === 'list' && route.id === l.id ? 'is-on' : ''}`}
            onClick={() => navigate(l.kind === 'shopping' ? '/shop' : { name: 'list', id: l.id })}
          >
            <ListBullet list={l} size="sm" />
            <span dir="auto" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          Settings
          <span style={{ marginLeft: 'auto' }}>
            <SyncBadge />
          </span>
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
  const { openSheet, toast } = useOverlays();
  const me = hub.me();

  useEffect(() => {
    if (!me) return;
    const root = document.documentElement.style;
    root.setProperty('--me', `var(--${me.color})`);
    root.setProperty('--me-ink', `var(--${me.color}-ink)`);
  }, [me?.color, me]);

  useEffect(() => {
    void updateBadge(todayView(hub, todayRef()).dueCount, prefs.badge);
  });

  useEffect(() => {
    const reminders = new ReminderSync(rt);
    const local = new LocalReminders(hub, (r) => {
      toast(`⏰ ${r.note.title}`);
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
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('.sheet')) return;
      if (e.key === '/') {
        e.preventDefault();
        navigate({ name: 'search' });
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openSheet((close) => <QuickAddSheet onClose={close} />);
      } else if (['1', '2', '3', '4'].includes(e.key)) navigate(TABS[+e.key - 1].path);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSheet]);

  return null;
}

function Shell() {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Screen />
      </main>
      <TabBar />
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
      if (r.kind === 'new') seedHousehold(rt.hub, r.projects ?? []);
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
    applyTheme(getPrefs().theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(getPrefs().theme);
    mq.addEventListener('change', onChange);
    let alive = true;
    void boot().then((p) => alive && setPhase(p));
    return () => {
      alive = false;
      mq.removeEventListener('change', onChange);
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

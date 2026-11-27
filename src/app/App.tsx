import { useEffect, useState } from 'react';
import { useAddLabel } from './addAction';
import { IdeaTag } from './components/Ideas';
import { NotesLayer } from './components/Notes';
import { Arrivals } from './components/Arrivals';
import { SearchLayer } from './components/SearchLayer';
import { openSearch } from './search';
import { pendingDraft, QuickAddSheet } from './components/QuickAddSheet';
import { TabBar } from './components/TabBar';
import { RuntimeProvider, useHub } from './context';
import { usePrefs } from './usePrefs';
import { currentPath, navigate, useRoute } from './router';
import { ItemScreen } from './screens/ItemScreen';
import { FolderScreen } from './screens/FolderScreen';
import { Folders } from './screens/Folders';
import { Onboarding } from './screens/Onboarding';
import { Settings } from './screens/Settings';
import { Today } from './screens/Today';
import { OverlayProvider, useOverlays } from './ui/overlays';
import { cursorImage, setCursors } from './ui/cursors';
import { startLiveCursor } from './ui/liveCursor';
import { AddMenu, useAdd } from './components/AddMenu';
import { TopNav } from './components/TopNav';
import { Duties } from './components/Duties';
import { boot, completeOnboarding, type Phase } from './boot';

function Screen() {
  const route = useRoute();
  const hub = useHub();
  switch (route.name) {
    case 'today':
      return <Today />;
    case 'shop': {
      // An old link to the Shopping tab: the Shopping folder, like any other.
      const root = hub.shopRoot();
      return root ? <FolderScreen key={root.id} id={root.id} /> : <Folders />;
    }
    case 'chores':
      // Chores are ordinary folders now: an old link lands on Folders.
      return <Folders />;
    case 'lists':
      return <Folders />;
    case 'list':
      return <FolderScreen key={route.id} id={route.id} />;
    case 'item':
      return <ItemScreen key={route.id} id={route.id} />;
    case 'settings':
      return <Settings />;
  }
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

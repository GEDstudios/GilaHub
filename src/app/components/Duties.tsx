import { tourDone, tourList, tourWatch } from '../tour';
import { updateReady } from '../update';
import { useEffect } from 'react';
import { addDays, today as todayStr } from '../../core/dates';
import { afterTick } from '../notify';
import { announce, sawItHappen, useArrivalWatch } from './Arrivals';
import { openSearch } from '../search';
import { ShortcutsSheet, useHistory } from '../undo';
import { quietly } from '../../core/history';
import { useHub, useRt } from '../context';
import { usePrefs } from '../usePrefs';
import { LocalReminders, ReminderSync } from '../reminders';
import { navigate } from '../router';
import { swContainer, updateBadge } from '../runtime';
import { useOverlays } from '../ui/overlays';
import { lightVar } from '../ui/primitives';
import { haptic } from '../ui/haptics';
import { setCursors } from '../ui/cursors';
import { tabsOf } from '../tabs';
import { todayRef, todayView } from '../views';
import { useAdd } from './AddMenu';

/** Background duties: my color, badge, reminders, sync wake-ups, keyboard. */
export function Duties() {
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

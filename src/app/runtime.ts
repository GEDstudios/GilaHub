import { Hub } from '../core/actions';
import { sealJSON } from '../core/crypto';
import { IdbPersistence, MemoryPersistence, type Persistence } from '../core/db';
import type { Scope } from '../core/model';
import { api, authToken, keyring, readableScopes, relayAvailable, saveSession, type Session } from '../core/session';
import { Store } from '../core/store';
import { SyncClient } from '../core/sync';

/** Everything the running app needs, created once per session. */
export interface Runtime {
  persistence: Persistence;
  session: Session;
  store: Store;
  hub: Hub;
  sync: SyncClient | null;
  /** Is a relay reachable for this household? (false = local-only) */
  relay: boolean;
  ensureSync: () => Promise<void>;
  onRelay: (fn: () => void) => () => void;
}

export async function openPersistence(): Promise<Persistence> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no idb');
    return await IdbPersistence.open();
  } catch {
    return new MemoryPersistence();
  }
}

export async function startRuntime(persistence: Persistence, session: Session): Promise<Runtime> {
  const store = await Store.load(persistence, session.deviceId, readableScopes(session));
  const hub = new Hub(store, session.memberId);
  const relayListeners = new Set<() => void>();

  const rt: Runtime = {
    persistence,
    session,
    store,
    hub,
    sync: null,
    relay: false,
    onRelay: (fn) => {
      relayListeners.add(fn);
      return () => relayListeners.delete(fn);
    },
    ensureSync: async () => {
      if (rt.sync) {
        rt.sync.poke();
        return;
      }
      const everSynced = (await persistence.getMeta<boolean>('everSynced')) ?? false;
      const available = await relayAvailable(session.apiBase);
      if (!available && !(everSynced && !navigator.onLine)) return;
      rt.relay = true;
      if (!everSynced) await persistence.commit({ meta: { everSynced: true } });
      const sync = new SyncClient(store, persistence, {
        apiBase: session.apiBase,
        householdId: session.householdId,
        token: await authToken(session),
        deviceId: session.deviceId,
        memberId: session.memberId,
        keyring: keyring(session),
      });
      rt.sync = sync;
      await sync.start();
      for (const fn of relayListeners) fn();
    },
  };
  await saveSession(persistence, session);
  void rt.ensureSync();
  return rt;
}

// ---------------------------------------------------------------- push

export type PushState = 'on' | 'off' | 'denied' | 'unsupported' | 'install' | 'no-relay';

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export async function pushState(rt: Runtime): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return isIOS() && !isStandalone() ? 'install' : 'unsupported';
  if (!('PushManager' in window)) return isIOS() && !isStandalone() ? 'install' : 'unsupported';
  if (!rt.relay) return 'no-relay';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function urlB64ToUint8Array(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ask permission (only when the person sets their first reminder) and register push. */
export async function enablePush(rt: Runtime): Promise<PushState> {
  const state = await pushState(rt);
  if (state === 'on' || state === 'unsupported' || state === 'install' || state === 'no-relay' || state === 'denied') return state;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>(rt.session, 'vapid');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
  await api(rt.session, 'subscribe', {
    method: 'POST',
    body: JSON.stringify({ dev: rt.session.deviceId, member: rt.session.memberId, sub: sub.toJSON() }),
  });
  return 'on';
}

export async function disablePush(rt: Runtime): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
  if (rt.relay) await api(rt.session, 'unsubscribe', { method: 'POST', body: JSON.stringify({ dev: rt.session.deviceId }) }).catch(() => {});
}

export interface NotePayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

/** Seal a notification so only household devices (or only my own) can read it. */
export async function sealNote(rt: Runtime, note: NotePayload, scope: Scope = 'h'): Promise<string> {
  const key = keyring(rt.session)[scope];
  if (!key) throw new Error('no key for scope');
  const c = await sealJSON(key, note, `${rt.session.householdId}|${scope}|push`);
  return JSON.stringify({ k: scope, c });
}

/** Immediate notification to other members (e.g. "Hila is shopping"). Best-effort. */
export async function notifyMembers(rt: Runtime, members: string[], note: NotePayload): Promise<void> {
  if (!rt.relay || !members.length) return;
  try {
    const payload = await sealNote(rt, note);
    await api(rt.session, 'notify', { method: 'POST', body: JSON.stringify({ members, payload, topic: note.tag }) });
  } catch {
    /* offline — fine */
  }
}

export async function updateBadge(count: number, enabled: boolean): Promise<void> {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (!enabled || count === 0) await nav.clearAppBadge?.();
    else await nav.setAppBadge?.(count);
  } catch {
    /* unsupported */
  }
}

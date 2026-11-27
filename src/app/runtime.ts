import { Hub } from '../core/hub';
import { sealJSON } from '../core/crypto';
import { IdbPersistence, MemoryPersistence, type Persistence } from '../core/db';
import type { Scope } from '../core/model';
import { api, authToken, keyring, readableScopes, relayAvailable, saveSession, type Session } from '../core/session';
import { Store } from '../core/store';
import { SyncClient } from '../core/sync';
import { pinsOf, setPins, MAX_PINS } from './tabs';
import { bindUserPrefs } from './userPrefs';
import { quietly } from '../core/history';
import { listKey } from '../core/keys';

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
  hub.renameOldDefaults();
  hub.uniformProjects();
  hub.endAwayMode();
  hub.stockInPlace();
  const relayListeners = new Set<() => void>();

  /**
   * Once what I already have has arrived (the first sync, or none to wait for): my preferences
   * follow me from here on, and my private To-Do is made if I've never had one, pinned first.
   */
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    bindUserPrefs(hub);
    const personal = () =>
      quietly(store, () => {
        const made = hub.ensurePersonalFolder();
        if (!made) return;
        const pins = pinsOf(hub);
        if (pins.length < MAX_PINS) setPins(hub, [listKey(made), ...pins]);
      });
    // A brand-new me (onboarding) isn't written yet: wait for it.
    if (hub.me()) personal();
    else {
      const off = store.subscribe(() => {
        if (!hub.me()) return;
        off();
        personal();
      });
    }
  };

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
      if (!available && !(everSynced && !navigator.onLine)) {
        // On this device only (no relay): it's all here already.
        if (!everSynced) settle();
        return;
      }
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
      hub.renameOldDefaults();
      hub.uniformProjects();
      hub.endAwayMode();
      hub.stockInPlace();
      settle();
      for (const fn of relayListeners) fn();
      void registerPush(rt);
    },
  };
  await saveSession(persistence, session);
  void rt.ensureSync();
  return rt;
}

// ---------------------------------------------------------------- push

/** Service worker container, or null where unavailable (sandboxed frames throw on access). */
export function swContainer(): ServiceWorkerContainer | null {
  try {
    return 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  } catch {
    return null;
  }
}

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
  const sw = swContainer();
  if (!sw || !('Notification' in window)) return isIOS() && !isStandalone() ? 'install' : 'unsupported';
  if (!('PushManager' in window)) return isIOS() && !isStandalone() ? 'install' : 'unsupported';
  if (!rt.relay) return 'no-relay';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await sw.getRegistration();
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
  if (state === 'unsupported' || state === 'install' || state === 'no-relay' || state === 'denied') return state;
  if (state === 'off') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  }
  return (await registerPush(rt, true)) ? 'on' : 'off';
}

/** false only when we know the keys differ (some browsers don't report the key: then trust it). */
function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return true;
  if (a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  for (let i = 0; i < x.length; i++) if (x[i] !== b[i]) return false;
  return true;
}

/**
 * Make sure this device's push subscription is the one the hub can use: signed for the hub's
 * current key, and stored under this household and this person. Each household has its own key,
 * so a phone that subscribed before joining (or before a reset) holds a subscription the hub
 * can't send to; that one is replaced. Safe to call often. `create` subscribes if there is none;
 * `fresh` replaces the subscription even when it looks right (the push service refused it).
 */
export async function registerPush(rt: Runtime, create = false, fresh = false): Promise<boolean> {
  try {
    const sw = swContainer();
    if (!rt.relay || !sw || !('PushManager' in window) || Notification.permission !== 'granted') return false;
    const reg = await sw.ready;
    const key = urlB64ToUint8Array((await api<{ publicKey: string }>(rt.session, 'vapid')).publicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub && (fresh || !sameKey(sub.options?.applicationServerKey, key))) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
      create = true;
    }
    if (!sub && !create) return false;
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api(rt.session, 'subscribe', {
      method: 'POST',
      body: JSON.stringify({ dev: rt.session.deviceId, member: rt.session.memberId, sub: sub.toJSON() }),
    });
    return true;
  } catch {
    return false;
  }
}

export type TestPush =
  | { kind: 'sent' }
  | { kind: 'not-registered' }
  | { kind: 'refused'; status: number }
  | { kind: 'offline' };

/** Send a test to this device only, and say truthfully what happened. */
export async function testPush(rt: Runtime): Promise<TestPush> {
  const once = async (): Promise<TestPush> => {
    const payload = await sealNote(rt, { title: 'Gila Hub', body: 'This is how reminders will look.', url: '/settings', tag: 'test' });
    const res = await api<{ sent: number; tried: number; statuses?: number[] }>(rt.session, 'notify', {
      method: 'POST',
      body: JSON.stringify({ members: [rt.session.memberId], dev: rt.session.deviceId, payload, topic: 'test' }),
    });
    if (res.sent > 0) return { kind: 'sent' };
    if (!res.tried) return { kind: 'not-registered' };
    return { kind: 'refused', status: res.statuses?.[0] ?? 0 };
  };
  try {
    const first = await once();
    if (first.kind === 'sent') return first;
    // Re-register (a fresh subscription when the old one was refused or missing) and try once more.
    if (!(await registerPush(rt, true, first.kind === 'refused'))) return first;
    return await once();
  } catch {
    return { kind: 'offline' };
  }
}

export async function disablePush(rt: Runtime): Promise<void> {
  const reg = await swContainer()?.getRegistration();
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

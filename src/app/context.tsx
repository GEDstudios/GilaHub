import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Hub } from '../core/actions';
import type { Presence, SyncStatus } from '../core/sync';
import type { Runtime } from './runtime';

const RtCtx = createContext<Runtime | null>(null);

export function RuntimeProvider({ rt, children }: { rt: Runtime; children: ReactNode }) {
  return <RtCtx.Provider value={rt}>{children}</RtCtx.Provider>;
}

export function useRt(): Runtime {
  const rt = useContext(RtCtx);
  if (!rt) throw new Error('RuntimeProvider missing');
  return rt;
}

/** Re-render on every store change; returns the hub. */
export function useHub(): Hub {
  const rt = useRt();
  useSyncExternalStore(rt.store.subscribe, rt.store.getVersion);
  return rt.hub;
}

export function useSync(): { status: SyncStatus; others: Presence[]; relay: boolean; lastSyncedAt: number } {
  const rt = useRt();
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force((n) => n + 1);
    const offRelay = rt.onRelay(bump);
    const offSync = rt.sync?.onChange(bump);
    return () => {
      offRelay();
      offSync?.();
    };
  }, [rt, rt.sync]);
  const s = rt.sync;
  return {
    status: s ? s.status : 'local',
    others: s ? s.others() : [],
    relay: rt.relay,
    lastSyncedAt: s?.lastSyncedAt ?? 0,
  };
}

/**
 * Is my partner on a project right now (they pressed Start there)? Which one. An older app says
 * "shopping": that's Shopping.
 */
export function usePartnerHere(): { member: string; listId: string | null } | null {
  const { others } = useSync();
  const rt = useRt();
  const hub = useHub();
  const p = others.find((o) => (o.state === 'shopping' || o.state?.startsWith('on:')) && o.member !== rt.session.memberId);
  if (!p) return null;
  return { member: p.member, listId: p.state === 'shopping' ? (hub.shopRoot()?.id ?? null) : p.state!.slice(3) };
}

import { deriveAuthToken, deriveInviteSecrets, newKeyMaterial, openJSON, sealJSON } from './crypto';
import type { Persistence } from './db';
import { isValidInviteCode, newId, newInviteCode, normalizeInviteCode } from './ids';
import type { Scope } from './model';

/** Everything this device needs to be part of a household. Stored only on the device. */
export interface Session {
  v: 1;
  householdId: string;
  householdKey: string;
  memberId: string;
  personalKey: string;
  deviceId: string;
  /** '' = the relay is the same origin that served the app. */
  apiBase: string;
  createdAt: number;
}

export function newSession(apiBase = ''): Session {
  return {
    v: 1,
    householdId: newId(22),
    householdKey: newKeyMaterial(),
    memberId: newId(12),
    personalKey: newKeyMaterial(),
    deviceId: newId(12),
    apiBase,
    createdAt: Date.now(),
  };
}

export const loadSession = (p: Persistence) => p.getMeta<Session>('session');
export const saveSession = (p: Persistence, s: Session) => p.commit({ meta: { session: s } });

export function keyring(s: Session): Partial<Record<Scope, string>> {
  return { h: s.householdKey, [`p:${s.memberId}`]: s.personalKey } as Partial<Record<Scope, string>>;
}

export function readableScopes(s: Session): Scope[] {
  return ['h', `p:${s.memberId}`];
}

const tokens = new Map<string, Promise<string>>();
export function authToken(s: Session): Promise<string> {
  let t = tokens.get(s.householdKey);
  if (!t) tokens.set(s.householdKey, (t = deriveAuthToken(s.householdKey)));
  return t;
}

export function apiUrl(apiBase: string, path: string): string {
  return `${apiBase.replace(/\/$/, '')}${path}`;
}

/** Is there a Gila Hub relay at this origin? */
export async function relayAvailable(apiBase = '', timeoutMs = 4000): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(apiUrl(apiBase, '/api/health'), { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok) return false;
    const body = (await res.json()) as { app?: string };
    return body.app === 'gila-hub';
  } catch {
    return false;
  }
}

export async function api<T = unknown>(s: Session, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(s.apiBase, `/api/h/${s.householdId}/${path}`), {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await authToken(s)}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`relay ${path}: ${res.status}`);
  return (await res.json()) as T;
}

// ---------- invites ----------

export interface InvitePayload {
  v: 1;
  kind: 'partner' | 'device';
  householdId: string;
  householdKey: string;
  apiBase: string;
  from: string;
  fromName?: string;
  fromColor?: string;
  /** device invites only */
  memberId?: string;
  personalKey?: string;
}

export async function createInvite(s: Session, kind: InvitePayload['kind'], fromName?: string, fromColor?: string): Promise<{ code: string }> {
  const code = newInviteCode();
  const { inviteId, key } = await deriveInviteSecrets(code);
  const payload: InvitePayload = {
    v: 1,
    kind,
    householdId: s.householdId,
    householdKey: s.householdKey,
    apiBase: s.apiBase,
    from: s.memberId,
    fromName,
    fromColor,
    ...(kind === 'device' ? { memberId: s.memberId, personalKey: s.personalKey } : {}),
  };
  const blob = await sealJSON(key, payload, 'gila-hub/invite');
  await api(s, 'invite', { method: 'POST', body: JSON.stringify({ iid: inviteId, blob }) });
  return { code };
}

export class InviteError extends Error {}

export async function claimInvite(apiBase: string, rawCode: string): Promise<InvitePayload> {
  const code = normalizeInviteCode(rawCode);
  if (!isValidInviteCode(code)) throw new InviteError('That code doesn’t look right — it’s 8 letters and numbers.');
  const { inviteId, key } = await deriveInviteSecrets(code);
  let res: Response;
  try {
    res = await fetch(apiUrl(apiBase, `/api/invite/${inviteId}`), { cache: 'no-store' });
  } catch {
    throw new InviteError('Can’t reach your hub. Are you online?');
  }
  if (res.status === 404) throw new InviteError('That code has expired or was already used. Ask for a fresh one.');
  if (!res.ok) throw new InviteError('Something went wrong. Try again in a moment.');
  const { blob } = (await res.json()) as { blob: string };
  try {
    return await openJSON<InvitePayload>(key, blob, 'gila-hub/invite');
  } catch {
    throw new InviteError('That code doesn’t match. Check it and try again.');
  }
}

export function sessionFromInvite(inv: InvitePayload): Session {
  return {
    v: 1,
    householdId: inv.householdId,
    householdKey: inv.householdKey,
    apiBase: inv.apiBase,
    memberId: inv.kind === 'device' && inv.memberId ? inv.memberId : newId(12),
    personalKey: inv.kind === 'device' && inv.personalKey ? inv.personalKey : newKeyMaterial(),
    deviceId: newId(12),
    createdAt: Date.now(),
  };
}

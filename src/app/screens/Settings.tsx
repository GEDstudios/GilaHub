import { useEffect, useRef, useState } from 'react';
import { relativeAgo } from '../../core/dates';
import { BarEditor } from '../components/BarEditor';
import { PairSheet } from '../components/PairSheet';
import { OptRow, Swatches } from '../components/pickers';
import { useHub, useRt, useSync } from '../context';
import { setPrefs, usePrefs } from '../prefs';
import { back } from '../router';
import { disablePush, enablePush, isIOS, isStandalone, pushState, type PushState } from '../runtime';
import { haptic } from '../ui/haptics';
import { Sheet, useOverlays } from '../ui/overlays';
import { Avatar, Band, lightVar, Logo, Section, Switch } from '../ui/primitives';

const PUSH_TEXT: Record<PushState, string> = {
  on: 'On for this device',
  off: 'Off',
  denied: 'Blocked in system settings',
  unsupported: 'Not supported in this browser',
  install: 'Add to Home Screen first',
  'no-relay': 'Needs your hub',
};

function exportData(rt: ReturnType<typeof useRt>) {
  const tables = ['member', 'list', 'item', 'log', 'memory', 'store', 'settings'] as const;
  const data: Record<string, unknown[]> = {};
  for (const t of tables) data[t] = rt.store.all(t);
  const blob = new Blob([JSON.stringify({ app: 'gila-hub', v: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gila-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function LeaveSheet({ onClose }: { onClose: () => void }) {
  const rt = useRt();
  const [sure, setSure] = useState('');
  return (
    <Sheet onClose={onClose} title="Reset this device">
      <p className="sheet__lede">This removes Gila Hub’s data and keys from <strong>this device only</strong>. Your other devices and your partner keep everything.</p>
      <p className="hint">If this is your only device, export a backup first. Your hub can’t decrypt anything without your keys.</p>
      <input className="field" placeholder="Type RESET to confirm" value={sure} onChange={(e) => setSure(e.target.value)} aria-label="Confirm" />
      <button
        type="button"
        className="btn btn--block"
        style={{ marginTop: 16 }}
        disabled={sure.trim().toUpperCase() !== 'RESET'}
        onClick={async () => {
          rt.sync?.stop();
          await disablePush(rt).catch(() => {});
          await rt.persistence.wipe();
          try {
            localStorage.clear();
          } catch {
            /* storage blocked */
          }
          location.href = '/';
        }}
      >
        Reset this device
      </button>
    </Sheet>
  );
}

export function Settings() {
  const hub = useHub();
  const rt = useRt();
  const prefs = usePrefs();
  const sync = useSync();
  const { openSheet, toast } = useOverlays();
  const me = hub.me();
  const partner = hub.partner();
  const [name, setName] = useState(me?.name ?? '');
  const [push, setPush] = useState<PushState>('off');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void pushState(rt).then(setPush);
  }, [rt, sync.relay]);

  if (!me) return null;

  const statusText =
    sync.status === 'synced'
      ? `Synced${sync.lastSyncedAt ? ` ${relativeAgo(sync.lastSyncedAt)}` : ''}`
      : sync.status === 'local'
        ? 'Only on this device. No hub connected'
        : sync.status === 'offline'
          ? 'Offline · changes are saved here and sync later'
          : 'Syncing…';

  const importData = async (file: File) => {
    try {
      const json = JSON.parse(await file.text()) as { app?: string; data?: Record<string, Array<{ id: string } & Record<string, unknown>>> };
      if (json.app !== 'gila-hub' || !json.data) throw new Error('not a backup');
      const n = hub.importBackup(json.data);
      toast(n ? `Imported ${n} things` : 'Nothing new in that backup');
    } catch {
      toast('That file isn’t a Gila Hub backup.');
    }
  };

  return (
    <>
      <Band title="Settings" onBack={() => back({ name: 'today' })} />
      <div className="column">
        <div className="you">
          <Avatar member={me} size="xl" />
          <div className="you__body">
            <input
              className="you__name"
              dir="auto"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== me.name && hub.upsertMember(me.id, { name: name.trim() })}
              aria-label="Your name"
            />
            <Swatches
              value={me.color}
              taken={partner ? [partner.color] : []}
              onChange={(c) => {
                hub.upsertMember(me.id, { color: c });
                document.documentElement.style.setProperty('--me', `var(--${c})`);
                document.documentElement.style.setProperty('--me-light', lightVar(c));
              }}
            />
          </div>
        </div>

        <Section title="Together">
          <div className="group">
            {partner ? (
              <OptRow lead={<Avatar member={partner} size="sm" />} title={partner.name} sub="Connected" />
            ) : (
              <OptRow icon="link" title="Invite your person" onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)} />
            )}
            <OptRow icon="device" title="Add another device" onClick={() => openSheet((close) => <PairSheet kind="device" onClose={close} />)} />
            <OptRow
              icon="refresh"
              title="Sync"
              sub={statusText}
              trail={<span className={`syncdot syncdot--${sync.status}`} />}
              onClick={() => {
                if (sync.status === 'local') void rt.ensureSync();
                else rt.sync?.poke();
              }}
            />
          </div>
        </Section>

        <Section title="Bottom bar">
          <BarEditor />
        </Section>

        <Section title="Notifications">
          <div className="group">
            <OptRow
              icon="bell"
              title="Push on this device"
              sub={PUSH_TEXT[push]}
              trail={
                <Switch
                  on={push === 'on'}
                  label="Push notifications"
                  onChange={async (on) => {
                    if (on) setPush(await enablePush(rt));
                    else {
                      await disablePush(rt);
                      setPush('off');
                    }
                  }}
                />
              }
            />
            <OptRow
              icon="cart"
              title={partner ? `When ${partner.name} starts shopping` : 'When my partner starts shopping'}
              trail={<Switch on={me.shopAlerts !== false} onChange={(on) => hub.upsertMember(me.id, { shopAlerts: on })} label="Shopping alerts" />}
            />
            <OptRow icon="sun" title="App badge" trail={<Switch on={prefs.badge} onChange={(on) => setPrefs({ badge: on })} label="App badge" />} />
          </div>
          {push === 'install' && isIOS() && !isStandalone() ? <p className="hint">On iPhone: tap Share, then Add to Home Screen, and open Gila Hub from there.</p> : null}
        </Section>

        <Section title="On this device">
          <div className="group">
            <OptRow
              icon="hand"
              title="Haptics"
              trail={
                <Switch
                  on={prefs.haptics}
                  label="Haptics"
                  onChange={(on) => {
                    setPrefs({ haptics: on });
                    if (on) haptic('tick');
                  }}
                />
              }
            />
          </div>
        </Section>

        <Section title="Home">
          <div className="group">
            <OptRow icon="plane" title="Away mode" trail={<Switch on={hub.isAway()} onChange={(on) => hub.setAway(on)} label="Away mode" />} />
          </div>
        </Section>

        <Section title="Your data">
          <div className="group">
            <OptRow icon="download" title="Export a backup" onClick={() => exportData(rt)} />
            <OptRow icon="upload" title="Import a backup" onClick={() => fileRef.current?.click()} />
            <OptRow icon="trash" title="Reset this device" onClick={() => openSheet((close) => <LeaveSheet onClose={close} />)} />
          </div>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void importData(e.target.files[0])} />
        </Section>

        <div className="about">
          <Logo size={34} />
          <p>Life together, sorted.</p>
          <p className="about__build">
            Version {__BUILD__}
            <button
              type="button"
              className="textbtn"
              onClick={async () => {
                toast('Checking for updates…', { ms: 4000 });
                try {
                  const reg = await navigator.serviceWorker?.getRegistration();
                  await reg?.update();
                } catch {
                  /* offline — reload anyway */
                }
                setTimeout(() => location.reload(), 1200);
              }}
            >
              Check for updates
            </button>
          </p>
          <p className="about__credit">Icons: Phosphor (MIT)</p>
        </div>
      </div>
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import { relativeAgo } from '../../core/dates';
import { PairSheet } from '../components/PairSheet';
import { OptRow, Swatches } from '../components/pickers';
import { useHub, useRt, useSync } from '../context';
import { applyTheme, setPrefs, usePrefs } from '../prefs';
import { back } from '../router';
import { disablePush, enablePush, isIOS, isStandalone, pushState, type PushState } from '../runtime';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, Logo, PersonBullet, Section, Seg, Switch } from '../ui/primitives';

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
      <p style={{ marginTop: 0 }}>This removes Gila Hub’s data and keys from <strong>this device only</strong>. Your other devices and your partner keep everything.</p>
      <p className="hint" style={{ margin: 0 }}>If this is your only device, export a backup first — your hub can’t decrypt anything without your keys.</p>
      <input className="input" style={{ marginTop: 16 }} placeholder="Type RESET to confirm" value={sure} onChange={(e) => setSure(e.target.value)} aria-label="Confirm" />
      <button
        type="button"
        className="btn btn--block"
        style={{ marginTop: 14 }}
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
        ? 'This device only — no hub connected'
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
        <Section title="You">
          <div style={{ margin: '0 var(--gutter)' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <PersonBullet member={me} size="xl" />
              <input
                className="input"
                dir="auto"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && name !== me.name && hub.upsertMember(me.id, { name: name.trim() })}
                aria-label="Your name"
              />
            </div>
            <div className="field">
              <span className="field__label">Your line color</span>
              <Swatches
                value={me.color}
                label={me.name}
                taken={partner ? [partner.color] : []}
                onChange={(c) => {
                  hub.upsertMember(me.id, { color: c });
                  document.documentElement.style.setProperty('--me', `var(--${c})`);
                  document.documentElement.style.setProperty('--me-ink', `var(--${c}-ink)`);
                }}
              />
            </div>
          </div>
        </Section>

        <Section title="Together">
          <div className="card" style={{ margin: '0 var(--gutter)' }}>
            {partner ? (
              <OptRow lead={<PersonBullet member={partner} size="md" />} title={partner.name} sub="Connected · end-to-end encrypted" />
            ) : (
              <OptRow icon="link" title="Invite your person" sub="Share a one-time code" onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)} />
            )}
            <OptRow icon="device" title="Add another device" sub="Your Mac, tablet or work laptop" onClick={() => openSheet((close) => <PairSheet kind="device" onClose={close} />)} />
            <OptRow
              icon="refresh"
              title="Sync"
              sub={statusText}
              value={<span className={`syncdot syncdot--${sync.status}`} style={{ boxShadow: 'none', display: 'inline-block' }} />}
              onClick={() => {
                if (sync.status === 'local') void rt.ensureSync();
                else rt.sync?.poke();
              }}
            />
          </div>
        </Section>

        <Section title="Notifications">
          <div className="card" style={{ margin: '0 var(--gutter)' }}>
            <div className="optrow">
              <span className="optrow__icon">
                <Icon name="bell" className="icon--sm" />
              </span>
              <span className="optrow__text">
                Push on this device <span className="optrow__sub">{PUSH_TEXT[push]}</span>
              </span>
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
            </div>
            <div className="optrow">
              <span className="optrow__icon">
                <Icon name="cart" className="icon--sm" />
              </span>
              <span className="optrow__text">
                {partner ? `When ${partner.name} starts shopping` : 'When my partner starts shopping'} <span className="optrow__sub">So you can add what you need</span>
              </span>
              <Switch on={me.shopAlerts !== false} onChange={(on) => hub.upsertMember(me.id, { shopAlerts: on })} label="Shopping alerts" />
            </div>
            <div className="optrow">
              <span className="optrow__icon">
                <Icon name="sun" className="icon--sm" />
              </span>
              <span className="optrow__text">
                App badge <span className="optrow__sub">Count of today’s things on the icon</span>
              </span>
              <Switch on={prefs.badge} onChange={(on) => setPrefs({ badge: on })} label="App badge" />
            </div>
          </div>
          {push === 'install' && isIOS() && !isStandalone() ? (
            <p className="hint">On iPhone: tap Share → Add to Home Screen, then open Gila Hub from there.</p>
          ) : null}
        </Section>

        <Section title="Home">
          <div className="card" style={{ margin: '0 var(--gutter)' }}>
            <div className="optrow">
              <span className="optrow__icon">
                <Icon name="plane" className="icon--sm" />
              </span>
              <span className="optrow__text">
                Away mode <span className="optrow__sub">Pause every chore clock while you travel</span>
              </span>
              <Switch on={hub.isAway()} onChange={(on) => hub.setAway(on)} label="Away mode" />
            </div>
          </div>
        </Section>

        <Section title="Looks">
          <div style={{ margin: '0 var(--gutter)' }}>
            <Seg
              label="Theme"
              value={prefs.theme}
              onChange={(t) => {
                setPrefs({ theme: t });
                applyTheme(t);
              }}
              options={[
                { value: 'system', label: 'Auto' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: <><Icon name="moon" className="icon--sm" /> Dark</> },
              ]}
            />
            <div className="card" style={{ marginTop: 14 }}>
              <div className="optrow">
                <span className="optrow__icon">🥛</span>
                <span className="optrow__text">Item emoji in shopping</span>
                <Switch on={prefs.emoji} onChange={(on) => setPrefs({ emoji: on })} label="Item emoji" />
              </div>
              <div className="optrow">
                <span className="optrow__icon">
                  <Icon name="clock" className="icon--sm" />
                </span>
                <span className="optrow__text">24-hour time</span>
                <Switch on={prefs.h24 ?? true} onChange={(on) => setPrefs({ h24: on })} label="24-hour time" />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Your data">
          <div className="card" style={{ margin: '0 var(--gutter)' }}>
            <OptRow icon="download" title="Export a backup" sub="Everything you can see, as JSON" onClick={() => exportData(rt)} />
            <OptRow icon="upload" title="Import a backup" sub="Adds anything missing; never overwrites" onClick={() => fileRef.current?.click()} />
            <OptRow icon="trash" title="Reset this device" sub="Other devices keep everything" onClick={() => openSheet((close) => <LeaveSheet onClose={close} />)} />
          </div>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void importData(e.target.files[0])} />
        </Section>

        <div className="about">
          <Logo size={44} />
          <p className="about__line">Life together, sorted.</p>
          <p className="hint" style={{ margin: '10px 0 0' }}>
            Free, private, yours. No accounts, no ads, no tracking. Everything is end-to-end encrypted.
          </p>
        </div>
      </div>
    </>
  );
}

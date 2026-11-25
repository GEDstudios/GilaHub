import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { LineColor, Member } from '../../core/model';
import { BarEditor } from '../components/BarEditor';
import { HomeEditor } from '../components/HomeEditor';
import { useOpenIdeas } from '../components/Ideas';
import { PairSheet } from '../components/PairSheet';
import { OptRow, Swatches } from '../components/pickers';
import { useHub, useRt, useSync } from '../context';
import { setPrefs, use24h, usePrefs, weekStart } from '../prefs';
import { visHint, visLabel, VIS_ICON, type VisChoice } from '../privacy';
import { ideasView } from '../views';
import { back } from '../router';
import { disablePush, enablePush, isIOS, isStandalone, notifyMembers, pushState, swContainer, type PushState, type Runtime } from '../runtime';
import { AWAY_ON, awaySub, backupSub, needsBackup, syncAria, syncLabel, usSentence, welcomeBack } from '../settingsCopy';
import { checkForUpdate, updateReady, useUpdateReady, type UpdateCheck } from '../update';
import { replay } from '../ui/flip';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, initialOf, lightVar, lineVars, Logo, Section, Seg, Switch } from '../ui/primitives';

/**
 * Settings (SETTINGS, DECISIONS #9): one calm page where everything changes in place.
 * Profile, Bottom bar, Today page, Notifications, Together, On this device, Your data, About.
 * The floating tab bar steps aside here (App.tsx): the Bottom bar section shows its own preview.
 */

type Toast = ReturnType<typeof useOverlays>['toast'];

const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width: 960px)').matches;
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function exportData(rt: Runtime) {
  const tables = ['member', 'list', 'item', 'log', 'memory', 'store', 'settings', 'idea'] as const;
  const data: Record<string, unknown[]> = {};
  for (const t of tables) data[t] = rt.store.all(t);
  // `me`: whose backup it is, so restoring it on a new device makes those things mine again.
  const blob = new Blob([JSON.stringify({ app: 'gila-hub', v: 2, me: rt.session.memberId, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gila-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Download a backup and remember when (this device), for the sub-line and the reset nudge. */
function downloadBackup(rt: Runtime, toast: Toast) {
  exportData(rt);
  setPrefs({ lastBackupAt: Date.now() });
  toast('Backup saved. Keep it somewhere safe.');
}

function LeaveSheet({ onClose }: { onClose: () => void }) {
  const rt = useRt();
  const prefs = usePrefs();
  const { toast } = useOverlays();
  const [sure, setSure] = useState('');
  return (
    <Sheet onClose={onClose} title="Reset this device">
      <p className="sheet__lede">
        This removes Gila Hub’s data and keys from <strong>this device only</strong>. Your other devices and your person keep everything.
      </p>
      {needsBackup(prefs.lastBackupAt) ? (
        <button type="button" className="token leave__backup" onClick={() => downloadBackup(rt, toast)}>
          <Icon name="download" />
          Download a backup first
        </button>
      ) : null}
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

// ---------------------------------------------------------------- Profile

/** The cursor the name tags carry: two people in the same space. */
function Cursor() {
  return (
    <svg className="nametag__cursor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 3l15 7.5-6.5 1.8L10.5 19z" fill="currentColor" />
    </svg>
  );
}

/**
 * My card: my name in the serif (edit in place), a sync pill, one line about us, and my
 * person's tag on its edge (or an invitation). Under it: Color, Name, Add a device.
 */
function MeCard({ me, partner }: { me: Member; partner: Member | undefined }) {
  const hub = useHub();
  const rt = useRt();
  const sync = useSync();
  const { openSheet, toast } = useOverlays();
  const [name, setName] = useState(me.name);
  const [colors, setColors] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const cancel = useRef(false);

  // Someone renamed me on another device: follow, unless I'm typing.
  useEffect(() => {
    if (document.activeElement !== input.current) setName(me.name);
  }, [me.name]);

  // The color panel stays open to try colors; a tap anywhere else closes it.
  useEffect(() => {
    if (!colors) return;
    const away = (e: PointerEvent) => {
      if (!chips.current?.contains(e.target as Node)) setColors(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [colors]);

  const commit = () => {
    if (cancel.current) {
      cancel.current = false;
      return;
    }
    const n = name.trim();
    if (!n) {
      setName(me.name);
      replay(input.current);
      return;
    }
    if (n !== me.name) hub.upsertMember(me.id, { name: n });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      cancel.current = true;
      setName(me.name);
      e.currentTarget.blur();
    }
  };

  const pick = (c: LineColor) => {
    hub.upsertMember(me.id, { color: c });
    document.documentElement.style.setProperty('--me', `var(--${c})`);
    document.documentElement.style.setProperty('--me-light', lightVar(c));
    haptic('tick');
    replay(card.current, 'is-wobble');
  };

  // A tap on the pill: a short spin, then "Synced just now" with a tick once it is.
  const [poked, setPoked] = useState<{ at: number; done: boolean } | null>(null);
  const syncNow = async () => {
    if (sync.status === 'local') {
      await rt.ensureSync();
      if (!rt.sync) toast('No hub yet. Everything’s safe on this device.');
      return;
    }
    haptic('select');
    setPoked({ at: Date.now(), done: false });
    rt.sync?.poke();
  };
  useEffect(() => {
    if (!poked) return;
    if (poked.done) {
      const t = setTimeout(() => setPoked(null), 1800);
      return () => clearTimeout(t);
    }
    if (sync.status !== 'synced') {
      const t = setTimeout(() => setPoked(null), 8000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => {
        setPoked({ ...poked, done: true });
        haptic('tick');
      },
      Math.max(0, poked.at + 700 - Date.now()),
    );
    return () => clearTimeout(t);
  }, [poked, sync.status]);

  const here = !!partner && sync.others.some((o) => o.member === partner.id);

  return (
    <>
      <div className="mecard-wrap">
        <div ref={card} className="ccard ccard--lg mecard" style={lineVars(me.color)}>
          <span className="ccard__top">
            <input
              ref={input}
              className="ccard__input mecard__name"
              dir="auto"
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={onKey}
              enterKeyHint="done"
              autoComplete="off"
              spellCheck={false}
              aria-label="Your name"
            />
            <button type="button" className="mecard__sync" onClick={() => void syncNow()} aria-label={syncAria(sync.status, sync.lastSyncedAt)} aria-live="polite">
              {poked && !poked.done ? <Icon name="refresh" className="icon--xs mecard__spin" /> : <span className={`syncdot syncdot--${sync.status}`} />}
              {poked ? (poked.done ? 'Synced just now' : 'Syncing…') : syncLabel(sync.status, wide())}
            </button>
          </span>
          <span className="ccard__sub" dir="auto">
            {usSentence(partner ?? null)}
          </span>
        </div>
        {partner ? (
          <span
            className="nametag mecard__tag"
            style={lineVars(partner.color)}
            role="img"
            aria-label={here ? `${partner.name} is here now` : partner.name}
            onClick={(e) => {
              haptic('select');
              replay(e.currentTarget, 'is-wiggle');
            }}
          >
            <Cursor />
            {here ? <span className="live" /> : null}
            <span dir="auto">{partner.name}</span>
          </span>
        ) : (
          <button type="button" className="nametag mecard__tag mecard__tag--empty" onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)}>
            <Cursor />
            <Icon name="plus" className="icon--xs" />
            Your person?
          </button>
        )}
      </div>

      <p className="inline__prompt">Want to modify something?</p>
      <div className="inline__chips" ref={chips}>
        <button type="button" className={`echip is-set ${colors ? 'is-open' : ''}`} aria-expanded={colors} onClick={() => setColors(!colors)}>
          <span className="echip__dot" style={lineVars(me.color)} />
          Color
        </button>
        <button
          type="button"
          className="echip is-set"
          onClick={() => {
            setColors(false);
            input.current?.focus();
            input.current?.select();
          }}
        >
          <Icon name="edit" />
          Name
        </button>
        <button
          type="button"
          className="echip"
          onClick={() => {
            setColors(false);
            openSheet((close) => <PairSheet kind="device" onClose={close} />);
          }}
        >
          <Icon name="device" />
          Add a device
        </button>
        {colors ? (
          <div className="panel">
            <Swatches value={me.color} onChange={pick} big taken={partner ? [{ color: partner.color, name: partner.name, initial: initialOf(partner.name) }] : []} />
            <p className="panel__hint" dir="auto">
              {partner ? `${partner.color[0].toUpperCase()}${partner.color.slice(1)} is ${partner.name}’s. ` : ''}What you add shows in your color.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Notifications

const PUSH_SUB: Record<PushState, string> = {
  on: 'Reminders and requests, even when Gila Hub is closed',
  off: 'Reminders and requests, even when Gila Hub is closed',
  denied: 'Blocked in your phone’s settings',
  install: 'Add Gila Hub to your Home Screen first',
  'no-relay': 'Needs your hub. Reminders still show while the app is open.',
  unsupported: 'This browser can’t send notifications',
};

function UnblockSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet onClose={onClose} title="Let notifications in">
      <div className="group">
        <OptRow icon="device" title="iPhone" sub="Settings → Notifications → Gila Hub → Allow Notifications" />
        <OptRow icon="device" title="Android" sub="Hold the Gila Hub icon → App info → Notifications" />
        <OptRow icon="search" title="In a browser" sub="Tap the icon by the address, then allow notifications" />
      </div>
      <button type="button" className="btn btn--quiet btn--block" style={{ marginTop: 20 }} onClick={onClose}>
        Got it
      </button>
    </Sheet>
  );
}

function Notifications({ me, partner }: { me: Member; partner: Member | undefined }) {
  const hub = useHub();
  const rt = useRt();
  const prefs = usePrefs();
  const sync = useSync();
  const { openSheet, toast } = useOverlays();
  const [push, setPush] = useState<PushState>('off');
  const [how, setHow] = useState(false);

  useEffect(() => {
    void pushState(rt).then(setPush);
  }, [rt, sync.relay]);

  const test = () => {
    void notifyMembers(rt, [me.id], { title: 'Gila Hub', body: 'This is how reminders will look.', url: '/settings', tag: 'test' });
    toast('Sent. It should arrive in a few seconds.');
  };

  const trail =
    push === 'on' || push === 'off' ? (
      <Switch
        on={push === 'on'}
        label="Notifications on this device"
        onChange={async (on) => {
          if (on) setPush(await enablePush(rt));
          else {
            await disablePush(rt);
            setPush('off');
          }
        }}
      />
    ) : push === 'denied' ? (
      <button type="button" className="token" onClick={() => openSheet((close) => <UnblockSheet onClose={close} />)}>
        How?
      </button>
    ) : push === 'install' ? (
      <button type="button" className="token" aria-expanded={how} onClick={() => setHow(!how)}>
        How?
      </button>
    ) : null;

  return (
    <Section
      title="Notifications"
      action={
        push === 'on' ? (
          <button type="button" className="textbtn" onClick={test}>
            Send a test
          </button>
        ) : undefined
      }
    >
      <div className="group">
        <OptRow
          icon="bell"
          title={
            <>
              <span className="on-phone">On this phone</span>
              <span className="on-desk">On this computer</span>
            </>
          }
          sub={PUSH_SUB[push]}
          trail={trail}
        />
        {push === 'install' && how ? (
          <p className="optrow__more">
            {isIOS() && !isStandalone() ? 'On iPhone: tap Share, then Add to Home Screen, and open Gila Hub from there.' : 'In your browser’s menu, choose Install or Add to Home Screen.'}
          </p>
        ) : null}
        {partner ? (
          <>
            <OptRow
              icon="hand"
              title={`When ${partner.name} asks me for something`}
              sub={`And when ${partner.name} does what I asked, or says not yet`}
              trail={<Switch on={me.requestAlerts !== false} onChange={(on) => hub.upsertMember(me.id, { requestAlerts: on })} label="Request alerts" />}
            />
            <OptRow
              icon="cart"
              title={`When ${partner.name} starts shopping`}
              trail={<Switch on={me.shopAlerts !== false} onChange={(on) => hub.upsertMember(me.id, { shopAlerts: on })} label="Shopping alerts" />}
            />
          </>
        ) : null}
        {'setAppBadge' in navigator ? (
          <OptRow
            icon="badge"
            title="Count on the app icon"
            sub="How many things are due today"
            trail={<Switch on={prefs.badge} onChange={(on) => setPrefs({ badge: on })} label="Count on the app icon" />}
          />
        ) : null}
      </div>
      {partner ? null : <p className="hint">Alerts about your person show up here once they join.</p>}
    </Section>
  );
}

// ---------------------------------------------------------------- Together

const SHARING: VisChoice[] = ['ours', 'mine', 'private'];

/** Ours, Mine and Only me, and asking, in a few plain lines. */
function SharingSheet({ partner, onClose }: { partner: Member | undefined; onClose: () => void }) {
  const { openSheet } = useOverlays();
  const p = partner?.name ?? null;
  return (
    <Sheet onClose={onClose} title="Sharing, simply">
      <div className="group">
        {SHARING.map((v) => (
          <OptRow key={v} icon={VIS_ICON[v]} title={visLabel(v, p)} sub={visHint(v, p)} />
        ))}
        <OptRow
          icon="hand"
          title="Asking"
          sub={p ? `Who → Ask ${p} sends it ${p}’s way. “Needs my OK when done” lets you check it before it counts.` : 'Once your person joins, Who → Ask sends a thing their way.'}
        />
      </div>
      {partner ? (
        <button type="button" className="btn btn--quiet btn--block" style={{ marginTop: 20 }} onClick={onClose}>
          Got it
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--block"
          style={{ marginTop: 20 }}
          onClick={() => {
            onClose();
            openSheet((close) => <PairSheet kind="partner" onClose={close} />);
          }}
        >
          Bring your person in
        </button>
      )}
    </Sheet>
  );
}

function Together({ partner }: { partner: Member | undefined }) {
  const hub = useHub();
  const { openSheet, toast } = useOverlays();
  const s = hub.settings();
  const away = hub.isAway() && s?.awaySince ? { since: s.awaySince, by: s.awayBy ?? null } : null;
  return (
    <Section title="Together">
      <div className="group">
        <OptRow
          icon="plane"
          title="Away mode"
          sub={awaySub(away, hub.meId, partner?.name ?? null)}
          trail={
            <Switch
              on={!!away}
              label="Away mode"
              onChange={(on) => {
                if (on) {
                  hub.setAway(true);
                  toast(AWAY_ON);
                  return;
                }
                const msg = welcomeBack(s?.awaySince);
                hub.setAway(false);
                toast(msg);
              }}
            />
          }
        />
        <OptRow
          icon="ours"
          title="Ours, Mine and Only me"
          sub="How sharing and asking work"
          chev
          onClick={() => openSheet((close) => <SharingSheet partner={partner} onClose={close} />)}
        />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- On this device

function ThisDevice() {
  const prefs = usePrefs();
  return (
    <Section title="On this device">
      <div className="group">
        <OptRow
          icon="calendar"
          title="Week starts"
          trail={
            <Seg
              small
              label="Week starts"
              value={String(weekStart(prefs)) as '0' | '1'}
              options={[
                { value: '0', label: 'Sun' },
                { value: '1', label: 'Mon' },
              ]}
              onChange={(v) => setPrefs({ weekStart: v === '1' ? 1 : 0 })}
            />
          }
        />
        <OptRow
          icon="clock"
          title="Clock"
          trail={
            <Seg
              small
              label="Clock"
              value={use24h(prefs) ? '24' : '12'}
              options={[
                { value: '24', label: '13:00' },
                { value: '12', label: '1 pm' },
              ]}
              onChange={(v) => setPrefs({ h24: v === '24' })}
            />
          }
        />
        <OptRow
          icon="lightbulb"
          title="Ideas tag"
          sub="Wishes for Gila Hub, on every screen"
          trail={<Switch on={prefs.ideasTag} label="Ideas tag" onChange={(on) => setPrefs({ ideasTag: on })} />}
        />
        {coarse() ? (
          <OptRow
            icon="hand"
            title="Vibration"
            sub="A light tap when you tick, drag or pick"
            trail={
              <Switch
                on={prefs.haptics}
                label="Vibration"
                onChange={(on) => {
                  setPrefs({ haptics: on });
                  if (on) haptic('tick');
                }}
              />
            }
          />
        ) : null}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- Your data

function YourData() {
  const hub = useHub();
  const rt = useRt();
  const prefs = usePrefs();
  const { openSheet, toast } = useOverlays();
  const file = useRef<HTMLInputElement>(null);

  const restore = async (f: File) => {
    try {
      const json = JSON.parse(await f.text()) as { app?: string; me?: string; data?: Record<string, Array<{ id: string } & Record<string, unknown>>> };
      const data = json.data;
      if (json.app !== 'gila-hub' || !data) throw new Error('not a backup');
      const run = (me?: string) => {
        const n = hub.importBackup(data, { me });
        toast(n ? `Restored ${n} things` : 'Nothing new in that backup');
      };
      if (typeof json.me === 'string') return run(json.me);
      // An older backup from the two of us, and nothing in it says which one made it: ask.
      const people = hub.backupOwner(data) ? [] : hub.backupStrangers(data);
      if (people.length < 2) return run();
      openSheet((close) => (
        <Sheet onClose={close} title="Which one is you?">
          <div className="tokens">
            {people.map((m) => (
              <button
                key={m.id}
                type="button"
                className="token"
                onClick={() => {
                  close();
                  run(m.id);
                }}
              >
                {m.name || 'Someone'}
              </button>
            ))}
          </div>
        </Sheet>
      ));
    } catch {
      toast('That file isn’t a Gila Hub backup.');
    }
  };

  return (
    <Section title="Your data">
      <div className="group">
        <OptRow icon="download" title="Download a backup" sub={backupSub(prefs.lastBackupAt)} chev onClick={() => downloadBackup(rt, toast)} />
        <OptRow icon="upload" title="Restore from a backup" sub="Adds what’s missing. Never deletes." chev onClick={() => file.current?.click()} />
      </div>
      <div className="group group--danger">
        <OptRow
          icon="trash"
          title="Reset this device"
          sub="Removes Gila Hub from this device only"
          danger
          chev
          onClick={() => openSheet((close) => <LeaveSheet onClose={close} />)}
        />
      </div>
      <input
        ref={file}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) void restore(e.target.files[0]);
          e.target.value = '';
        }}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- About

type Pill = 'idle' | 'checking' | UpdateCheck;

const PILL: Record<Pill, string> = {
  idle: 'Check for updates',
  checking: 'Checking…',
  current: 'You’re up to date',
  ready: 'Refresh to update',
  offline: 'You’re offline. Try again later.',
  failed: 'Couldn’t check. Try again later.',
};

/** Check for updates, honestly: it says what it found and never reloads without a tap. */
function UpdatePill() {
  const ready = useUpdateReady();
  const [pill, setPill] = useState<Pill>('idle');
  const state: Pill = ready ? 'ready' : pill;

  // An answer stays a few seconds, then the pill offers to check again.
  useEffect(() => {
    if (state !== 'current' && state !== 'offline' && state !== 'failed') return;
    const t = setTimeout(() => setPill('idle'), 4000);
    return () => clearTimeout(t);
  }, [state]);

  const run = async () => {
    if (state === 'ready') return location.reload();
    if (state === 'checking') return;
    setPill('checking');
    const [found] = await Promise.all([
      checkForUpdate({ online: navigator.onLine, alreadyReady: updateReady(), registration: async () => (await swContainer()?.getRegistration()) ?? null }),
      new Promise((r) => setTimeout(r, 700)),
    ]);
    if (found === 'current') haptic('tick');
    setPill(found);
  };

  const icon = state === 'current' ? 'check' : state === 'ready' ? 'arrow' : 'refresh';
  return (
    <button type="button" className={`token about__check is-${state}`} onClick={() => void run()} aria-live="polite">
      {state === 'offline' || state === 'failed' ? null : <Icon name={icon} />}
      {PILL[state]}
    </button>
  );
}

function About({ me, partner }: { me: Member; partner: Member | undefined }) {
  const hub = useHub();
  const openIdeas = useOpenIdeas();
  const n = ideasView(hub).open.length;
  return (
    <>
      <Section title="About">
        <div className="group">
          <OptRow icon="lightbulb" title="Ideas" value={n ? `${n} open` : undefined} chev onClick={openIdeas} />
        </div>
      </Section>
      <div className="about">
        <span className="about__mark">
          <Logo size={34} />
        </span>
        <p>Life together, sorted.</p>
        <p className="about__build">
          <span className="about__ver">Version {__BUILD__}</span>
          <UpdatePill />
        </p>
        <p className="about__for" dir="auto">
          {partner ? `Made for ${me.name} & ${partner.name}` : 'Made for two'} ·{' '}
          <span dir="rtl" lang="he">
            גִּילָה
          </span>{' '}
          means joy
        </p>
        <p className="about__credit">Icons: Phosphor (MIT)</p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- the page

export function Settings() {
  const hub = useHub();
  const me = hub.me();
  const partner = hub.partner();
  if (!me) return null;

  return (
    <>
      <Band title="Settings" onBack={() => back({ name: 'today' })} />
      <div className="column settings">
        <MeCard me={me} partner={partner} />

        <Section title="Bottom bar">
          <BarEditor />
        </Section>

        <Section title="Today page">
          <HomeEditor />
        </Section>

        <Notifications me={me} partner={partner} />
        <Together partner={partner} />
        <ThisDevice />
        <YourData />
        <About me={me} partner={partner} />
      </div>
    </>
  );
}

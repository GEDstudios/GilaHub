import { useEffect, useState } from 'react';
import type { Member } from '../../../core/model';
import { OptRow, SwitchRow } from '../../components/pickers';
import { useHub, useRt, useSync } from '../../context';
import { setPrefs } from '../../prefs';
import { usePrefs } from '../../usePrefs';
import { disablePush, enablePush, isIOS, isStandalone, pushState, testPush, type PushState } from '../../runtime';
import { Sheet, useOverlays } from '../../ui/overlays';
import { Section, Switch, TextButton, Button } from '../../ui/primitives';
import { G } from '../../ui/glyphs';

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
        <OptRow icon={G.device} title="iPhone" sub="Settings → Notifications → Gila Hub → Allow Notifications" />
        <OptRow icon={G.device} title="Android" sub="Hold the Gila Hub icon → App info → Notifications" />
        <OptRow icon={G.browser} title="In a browser" sub="Tap the icon by the address, then allow notifications" />
      </div>
      <Button quiet block style={{ marginTop: 20 }} onClick={onClose}>
        Got it
      </Button>
    </Sheet>
  );
}

export function Notifications({ me, partner }: { me: Member; partner: Member | undefined }) {
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

  const [testing, setTesting] = useState(false);
  const test = async () => {
    setTesting(true);
    const r = await testPush(rt);
    setTesting(false);
    if (r.kind === 'sent') toast('Sent. If nothing arrives, check Do Not Disturb and Gila Hub’s notification settings.');
    else if (r.kind === 'not-registered') toast('This phone isn’t signed up yet. Turn notifications off and on, then try again.');
    else if (r.kind === 'refused') toast(`The phone’s push service turned it away (${r.status || 'no answer'}). Turn notifications off and on, then try again.`);
    else toast('Couldn’t reach your hub. Check the connection and try again.');
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
          <TextButton onClick={() => void test()} disabled={testing}>
            {testing ? 'Sending…' : 'Send a test'}
          </TextButton>
        ) : undefined
      }
    >
      <div className="group">
        <OptRow
          icon={G.remind}
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
            <SwitchRow
              icon={G.ask}
              title={`When ${partner.name} asks me for something`}
              sub={`And when ${partner.name} does what I asked, or says not yet`}
              on={me.requestAlerts !== false}
              onChange={(on) => hub.upsertMember(me.id, { requestAlerts: on })}
              label="Request alerts"
            />
          </>
        ) : null}
        {/* Android launchers don't show a web app's count (it shows a dot for notifications
            instead), so the option only appears where it works: iPhone and computers. */}
        {'setAppBadge' in navigator && !/Android/i.test(navigator.userAgent) ? (
          <SwitchRow
            icon={G.badge}
            title="Count on the app icon"
            sub="How many things are due today"
            on={prefs.badge}
            onChange={async (on) => {
              // iPhone shows the count only once notifications are allowed.
              if (on && 'Notification' in window && Notification.permission === 'default') setPush(await enablePush(rt));
              setPrefs({ badge: on });
            }}
          />
        ) : null}
      </div>
      {partner ? null : <p className="hint">Alerts about your person show up here once they join.</p>}
    </Section>
  );
}

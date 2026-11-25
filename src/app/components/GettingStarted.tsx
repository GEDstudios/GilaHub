import { useEffect, useState } from 'react';
import { runAdd } from '../addAction';
import { useHub, useRt, useSync } from '../context';
import { setPrefs, usePrefs } from '../prefs';
import { navigate } from '../router';
import { enablePush, pushState } from '../runtime';
import { startedSteps, type StepKey } from '../started';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { PairSheet } from './PairSheet';
import { QuickAddSheet } from './QuickAddSheet';

/**
 * Getting started, on Today: five first things, each a button that starts doing it. A step
 * ticks itself off when it really happened (no reading, no tour). When all five are done the
 * card says so once and goes away; × puts it away sooner; Settings brings it back.
 */
export function GettingStarted() {
  const hub = useHub();
  const rt = useRt();
  const sync = useSync();
  const prefs = usePrefs();
  const { openSheet, toast } = useOverlays();
  const [pushOn, setPushOn] = useState(false);
  useEffect(() => {
    void pushState(rt).then((s) => setPushOn(s === 'on'));
  }, [rt, sync.relay]);

  const steps = startedSteps(hub, pushOn);
  const done = steps.filter((s) => s.done).length;
  const all = done === steps.length;

  // All done: a moment to see it, then it goes.
  useEffect(() => {
    if (!all || prefs.startedHidden) return;
    haptic('success');
    const t = setTimeout(() => setPrefs({ startedHidden: true }), 2400);
    return () => clearTimeout(t);
  }, [all, prefs.startedHidden]);

  if (prefs.startedHidden) return null;

  const go = (k: StepKey) => {
    switch (k) {
      case 'add':
        return runAdd(() => openSheet((close) => <QuickAddSheet onClose={close} />));
      case 'tick': {
        // Show the first thing there is to tick; with nothing yet, add something first.
        const check = document.querySelector('.home .row .check');
        if (check) return check.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return runAdd(() => openSheet((close) => <QuickAddSheet onClose={close} />));
      }
      case 'person':
        return openSheet((close) => <PairSheet kind="partner" onClose={close} />);
      case 'notify':
        return void enablePush(rt).then((s) => {
          setPushOn(s === 'on');
          if (s === 'install') toast('Add Gila Hub to your Home Screen first, then open it from there.');
          else if (s === 'denied') toast('Notifications are blocked in this phone’s settings.');
          else if (s === 'no-relay') toast('Notifications need your hub. They still show while the app is open.');
        });
      case 'bar':
        return navigate({ name: 'lists' });
    }
  };

  return (
    <section className={`started ${all ? 'is-all' : ''}`} aria-label="Getting started">
      <div className="started__head">
        <span className="started__ring" style={{ '--p': `${(done / steps.length) * 100}%` } as React.CSSProperties}>
          <span className="num">{all ? <Icon name="check" className="icon--sm" /> : `${done}/${steps.length}`}</span>
        </span>
        <span className="started__title">{all ? 'You’re all set' : 'Getting started'}</span>
        {all ? null : (
          <button type="button" className="started__x" aria-label="Put away" onClick={() => setPrefs({ startedHidden: true })}>
            <Icon name="x" className="icon--sm" />
          </button>
        )}
      </div>
      {all ? null : (
        <ul className="started__steps">
          {steps.map((s) => (
            <li key={s.key}>
              <button type="button" className={`started__step ${s.done ? 'is-done' : ''}`} disabled={s.done} onClick={() => go(s.key)}>
                <span className="started__dot">{s.done ? <Icon name="check" className="icon--xs" /> : null}</span>
                <span className="started__label">{s.title}</span>
                {s.done ? null : <Icon name="chevron-right" className="icon--sm" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

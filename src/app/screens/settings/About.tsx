import { startTour } from '../../tour';
import { useEffect, useState } from 'react';
import type { Member } from '../../../core/model';
import { useOpenIdeas } from '../../components/Ideas';
import { OptRow } from '../../components/pickers';
import { useHub } from '../../context';
import { ideasView } from '../../views';
import { navigate } from '../../router';
import { swContainer } from '../../runtime';
import { checkForUpdate, updateReady, useUpdateReady, type UpdateCheck } from '../../update';
import { haptic } from '../../ui/haptics';
import { Icon } from '../../ui/Icon';
import { Logo, Section } from '../../ui/primitives';
import { G } from '../../ui/glyphs';

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

  const icon = state === 'current' ? G.done : state === 'ready' ? G.continue : G.reload;
  return (
    <button type="button" className={`token about__check is-${state}`} onClick={() => void run()} aria-live="polite">
      {state === 'offline' || state === 'failed' ? null : <Icon name={icon} />}
      {PILL[state]}
    </button>
  );
}

export function About({ me, partner }: { me: Member; partner: Member | undefined }) {
  const hub = useHub();
  const openIdeas = useOpenIdeas();
  const n = ideasView(hub).open.length;
  return (
    <>
      <Section title="About">
        <div className="group">
          <OptRow icon={G.idea} title="Ideas" value={n ? `${n} open` : undefined} chev onClick={openIdeas} />
          <OptRow
            icon={G.tour}
            title="Show me around"
            sub="Start here: a few things to try, in a folder of your own"
            chev
            onClick={() => navigate({ name: 'list', id: startTour(hub) })}
          />
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
      </div>
    </>
  );
}

// ---------------------------------------------------------------- tags

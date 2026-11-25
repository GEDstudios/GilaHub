import { useState } from 'react';
import { formatInviteCode, normalizeInviteCode } from '../../core/ids';
import type { LineColor } from '../../core/model';
import { claimInvite, InviteError, type InvitePayload } from '../../core/session';
import { Swatches } from '../components/pickers';
import { query } from '../router';
import { Icon } from '../ui/Icon';
import { Bullet, Logo } from '../ui/primitives';

export interface OnboardResult {
  kind: 'new' | 'partner' | 'device';
  name?: string;
  color?: LineColor;
  invite?: InvitePayload;
}

type Step = 'welcome' | 'name' | 'code';

/** One question. No account, no tour. The rest is learned by doing. */
export function Onboarding({ onDone }: { onDone: (r: OnboardResult) => Promise<void> }) {
  const joinParam = query('join');
  const [step, setStep] = useState<Step>(joinParam ? 'code' : 'welcome');
  const [name, setName] = useState('');
  const [color, setColor] = useState<LineColor>('lime');
  const [code, setCode] = useState(joinParam ? formatInviteCode(normalizeInviteCode(joinParam)) : '');
  const [invite, setInvite] = useState<InvitePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const taken = invite?.fromColor ? [invite.fromColor as LineColor] : [];

  const finish = async (r: OnboardResult) => {
    setBusy(true);
    try {
      await onDone(r);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const join = async () => {
    setError(null);
    setBusy(true);
    try {
      const inv = await claimInvite('', code);
      setInvite(inv);
      setBusy(false);
      if (inv.kind === 'device') await finish({ kind: 'device', invite: inv });
      else {
        if (inv.fromColor === color) setColor(inv.fromColor === 'tangerine' ? 'lime' : 'tangerine');
        setStep('name');
      }
    } catch (e) {
      setBusy(false);
      setError(e instanceof InviteError ? e.message : 'Can’t reach your hub right now.');
    }
  };

  if (step === 'welcome') {
    return (
      <main className="onboard onboard--dark">
        <div className="onboard__stripe" />
        <div className="onboard__hero">
          <Logo size="hero" />
          <h1 className="onboard__title">Gila Hub</h1>
          <p className="onboard__tag">Where our lines meet.</p>
        </div>
        <div className="onboard__actions">
          <button type="button" className="btn btn--onband btn--block onboard__go" onClick={() => setStep('name')}>
            Start <Icon name="arrow" />
          </button>
          <button type="button" className="onboard__link" onClick={() => setStep('code')}>
            I have a code
          </button>
        </div>
      </main>
    );
  }

  if (step === 'code') {
    return (
      <main className="onboard">
        <div className="onboard__body">
          <button type="button" className="iconbtn" onClick={() => setStep('welcome')} aria-label="Back" style={{ marginLeft: -10 }}>
            <Icon name="arrow-back" />
          </button>
          <h1 className="onboard__q">Type the code from the other phone</h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
          >
            <input
              className="input input--big codeinput num"
              value={code}
              autoFocus
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              spellCheck={false}
              placeholder="K7QM-2XPA"
              aria-label="Invite code"
              onChange={(e) => {
                const n = normalizeInviteCode(e.target.value).slice(0, 8);
                setCode(n.length > 4 ? `${n.slice(0, 4)}-${n.slice(4)}` : n);
              }}
            />
            {error ? <p className="onboard__error">{error}</p> : <p className="hint" style={{ margin: '10px 0 0' }}>It’s on their phone under “Bring your person in”.</p>}
            <button type="submit" className="btn btn--block" style={{ marginTop: 22 }} disabled={normalizeInviteCode(code).length !== 8 || busy}>
              {busy ? 'Opening the invite…' : 'Join'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="onboard">
      <div className="onboard__body">
        <button type="button" className="iconbtn" onClick={() => setStep(invite ? 'code' : 'welcome')} aria-label="Back" style={{ marginLeft: -10 }}>
          <Icon name="arrow-back" />
        </button>
        {invite?.fromName ? <p className="onboard__invited">{invite.fromName} invited you 👋</p> : null}
        <h1 className="onboard__q">What’s your name?</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void finish({ kind: invite ? 'partner' : 'new', name: name.trim(), color, invite: invite ?? undefined });
          }}
        >
          <input className="input input--big" value={name} dir="auto" autoFocus autoComplete="given-name" placeholder="Guy, Hila…" aria-label="Your name" onChange={(e) => setName(e.target.value)} />
          <div className="field" style={{ marginTop: 26 }}>
            <span className="field__label">Pick your line</span>
            <Swatches value={color} onChange={setColor} label={name || '?'} taken={taken} />
          </div>
          <div className="onboard__preview">
            <Bullet color={color} label={name || '?'} size="lg" />
            <span>This is you, everywhere in the app.</span>
          </div>
          {error ? <p className="onboard__error">{error}</p> : null}
          <button type="submit" className="btn btn--me btn--block" style={{ marginTop: 22, ['--me' as string]: `var(--${color})`, ['--me-ink' as string]: `var(--${color}-ink)` }} disabled={!name.trim() || busy}>
            {busy ? 'Setting up…' : 'Let’s go'} <Icon name="arrow" />
          </button>
        </form>
      </div>
    </main>
  );
}

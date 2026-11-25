import { useState } from 'react';
import { PROJECT_TEMPLATES } from '../../core/actions';
import { formatInviteCode, normalizeInviteCode } from '../../core/ids';
import { LINE_COLORS, type LineColor } from '../../core/model';
import { claimInvite, InviteError, type InvitePayload } from '../../core/session';
import { query } from '../router';
import { Icon } from '../ui/Icon';
import { lineVars, Logo, NameTag } from '../ui/primitives';

export interface OnboardResult {
  kind: 'new' | 'partner' | 'device';
  name?: string;
  color?: LineColor;
  invite?: InvitePayload;
  projects?: string[];
}

type Step = 'welcome' | 'name' | 'projects' | 'code';

const SHAPES: Array<{ c: LineColor; style: React.CSSProperties }> = [
  { c: 'lilac', style: { left: '-6%', top: '14%', width: 70, height: 86, borderRadius: 22, transform: 'rotate(8deg)' } },
  { c: 'orange', style: { right: '-4%', top: '10%', width: 64, height: 120, borderRadius: 20, transform: 'rotate(-6deg)' } },
  { c: 'pink', style: { right: '18%', top: '22%', width: 92, height: 64, borderRadius: 20, transform: 'rotate(8deg)' } },
  { c: 'lemon', style: { left: '14%', top: '26%', width: 160, height: 142, borderRadius: 30, transform: 'rotate(10deg)' } },
  { c: 'sky', style: { right: '-8%', top: '34%', width: 96, height: 104, borderRadius: '50% 42% 50% 46%' } },
  { c: 'pink', style: { left: '5%', top: '44%', width: 38, height: 110, borderRadius: 20, transform: 'rotate(-4deg)' } },
  { c: 'mint', style: { right: '8%', top: '50%', width: 104, height: 76, borderRadius: 22, transform: 'rotate(8deg)' } },
];

function Splash() {
  return (
    <div className="splash" aria-hidden="true">
      {SHAPES.map((s, i) => (
        <span key={i} className="splash__shape" style={{ ...lineVars(s.c), ...s.style, animationDelay: `${i * 70}ms` }} />
      ))}
      <span className="splash__outline" style={{ left: '32%', top: '36%', width: 54, height: 40, borderRadius: 16 }} />
      <span className="splash__outline" style={{ right: '12%', top: '49%', width: 100, height: 88, borderRadius: 20, transform: 'rotate(8deg)' }} />
      <NameTag name="Guy" color="pink" style={{ position: 'absolute', left: '52%', top: '34%' }} />
      <NameTag name="Hila" color="lemon" style={{ position: 'absolute', left: '28%', top: '55%' }} />
    </div>
  );
}

/** Three light steps: who you are, your color, what you want to keep track of. */
export function Onboarding({ onDone }: { onDone: (r: OnboardResult) => Promise<void> }) {
  const joinParam = query('join');
  const [step, setStep] = useState<Step>(joinParam ? 'code' : 'welcome');
  const [name, setName] = useState('');
  const [color, setColor] = useState<LineColor>('lemon');
  const [picked, setPicked] = useState<string[]>(['groceries', 'chores', 'todo']);
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
        if (inv.fromColor === color) setColor(inv.fromColor === 'pink' ? 'lemon' : 'pink');
        setStep('name');
      }
    } catch (e) {
      setBusy(false);
      setError(e instanceof InviteError ? e.message : 'Can’t reach your hub right now.');
    }
  };

  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  if (step === 'welcome') {
    return (
      <main className="onboard onboard--splash">
        <div className="onboard__logo">
          <Logo size={44} />
        </div>
        <Splash />
        <div className="onboard__bottom">
          <h1 className="onboard__headline display">Life together, sorted.</h1>
          <button type="button" className="btn btn--light btn--block onboard__go" onClick={() => setStep('name')}>
            Get started
            <span className="btn__arrow">
              <Icon name="arrow" className="icon--sm" />
            </span>
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
          <button type="button" className="iconbtn iconbtn--solid" onClick={() => setStep('welcome')} aria-label="Back">
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

  if (step === 'projects') {
    return (
      <main className="onboard">
        <div className="onboard__body">
          <button type="button" className="iconbtn iconbtn--solid" onClick={() => setStep('name')} aria-label="Back">
            <Icon name="arrow-back" />
          </button>
          <p className="onboard__step">2 of 2</p>
          <h1 className="onboard__q">What do you want to keep track of?</h1>
          <p className="onboard__lede">Tap to pick. You can add or remove projects any time.</p>
          <div className="pickgrid">
            {PROJECT_TEMPLATES.map((t) => {
              const on = picked.includes(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  className={`pickcard ${on ? 'is-on' : ''}`}
                  style={lineVars(t.color)}
                  onClick={() => toggle(t.key)}
                  aria-pressed={on}
                >
                  <span className="pickcard__top">
                    <span className="pickcard__icon">{t.icon}</span>
                    <span className="pickcard__check">{on ? <Icon name="check" className="icon--sm" /> : null}</span>
                  </span>
                  <span className="pickcard__name">{t.name}</span>
                  <span className="pickcard__blurb">{t.blurb}</span>
                </button>
              );
            })}
          </div>
          {error ? <p className="onboard__error">{error}</p> : null}
          <div className="onboard__actions">
            <button type="button" className="btn btn--block" disabled={busy} onClick={() => void finish({ kind: 'new', name: name.trim(), color, projects: picked })}>
              {busy ? 'Setting up…' : picked.length ? `Start with ${picked.length} project${picked.length > 1 ? 's' : ''}` : 'Start empty'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="onboard">
      <div className="onboard__body">
        <button type="button" className="iconbtn iconbtn--solid" onClick={() => setStep(invite ? 'code' : 'welcome')} aria-label="Back">
          <Icon name="arrow-back" />
        </button>
        {invite?.fromName ? <p className="onboard__invited">{invite.fromName} invited you 👋</p> : <p className="onboard__step">1 of 2</p>}
        <h1 className="onboard__q">Hey! What should we call you?</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (invite) void finish({ kind: 'partner', name: name.trim(), color, invite });
            else setStep('projects');
          }}
        >
          <input className="input input--big" value={name} dir="auto" autoFocus autoComplete="given-name" placeholder="Your name" aria-label="Your name" onChange={(e) => setName(e.target.value)} />
          <div className="field" style={{ marginTop: 26 }}>
            <span className="field__label">Pick your color</span>
            <div className="colorrow" role="radiogroup" aria-label="Color">
              {LINE_COLORS.filter((c) => c !== 'ink').map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={c === color}
                  aria-label={c}
                  disabled={taken.includes(c)}
                  className={`colordot ${c === color ? 'is-on' : ''}`}
                  style={lineVars(c)}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          <div className="onboard__preview">
            <NameTag name={name.trim() || 'You'} color={color} />
            <span>This is you, everywhere in the app.</span>
          </div>
          {error ? <p className="onboard__error">{error}</p> : null}
          <button type="submit" className="btn btn--block" style={{ marginTop: 26 }} disabled={!name.trim() || busy}>
            {busy ? 'Setting up…' : invite ? 'Join' : 'Next'}
            <Icon name="arrow" className="icon--sm" />
          </button>
        </form>
      </div>
    </main>
  );
}

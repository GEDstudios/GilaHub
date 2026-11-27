import { Swatches } from '../components/pickers';
import { useState } from 'react';
import { pickColors, PROJECT_TEMPLATES } from '../../core/seed';
import { formatInviteCode, formatRecoveryCode, normalizeInviteCode } from '../../core/ids';
import { type LineColor } from '../../core/model';
import { claimInvite, claimRecovery, InviteError, type InvitePayload } from '../../core/session';
import { query } from '../router';
import { Icon } from '../ui/Icon';
import { IconButton, lineVars, Logo, NameTag, TextButton, Button } from '../ui/primitives';
import { G } from '../ui/glyphs';
import { howMany } from '../labels';

export interface OnboardResult {
  kind: 'new' | 'partner' | 'device';
  name?: string;
  color?: LineColor;
  invite?: InvitePayload;
  projects?: string[];
  colors?: Record<string, LineColor>;
}

type Step = 'welcome' | 'name' | 'projects' | 'code' | 'recover';

const STARTERS = PROJECT_TEMPLATES.filter((t) => ['groceries', 'home', 'chores', 'todo'].includes(t.key));

const SHAPES: Array<{ c: LineColor; style: React.CSSProperties }> = [
  { c: 'lilac', style: { left: -34, top: '9%', width: 92, height: 92, borderRadius: 26, transform: 'rotate(-8deg)' } },
  { c: 'lemon', style: { right: -40, top: '16%', width: 118, height: 96, borderRadius: 28, transform: 'rotate(7deg)' } },
  { c: 'sky', style: { left: '12%', bottom: '24%', width: 54, height: 54, borderRadius: '50%' } },
  { c: 'pink', style: { right: '9%', bottom: '27%', width: 120, height: 44, borderRadius: 22, transform: 'rotate(-5deg)' } },
];

function Splash() {
  return (
    <div className="splash" aria-hidden="true">
      {SHAPES.map((s, i) => (
        <span key={i} className="splash__shape" style={{ ...lineVars(s.c), ...s.style, animationDelay: `${i * 90}ms` }} />
      ))}
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
  /** Each starter gets a random color now, so what you see is what you get. */
  const [colors] = useState(() => pickColors(STARTERS.map((t) => t.key)));
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

  // Back as me, from my recovery code: my keys come back, as a device of mine.
  const [rcode, setRcode] = useState('');
  const recover = async () => {
    setError(null);
    setBusy(true);
    try {
      const inv = await claimRecovery('', rcode);
      await finish({ kind: 'device', invite: inv });
    } catch (e) {
      setBusy(false);
      setError(e instanceof InviteError ? e.message : 'Can’t reach your hub right now.');
    }
  };

  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  if (step === 'welcome') {
    return (
      <main className="onboard onboard--splash">
        <Splash />
        <div className="onboard__logo">
          <Logo size={30} />
        </div>
        <div className="welcome">
          <h1 className="welcome__title">
            <NameTag name="Guy" color="pink" style={{ position: 'absolute', left: -6, top: -40 }} />
            Life together,
            <br />
            sorted.
            <NameTag name="Hila" color="lemon" flip style={{ position: 'absolute', right: -14, bottom: -40 }} />
          </h1>
          <p className="welcome__sub">Groceries, chores and plans, for two.</p>
        </div>
        <div className="onboard__bottom">
          <button type="button" className="go" onClick={() => setStep('name')}>
            Get started
            <span className="go__arrow">
              <Icon name={G.continue} className="icon--sm" />
            </span>
          </button>
          <TextButton onClick={() => setStep('code')} className="onboard__link">
            I have a code
          </TextButton>
          <TextButton onClick={() => setStep('recover')} className="onboard__link onboard__link--quiet">
            Recover my account
          </TextButton>
        </div>
      </main>
    );
  }

  if (step === 'code') {
    return (
      <main className="onboard">
        <div className="onboard__body">
          <IconButton icon={G.back} label="Back" onClick={() => setStep('welcome')} />
          <h1 className="onboard__q">Type the code from the other phone</h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
          >
            <input
              className="bigfield codeinput num"
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
            {error ? <p className="onboard__error">{error}</p> : <p className="hint">It’s on their phone, under “Bring your person in”.</p>}
            <Button block type="submit" disabled={normalizeInviteCode(code).length !== 8 || busy} className="onboard__cta">
              {busy ? 'Opening the invite…' : 'Join'}
            </Button>
          </form>
        </div>
      </main>
    );
  }

  if (step === 'recover') {
    const n = normalizeInviteCode(rcode);
    return (
      <main className="onboard">
        <div className="onboard__body">
          <IconButton icon={G.back} label="Back" onClick={() => setStep('welcome')} />
          <h1 className="onboard__q">Type your recovery code</h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void recover();
            }}
          >
            <input
              className="bigfield codeinput codeinput--long num"
              value={rcode}
              autoFocus
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="K7QM2-XPA9T-…"
              aria-label="Recovery code"
              onChange={(e) => setRcode(formatRecoveryCode(normalizeInviteCode(e.target.value).slice(0, 20)))}
            />
            {error ? <p className="onboard__error">{error}</p> : <p className="hint">The 20 letters and numbers you saved when you made it (Settings → Recovery code). You come back as you: your private things, your To-Do and your settings.</p>}
            <Button block type="submit" disabled={n.length !== 20 || busy} className="onboard__cta">
              {busy ? 'Unlocking…' : 'Recover'}
            </Button>
          </form>
        </div>
      </main>
    );
  }

  if (step === 'projects') {
    return (
      <main className="onboard">
        <div className="onboard__body">
          <IconButton icon={G.back} label="Back" onClick={() => setStep('name')} />
          <p className="onboard__step">2 of 2</p>
          <h1 className="onboard__q">What do you want to keep track of?</h1>
          <div className="picks">
            {STARTERS.map((t) => {
              const on = picked.includes(t.key);
              return (
                <button key={t.key} type="button" className={`pick ${on ? 'is-on' : ''}`} style={lineVars(colors[t.key])} onClick={() => toggle(t.key)} aria-pressed={on}>
                  <span className="pick__swatch" />
                  <span className="pick__name">{t.name}</span>
                  <span className="pick__check">{on ? <Icon name={G.done} className="icon--sm" /> : null}</span>
                </button>
              );
            })}
          </div>
          {error ? <p className="onboard__error">{error}</p> : null}
          <Button block disabled={busy} onClick={() => void finish({ kind: 'new', name: name.trim(), color, projects: picked, colors })} className="onboard__cta">
            {busy ? 'Setting up…' : picked.length ? `Start with ${howMany(picked.length, 'folder')}` : 'Start empty'}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="onboard">
      <div className="onboard__body">
        <IconButton icon={G.back} label="Back" onClick={() => setStep(invite ? 'code' : 'welcome')} />
        {invite?.fromName ? <p className="onboard__step">{invite.fromName} invited you</p> : <p className="onboard__step">1 of 2</p>}
        <h1 className="onboard__q">What should we call you?</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (invite) void finish({ kind: 'partner', name: name.trim(), color, invite });
            else setStep('projects');
          }}
        >
          <input className="bigfield" value={name} dir="auto" autoFocus autoComplete="given-name" placeholder="Your name" aria-label="Your name" onChange={(e) => setName(e.target.value)} />
          <p className="choose__label onboard__label">Your color</p>
          <Swatches value={color} onChange={setColor} taken={taken.map((c) => ({ color: c, name: 'your person', initial: '' }))} />
          <div className="onboard__preview">
            <NameTag name={name.trim() || 'You'} color={color} />
          </div>
          {error ? <p className="onboard__error">{error}</p> : null}
          <Button block type="submit" disabled={!name.trim() || busy} className="onboard__cta">
            {busy ? 'Setting up…' : invite ? 'Join' : 'Next'}
          </Button>
        </form>
      </div>
    </main>
  );
}

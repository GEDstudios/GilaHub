import { useState } from 'react';
import { SwitchRow } from '../../components/pickers';
import { useHub, useRt } from '../../context';
import { makeRecovery } from '../../../core/session';
import { formatRecoveryCode } from '../../../core/ids';
import { Sheet, useOverlays } from '../../ui/overlays';
import { Button } from '../../ui/primitives';
import { G } from '../../ui/glyphs';

/**
 * My recovery code: made here, shown once, kept by me (never by the app or the relay). With it,
 * a brand-new device gets me back, as me: my private things, my To-Do, my settings. A new code
 * replaces the old one, which stops working.
 */
export function RecoverySheet({ onClose }: { onClose: () => void }) {
  const rt = useRt();
  const hub = useHub();
  const me = hub.me();
  const { toast } = useOverlays();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await makeRecovery(rt.session, me?.name, me?.recoveryId);
      hub.upsertMember(hub.meId, { recoveryId: r.recoveryId, recoverySetAt: Date.now() });
      setCode(r.code);
    } catch {
      setError(rt.relay ? 'Couldn’t reach your hub. Try again in a moment.' : 'This needs your hub online (it keeps the locked copy).');
    }
    setBusy(false);
  };
  if (code) {
    const shown = formatRecoveryCode(code);
    return (
      <Sheet onClose={() => (saved ? onClose() : toast('Save your code first, then tick “I’ve saved it”.'))} title="Your recovery code">
        <p className="sheet__lede">Write it down or keep it in your password manager. It’s shown only now. Anyone with it can get into your account, so keep it to yourself.</p>
        <p className="recovery__code num" dir="ltr">
          {shown}
        </p>
        <div className="recovery__acts">
          <Button
            icon={G.copy}
            small
            quiet
            onClick={() => {
              void navigator.clipboard?.writeText(shown).then(
                () => toast('Copied'),
                () => toast('Couldn’t copy. Write it down.'),
              );
            }}
          >
            Copy
          </Button>
        </div>
        <SwitchRow title="I’ve saved it somewhere safe" on={saved} onChange={setSaved} />
        <Button block disabled={!saved} onClick={onClose}>
          Done
        </Button>
      </Sheet>
    );
  }
  return (
    <Sheet onClose={onClose} title="Recovery code">
      <p className="sheet__lede">
        If you ever lose every device (or reset them all), your recovery code brings you back as you: your private things, your To-Do and your settings. Your keys are kept on your hub locked with the code, so only the code can open them.
      </p>
      {me?.recoverySetAt ? <p className="hint">You made one on {new Date(me.recoverySetAt).toLocaleDateString()}. Making a new one stops the old one working.</p> : null}
      {error ? <p className="onboard__error">{error}</p> : null}
      <Button block disabled={busy} onClick={() => void make()}>
        {busy ? 'Locking your keys…' : me?.recoverySetAt ? 'Make a new code' : 'Make my recovery code'}
      </Button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Profile

import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState } from 'react';
import { formatInviteCode } from '../../core/ids';
import { createInvite } from '../../core/session';
import { useHub, useRt } from '../context';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/overlays';
import { Logo } from '../ui/primitives';

function QR({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Invite the partner, or add another of my own devices. */
export function PairSheet({ kind, onClose }: { kind: 'partner' | 'device'; onClose: () => void }) {
  const rt = useRt();
  const hub = useHub();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(30 * 60);

  const make = () => {
    setError(null);
    setCode(null);
    createInvite(rt.session, kind, hub.me()?.name, hub.me()?.color)
      .then(({ code }) => {
        setCode(code);
        setLeft(30 * 60);
      })
      .catch(() => setError('Couldn’t reach your hub. Check your connection and try again.'));
  };

  useEffect(() => {
    if (rt.relay) make();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt.relay]);

  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [code]);

  const link = code ? `${location.origin}/?join=${code}` : '';
  const title = kind === 'partner' ? 'Bring your person in' : 'Add another device';

  if (!rt.relay) {
    return (
      <Sheet onClose={onClose} title={title}>
        <p style={{ marginTop: 0 }}>Pairing needs your Gila Hub relay — a free Cloudflare Worker you own. Until then, everything stays safely on this device.</p>
        <p className="hint" style={{ margin: 0 }}>
          Set it up once with <code>npm run deploy</code> — see the README. Then open the app from your hub’s address.
        </p>
        <button type="button" className="btn btn--quiet btn--block" style={{ marginTop: 18 }} onClick={onClose}>
          Got it
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} title={title}>
      <ol className="pairsteps">
        <li>
          {kind === 'partner' ? 'On their phone, open' : 'On the other device, open'} <strong>{location.host}</strong> and add it to the Home Screen.
        </li>
        <li>
          Open Gila Hub there, tap <strong>I have a code</strong>, and type:
        </li>
      </ol>
      <div className="codepanel" aria-live="polite">
        {code ? <span className="codepanel__code num">{formatInviteCode(code)}</span> : error ? <span className="codepanel__err">{error}</span> : <Logo size={34} />}
        <span className="codepanel__meta">{code ? (left ? `Works for ${Math.ceil(left / 60)} min · once` : 'Expired') : ' '}</span>
      </div>
      {code ? (
        <div className="pairqr">
          <QR text={link} />
          <span className="hint" style={{ margin: 0 }}>
            Or scan with the other phone’s camera.
          </span>
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button type="button" className="btn btn--ghost" onClick={make}>
          <Icon name="refresh" className="icon--sm" /> New code
        </button>
        {code && 'share' in navigator ? (
          <button
            type="button"
            className="btn btn--me"
            style={{ flex: 1 }}
            onClick={() =>
              navigator.share({ title: 'Gila Hub', text: `Join me on Gila Hub — code ${formatInviteCode(code)}`, url: link }).catch(() => {})
            }
          >
            <Icon name="share" className="icon--sm" /> Share
          </button>
        ) : (
          <button type="button" className="btn btn--me" style={{ flex: 1 }} onClick={onClose}>
            Done
          </button>
        )}
      </div>
      <p className="hint" style={{ margin: '14px 2px 0' }}>
        The code unlocks an encrypted invite. Your hub never sees your keys{kind === 'partner' ? ' — and your “Only me” items stay yours.' : '.'}
      </p>
    </Sheet>
  );
}

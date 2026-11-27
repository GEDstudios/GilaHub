import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState } from 'react';
import { formatInviteCode } from '../../core/ids';
import { createInvite } from '../../core/session';
import { useHub, useRt } from '../context';
import { Sheet } from '../ui/overlays';
import { G } from '../ui/glyphs';
import { Choices } from '../ui/primitives';

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
        <p className="sheet__lede">
          {kind === 'partner'
            ? 'For now Gila Hub lives on this device only, so there’s no one to invite yet.'
            : 'For now Gila Hub lives on this device only, so there’s no other device to add yet.'}
        </p>
        <p className="hint">Pairing turns on once your hub is running. The README says how.</p>
        <button type="button" className="btn btn--quiet btn--block" style={{ marginTop: 20 }} onClick={onClose}>
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
        {code ? <span className="codepanel__code num">{formatInviteCode(code)}</span> : error ? <span className="codepanel__err">{error}</span> : <span className="codepanel__wait">Making a code…</span>}
        <span className="codepanel__meta">{code ? (left ? `Works for ${Math.ceil(left / 60)} min · once` : 'Expired') : ' '}</span>
      </div>
      {code ? (
        <div className="pairqr">
          <QR text={link} />
          <span>Or scan it</span>
        </div>
      ) : null}
      <Choices
        row
        choices={[
          { label: 'New code', icon: G.reload, quiet: true, run: make },
          code && 'share' in navigator
            ? { label: 'Share', icon: G.share, run: () => void navigator.share({ title: 'Gila Hub', text: `Join me on Gila Hub. Code: ${formatInviteCode(code)}`, url: link }).catch(() => {}) }
            : { label: 'Done', run: onClose },
        ]}
      />
    </Sheet>
  );
}

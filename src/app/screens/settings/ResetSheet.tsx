import { useState } from 'react';
import { useRt } from '../../context';
import { usePrefs } from '../../usePrefs';
import { disablePush } from '../../runtime';
import { needsBackup } from '../../settingsCopy';
import { Icon } from '../../ui/Icon';
import { Sheet, useOverlays } from '../../ui/overlays';
import { Choices } from '../../ui/primitives';
import { G } from '../../ui/glyphs';
import { downloadBackup } from './backup';

export function ResetSheet({ onClose }: { onClose: () => void }) {
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
          <Icon name={G.download} />
          Download a backup first
        </button>
      ) : null}
      <input className="field" placeholder="Type RESET to confirm" value={sure} onChange={(e) => setSure(e.target.value)} aria-label="Confirm" />
      <Choices
        choices={[
          {
            label: 'Reset this device',
            disabled: sure.trim().toUpperCase() !== 'RESET',
            run: async () => {
              rt.sync?.stop();
              await disablePush(rt).catch(() => {});
              await rt.persistence.wipe();
              try {
                localStorage.clear();
              } catch {
                /* storage blocked */
              }
              location.href = '/';
            },
          },
        ]}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------- recovery

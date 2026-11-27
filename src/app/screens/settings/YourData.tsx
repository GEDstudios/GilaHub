import { useRef } from 'react';
import { OptRow } from '../../components/pickers';
import { useHub, useRt } from '../../context';
import { usePrefs } from '../../usePrefs';
import { backupSub } from '../../settingsCopy';
import { Sheet, useOverlays } from '../../ui/overlays';
import { Section } from '../../ui/primitives';
import { G } from '../../ui/glyphs';
import { downloadBackup } from './backup';
import { ResetSheet } from './ResetSheet';
import { RecoverySheet } from './RecoverySheet';

export function YourData() {
  const hub = useHub();
  const me = hub.me();
  const rt = useRt();
  const prefs = usePrefs();
  const { openSheet, toast } = useOverlays();
  const file = useRef<HTMLInputElement>(null);

  const restore = async (f: File) => {
    try {
      const json = JSON.parse(await f.text()) as { app?: string; me?: string; data?: Record<string, Array<{ id: string } & Record<string, unknown>>> };
      const data = json.data;
      if (json.app !== 'gila-hub' || !data) throw new Error('not a backup');
      const run = (me?: string) => {
        const n = hub.importBackup(data, { me });
        toast(n ? `Restored ${n} things` : 'Nothing new in that backup');
      };
      if (typeof json.me === 'string') return run(json.me);
      // An older backup from the two of us, and nothing in it says which one made it: ask.
      const people = hub.backupOwner(data) ? [] : hub.backupStrangers(data);
      if (people.length < 2) return run();
      openSheet((close) => (
        <Sheet onClose={close} title="Which one is you?">
          <div className="tokens">
            {people.map((m) => (
              <button
                key={m.id}
                type="button"
                className="token"
                onClick={() => {
                  close();
                  run(m.id);
                }}
              >
                {m.name || 'Someone'}
              </button>
            ))}
          </div>
        </Sheet>
      ));
    } catch {
      toast('That file isn’t a Gila Hub backup.');
    }
  };

  return (
    <Section title="Your data">
      <div className="group">
        <OptRow
          icon={G.key}
          title="Recovery code"
          sub={
            me?.recoverySetAt
              ? `Made ${new Date(me.recoverySetAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}. Your way back in if you lose every device.`
              : 'None yet. Make one, so losing every device never loses you.'
          }
          chev
          onClick={() => openSheet((close) => <RecoverySheet onClose={close} />)}
        />
        <OptRow icon={G.download} title="Download a backup" sub={backupSub(prefs.lastBackupAt)} chev onClick={() => downloadBackup(rt, toast)} />
        <OptRow icon={G.upload} title="Restore from a backup" sub="Adds what’s missing. Never deletes." chev onClick={() => file.current?.click()} />
      </div>
      <div className="group group--danger">
        <OptRow
          icon={G.delete}
          title="Reset this device"
          sub="Removes Gila Hub from this device only"
          danger
          chev
          onClick={() => openSheet((close) => <ResetSheet onClose={close} />)}
        />
      </div>
      <input
        ref={file}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) void restore(e.target.files[0]);
          e.target.value = '';
        }}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- About

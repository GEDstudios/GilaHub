import { TimeField } from '../../components/TimeEntry';
import { DEFAULT_REMIND_AT } from '../../reminders';
import { playSound } from '../../ui/sounds';
import { wantsLiveCursor } from '../../ui/liveCursor';
import { hasMouse, isTouch } from '../../ui/pointer';
import { OptRow, SwitchRow } from '../../components/pickers';
import { useHub } from '../../context';
import { setPrefs, use24h, weekStart } from '../../prefs';
import { usePrefs } from '../../usePrefs';
import { haptic } from '../../ui/haptics';
import { Section, Seg, TextButton } from '../../ui/primitives';
import { G } from '../../ui/glyphs';

/** Every sound once, in a row: a tick, a pick, an add, a drop, all done, a nudge, something arrived. */
function hearThem() {
  const order = ['tick', 'select', 'add', 'drop', 'success', 'warn', 'notify'] as const;
  order.forEach((k, i) => setTimeout(() => playSound(k), i * 520));
}

// ---------------------------------------------------------------- yours, on every device

/** How I like things. They follow me to all my devices (userPrefs.ts), not this phone's. */
export function Preferences() {
  const hub = useHub();
  const prefs = usePrefs();
  const partner = hub.partner();
  return (
    <Section title="Yours, on every device">
      <div className="group">
        <OptRow
          icon={G.add}
          title="New from Today"
          sub={prefs.todayNew === 'ours' ? `Into your last shared folder, for you and ${partner?.name ?? 'your person'}` : 'Into your To-Do, private to you'}
          trail={
            <Seg
              small
              label="New things from Today"
              value={prefs.todayNew}
              options={[
                { value: 'mine', label: 'Mine' },
                { value: 'ours', label: 'Ours' },
              ]}
              onChange={(v) => setPrefs({ todayNew: v })}
            />
          }
        />
        <OptRow
          icon={G.remind}
          title="Notify at"
          sub="When a task has a day but no time"
          trail={<TimeField value={hub.me()?.remindAt || DEFAULT_REMIND_AT} label="Notify at, for a task with only a day" onChange={(t) => hub.upsertMember(hub.meId, { remindAt: t ?? null })} />}
        />
        <OptRow
          icon={G.date}
          title="Week starts"
          trail={
            <Seg
              small
              label="Week starts"
              value={String(weekStart(prefs)) as '0' | '1'}
              options={[
                { value: '0', label: 'Sun' },
                { value: '1', label: 'Mon' },
              ]}
              onChange={(v) => setPrefs({ weekStart: v === '1' ? 1 : 0 })}
            />
          }
        />
        <OptRow
          icon={G.time}
          title="Clock"
          trail={
            <Seg
              small
              label="Clock"
              value={use24h(prefs) ? '24' : '12'}
              options={[
                { value: '24', label: '13:00' },
                { value: '12', label: '1 pm' },
              ]}
              onChange={(v) => setPrefs({ h24: v === '24' })}
            />
          }
        />
        <SwitchRow icon={G.idea} title="Ideas tag" sub="Wishes for Gila Hub, on every screen" on={prefs.ideasTag} onChange={(on) => setPrefs({ ideasTag: on })} />
        {isTouch() ? (
          <SwitchRow
            icon={G.vibrate}
            title="Vibration"
            sub="A light tap when you tick, drag or pick"
            on={prefs.haptics}
            onChange={(on) => {
              setPrefs({ haptics: on });
              if (on) haptic('tick');
            }}
          />
        ) : null}
        {hasMouse() ? (
          <SwitchRow icon={G.cursor} title="Lively cursor" sub="Your mouse leans, bounces, and waves hello when you rest" on={wantsLiveCursor(prefs.livelyCursor)} onChange={(on) => setPrefs({ livelyCursor: on })} />
        ) : null}
        <SwitchRow
          icon={G.sound}
          title="Sounds"
          sub="Soft, round pops when you tick, pick and finish"
          on={prefs.sounds}
          onChange={(on) => {
            setPrefs({ sounds: on });
            if (on) playSound('success');
          }}
        />
        {prefs.sounds ? (
          <p className="editlink">
            <TextButton onClick={hearThem}>
              Hear them
            </TextButton>
          </p>
        ) : null}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- Your data

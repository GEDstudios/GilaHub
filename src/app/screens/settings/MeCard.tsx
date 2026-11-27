import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { LineColor, Member } from '../../../core/model';
import { PairSheet } from '../../components/PairSheet';
import { Swatches } from '../../components/pickers';
import { PersonCursor } from '../../ui/PersonCursor';
import { useHub, useRt, useSync } from '../../context';
import { syncAria, syncLabel, usSentence } from '../../settingsCopy';
import { replay } from '../../ui/flip';
import { haptic } from '../../ui/haptics';
import { Icon } from '../../ui/Icon';
import { useOverlays } from '../../ui/overlays';
import { CursorMark, initialOf, lightVar, lineVars } from '../../ui/primitives';
import { G } from '../../ui/glyphs';

const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width: 960px)').matches;

/**
 * My card: my name in the serif (edit in place), a sync pill, one line about us, and my
 * person's tag on its edge (or an invitation). Under it: Color, Name, Add a device.
 */
export function MeCard({ me, partner }: { me: Member; partner: Member | undefined }) {
  const hub = useHub();
  const rt = useRt();
  const sync = useSync();
  const { openSheet, toast } = useOverlays();
  const [name, setName] = useState(me.name);
  const [colors, setColors] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const cancel = useRef(false);

  // Someone renamed me on another device: follow, unless I'm typing.
  useEffect(() => {
    if (document.activeElement !== input.current) setName(me.name);
  }, [me.name]);

  // The color panel stays open to try colors; a tap anywhere else closes it.
  useEffect(() => {
    if (!colors) return;
    const away = (e: PointerEvent) => {
      if (!chips.current?.contains(e.target as Node)) setColors(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [colors]);

  const commit = () => {
    if (cancel.current) {
      cancel.current = false;
      return;
    }
    const n = name.trim();
    if (!n) {
      setName(me.name);
      replay(input.current);
      return;
    }
    if (n !== me.name) hub.upsertMember(me.id, { name: n });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      cancel.current = true;
      setName(me.name);
      e.currentTarget.blur();
    }
  };

  const pick = (c: LineColor) => {
    hub.upsertMember(me.id, { color: c });
    document.documentElement.style.setProperty('--me', `var(--${c})`);
    document.documentElement.style.setProperty('--me-light', lightVar(c));
    haptic('tick');
    replay(card.current, 'is-wobble');
  };

  // A tap on the pill: a short spin, then "Synced just now" with a tick once it is.
  const [poked, setPoked] = useState<{ at: number; done: boolean } | null>(null);
  const syncNow = async () => {
    if (sync.status === 'local') {
      await rt.ensureSync();
      if (!rt.sync) toast('No hub yet. Everything’s safe on this device.');
      return;
    }
    haptic('select');
    setPoked({ at: Date.now(), done: false });
    rt.sync?.poke();
  };
  useEffect(() => {
    if (!poked) return;
    if (poked.done) {
      const t = setTimeout(() => setPoked(null), 1800);
      return () => clearTimeout(t);
    }
    if (sync.status !== 'synced') {
      const t = setTimeout(() => setPoked(null), 8000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => {
        setPoked({ ...poked, done: true });
        haptic('tick');
      },
      Math.max(0, poked.at + 700 - Date.now()),
    );
    return () => clearTimeout(t);
  }, [poked, sync.status]);

  const here = !!partner && sync.others.some((o) => o.member === partner.id);

  return (
    <>
      <div className="mecard-wrap">
        <div ref={card} className="ccard ccard--lg mecard" style={lineVars(me.color)}>
          <span className="ccard__top">
            <input
              ref={input}
              className="ccard__input mecard__name"
              dir="auto"
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={onKey}
              enterKeyHint="done"
              autoComplete="off"
              spellCheck={false}
              aria-label="Your name"
            />
            <button type="button" className="mecard__sync" onClick={() => void syncNow()} aria-label={syncAria(sync.status, sync.lastSyncedAt)} aria-live="polite">
              {poked && !poked.done ? <Icon name={G.reload} className="icon--xs mecard__spin" /> : <span className={`syncdot syncdot--${sync.status}`} />}
              {poked ? (poked.done ? 'Synced just now' : 'Syncing…') : syncLabel(sync.status, wide())}
            </button>
          </span>
          <span className="ccard__sub" dir="auto">
            {usSentence(partner ?? null)}
          </span>
        </div>
        {partner ? (
          <span
            className="nametag mecard__tag"
            style={lineVars(partner.color)}
            role="img"
            aria-label={here ? `${partner.name} is here now` : partner.name}
            onClick={(e) => {
              haptic('select');
              replay(e.currentTarget, 'is-wiggle');
            }}
          >
            <PersonCursor color={partner.color} />
            {here ? <span className="live" /> : null}
            <span dir="auto">{partner.name}</span>
          </span>
        ) : (
          <button type="button" className="nametag mecard__tag mecard__tag--empty" onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)}>
            <CursorMark className="nametag__cursor" />
            <Icon name={G.add} className="icon--xs" />
            Your person?
          </button>
        )}
      </div>

      <div className="inline__chips" ref={chips}>
        <button type="button" className={`echip is-set ${colors ? 'is-open' : ''}`} aria-expanded={colors} onClick={() => setColors(!colors)}>
          <span className="echip__dot" style={lineVars(me.color)} />
          Color
        </button>
        <button
          type="button"
          className="echip is-set"
          onClick={() => {
            setColors(false);
            input.current?.focus();
            input.current?.select();
          }}
        >
          <Icon name={G.edit} />
          Name
        </button>
        <button
          type="button"
          className="echip"
          onClick={() => {
            setColors(false);
            openSheet((close) => <PairSheet kind="device" onClose={close} />);
          }}
        >
          <Icon name={G.device} />
          Add a device
        </button>
        {colors ? (
          <div className="panel">
            <Swatches value={me.color} onChange={pick} taken={partner ? [{ color: partner.color, name: partner.name, initial: initialOf(partner.name) }] : []} />
            <p className="panel__hint" dir="auto">
              {partner ? `${partner.color[0].toUpperCase()}${partner.color.slice(1)} is ${partner.name}’s. ` : ''}What you add shows in your color.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Notifications

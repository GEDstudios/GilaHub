import { useState } from 'react';
import type { Item } from '../../core/model';
import { useHub } from '../context';
import { Icon } from '../ui/Icon';
import { Avatar, Section } from '../ui/primitives';
import { RequestActions } from '../ui/tags';
import type { Settle } from '../ui/useSettle';
import type { TodayView } from '../views';
import { ItemRow } from './ItemRow';

/** The tile shows this many rows before "Show n more". */
const CAP = 6;

/**
 * "Waiting on you" (the `asks` block on Today): what my partner says is done (OK / Not yet
 * under the text), then what they asked me for. Under it, a quiet line for what I asked them.
 * Nothing while I'm on my own. Rows settle through the screen's `settle` (ticked rows strike
 * and fold before they leave).
 */
export function AsksWidget({ v, settle, bare }: { v: TodayView; settle: Settle<Item>; bare?: boolean }) {
  const hub = useHub();
  const partner = hub.partner();
  const [more, setMore] = useState(!!bare);
  if (!partner) return null;
  const rows = [...settle.view('ok', v.awaitingOk), ...settle.view('asked', v.asked)];
  const shown = more ? rows : rows.slice(0, CAP);
  const line = <AskedLine v={v} settle={settle} />;
  if (!rows.length) return <div className="asks-quiet">{line}</div>;
  const body = (
    <>
      <ul className="rows">
        {shown.map(({ row: i, settling }) =>
          i.submittedAt && i.requestedBy === hub.meId ? (
            <ItemRow key={i.id} item={i} settling={settling} showList dateMode="none" below={<RequestActions item={i} className="row__acts" />} />
          ) : (
            <ItemRow key={i.id} item={i} settling={settling} showList />
          ),
        )}
      </ul>
      {rows.length > CAP && !more ? (
        <button type="button" className="quietline" onClick={() => setMore(true)}>
          Show {rows.length - CAP} more
          <span className="quietline__end">
            <Icon name="chevron-down" />
          </span>
        </button>
      ) : null}
      {line}
    </>
  );
  // In a sheet (the summary's person tag, when this block is off), the sheet's title says it.
  if (bare) return body;
  return (
    <Section title="Waiting on you" count={v.awaitingOk.length + v.asked.length} id="home-asks">
      {body}
    </Section>
  );
}

/**
 * What I asked Hila for, and what I did of hers that waits for her OK, saying who did what:
 * "You asked Hila for 2 things · you did 1 for Hila to OK". It opens to those rows.
 */
function AskedLine({ v, settle }: { v: TodayView; settle: Settle<Item> }) {
  const hub = useHub();
  const partner = hub.partner();
  const [open, setOpen] = useState(false);
  const n = v.outgoing.length;
  const m = v.waitingTheirOk.length;
  const rows = [...settle.view('outgoing', v.outgoing), ...settle.view('theirok', v.waitingTheirOk)];
  if (!partner || !rows.length) return null;
  const P = partner.name;
  const things = (k: number) => `${k} ${k === 1 ? 'thing' : 'things'}`;
  const text = !m ? `You asked ${P} for ${things(n)}` : !n ? `You did ${things(m)} for ${P} · waiting for ${P}’s OK` : `You asked ${P} for ${things(n)} · you did ${m} for ${P} to OK`;
  return (
    <>
      <button type="button" className="quietline" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Avatar member={partner} size="xs" />
        <span dir="auto">{text}</span>
        <span className="quietline__end">
          <Icon name="chevron-down" />
        </span>
      </button>
      {open ? (
        <ul className="rows quietline__rows">
          {rows.map(({ row: i, settling }) => (
            <ItemRow key={i.id} item={i} settling={settling} showList />
          ))}
        </ul>
      ) : null}
    </>
  );
}

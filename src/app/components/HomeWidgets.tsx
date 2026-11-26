import { NotesElsewhere } from './Notes';
import { useState } from 'react';
import type { Item } from '../../core/model';
import { byOrder } from '../../core/order';
import { useHub, usePartnerHere } from '../context';
import { setPrefs, usePrefs } from '../prefs';
import { navigate } from '../router';
import { quickItems } from '../quick';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { ProjectMark } from '../ui/ProjectMark';
import { Avatar, Section } from '../ui/primitives';
import { SettleContext, useSettle, type Settle } from '../ui/useSettle';
import { todayView } from '../views';
import { AsksWidget } from './Asks';
import { ItemRow } from './ItemRow';
import { PairSheet } from './PairSheet';
import { isOpen } from '../../core/model';
import { listKey } from '../../core/keys';

/**
 * The blocks of the Today page (HOME §2–3). Today.tsx draws the summary and notices, then
 * these in my order (home.ts). A block with nothing to show draws nothing at all, header
 * included; Today and pinned projects keep their add row.
 */

const idOf = (i: Item) => i.id;

/** The partner's asks in a sheet, when Waiting on you isn't on the page. */
export function AsksSheet({ onClose, day }: { onClose: () => void; day: string }) {
  const hub = useHub();
  const v = todayView(hub, day);
  const settle = useSettle(idOf);
  return (
    <Sheet onClose={onClose} title="Waiting on you">
      <SettleContext.Provider value={settle}>
        <AsksWidget v={v} settle={settle} bare />
      </SettleContext.Provider>
    </Sheet>
  );
}

/** Live notices under the summary: the partner is in the store. */
export function HomeNotices() {
  const hub = useHub();
  const here = usePartnerHere();
  const shopper = here ? hub.member(here.member) : undefined;
  const on = here?.listId ? hub.list(here.listId) : undefined;
  return (
    <>
      <NotesElsewhere />
      {shopper && on ? (
        <button type="button" className="notice" onClick={() => navigate({ name: 'list', id: on.id })}>
          <Avatar member={shopper} size="sm" />
          <span className="notice__text">
            <strong>
              {shopper.name} is on {on.name} now.
            </strong>{' '}
            Need anything?
          </span>
          <Icon name="chevron-right" />
        </button>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- my quick view

/** The tasks I chose to keep in sight here (a task's "Highlights" chip), from any folder. Gone while it's empty. */
export function QuickView({ settle, show }: { settle: Settle<Item>; show?: (i: Item) => boolean }) {
  const hub = useHub();
  const prefs = usePrefs();
  const open = quickItems(hub, prefs.quick).filter((i) => !show || show(i));
  const rows = settle.view('quick', open);
  if (!rows.length) return null;
  return (
    <Section
      title={
        <>
          <Icon name="sparkle" className="icon--sm" />
          <span>Highlights</span>
        </>
      }
      count={open.length}
    >
      <ul className="rows">
        {rows.map(({ row: i, settling }) => (
          <ItemRow key={i.id} item={i} settling={settling} showList listLink={false} />
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------- a pinned project

/** A window into one project: its first few open things and its add row. Never deduped. */
export function ProjectWidget({ listId, settle, show }: { listId: string; day?: string; settle: Settle<Item>; show?: (i: Item) => boolean }) {
  const hub = useHub();
  const list = hub.list(listId);
  if (!list) return null;
  // What's open in it, and in the projects inside it.
  const ids = new Set(hub.treeIds(listId));
  const open = hub.store.all('item').filter((i) => ids.has(i.listId) && !i.parentId && isOpen(i) && (!show || show(i)));
  // Its name is the way in.
  const head = (
    <button type="button" className="section__go" onClick={() => navigate({ name: 'list', id: listId })}>
      <ProjectMark color={list.color} icon={list.icon} size="sm" />
      <span dir="auto">{list.name}</span>
      <Icon name="chevron-right" className="section__goarrow" />
    </button>
  );
  // Urgent first, then in the project's order: the first five.
  const rows = settle.view(listKey(listId), [...open].sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || byOrder(a, b)).slice(0, 5));
  const body = rows.length ? (
    <ul className="rows">
      {rows.map(({ row: i, settling }) => (
        <ItemRow key={i.id} item={i} settling={settling} />
      ))}
    </ul>
  ) : null;
  return (
    <Section title={head} count={open.length}>
      {body}
    </Section>
  );
}

// ---------------------------------------------------------------- invite

const TWO_WEEKS = 14 * 86_400_000;

/** While I'm on my own: bring my person in. × puts it away for two weeks (this device). */
export function InviteCard() {
  const hub = useHub();
  const prefs = usePrefs();
  const { openSheet, toast } = useOverlays();
  // Read once per draw; the card comes back on its own after two weeks.
  const [now] = useState(() => Date.now());
  if (hub.partner() || prefs.inviteHiddenUntil > now) return null;
  return (
    <div className="invite">
      <button type="button" className="invite__main" onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)}>
        <span className="invite__people" aria-hidden="true">
          <Avatar member={hub.me()} size="md" />
          <span className="invite__empty">
            <Icon name="plus" className="icon--sm" />
          </span>
        </span>
        <span className="invite__text">
          <strong>Bring your person in</strong>
        </span>
        <Icon name="chevron-right" />
      </button>
      <button
        type="button"
        className="invite__x"
        aria-label="Not now"
        title="Not now"
        onClick={() => {
          setPrefs({ inviteHiddenUntil: Date.now() + TWO_WEEKS });
          toast('Okay. It’s in Settings when you’re ready.');
        }}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

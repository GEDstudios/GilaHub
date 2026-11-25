import { useState } from 'react';
import { humanDate, relativeAgo, sinceDate, today as todayStr, weekdayName } from '../../core/dates';
import type { Assignee, RepeatRule } from '../../core/model';
import { describeRule, freshness } from '../../smart/recurrence';
import { RepeatSheet, WhoSheet, whoLabel, OptRow } from '../components/pickers';
import { useHub } from '../context';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { Band, Check, Empty, PersonBullet, Section, lineVars } from '../ui/primitives';
import { back } from '../router';
import { useAddAction } from '../addAction';
import { ProjectMenuButton } from './ListScreen';
import { choresView, type ChoreRow } from '../views';

const WORD = { fresh: 'Fresh', soon: 'Soon', today: 'Today', whenever: 'When you can' } as const;

function ChoreItem({ row }: { row: ChoreRow }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const { item, list } = row;
  const ref = todayStr();
  const fresh = freshness(item.due, ref);
  const who = item.assignee === 'turns' ? hub.member(item.turn) : item.assignee && item.assignee !== 'both' ? hub.member(item.assignee) : undefined;
  const last = item.lastDoneAt ? `${hub.member(item.lastDoneBy)?.name ?? ''} · ${relativeAgo(item.lastDoneAt)}` : null;
  const rule = item.repeat ? describeRule(item.repeat, (n) => weekdayName(n)).replace(" after it's done", '') : 'Once';

  const done = () => {
    if (!item.repeat) {
      const undo = hub.toggle(item.id);
      toast('Done.', { action: { label: 'Undo', run: undo } });
      return;
    }
    const undo = hub.completeRepeating(item.id);
    const next = hub.item(item.id);
    const turn = next?.assignee === 'turns' && next.turn ? ` · ${next.turn === hub.meId ? 'your' : `${hub.member(next.turn)?.name}’s`} turn next` : '';
    toast(`Fresh again. Next: ${next?.due ? humanDate(next.due, ref) : '—'}${turn}`, { action: { label: 'Undo', run: undo } });
  };

  return (
    <li className="row row--tap chore" onClick={() => navigate({ name: 'item', id: item.id })} style={lineVars(list.color)}>
      <Check on={false} color={list.color} onToggle={done} label={`${item.title} — done`} />
      <div className="row__body">
        <span className="row__title" dir="auto">
          {item.title}
        </span>
        <span className="row__meta">
          <span className="meta">{rule}</span>
          {item.assignee === 'turns' && who ? <span className="meta">{who.id === hub.meId ? 'your turn' : `${who.name}’s turn`}</span> : null}
          {last ? <span className="meta meta--soft">{last}</span> : null}
          {item.due && item.due < ref ? <span className="meta meta--soft">{sinceDate(item.due, ref)}</span> : null}
        </span>
        <div className="fresh" aria-hidden="true">
          <div className="fresh__bar" style={{ width: `${Math.max(4, row.level * 100)}%`, background: fresh === 'whenever' ? 'var(--pebble)' : undefined }} />
        </div>
      </div>
      <span className="row__trail">
        <span className={`word ${fresh === 'today' ? 'word--today' : fresh === 'soon' ? 'word--soon' : ''}`}>{item.paused ? 'Paused' : WORD[fresh]}</span>
        {who ? <PersonBullet member={who} size="sm" /> : null}
      </span>
    </li>
  );
}

export function NewChoreSheet({ onClose, listId }: { onClose: () => void; listId: string }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const [title, setTitle] = useState('');
  const [rule, setRule] = useState<RepeatRule>({ type: 'interval', every: 1, unit: 'week', from: 'done' });
  const [who, setWho] = useState<Assignee>(null);
  const save = () => {
    if (!title.trim()) return;
    hub.addItem(listId, { title, repeat: rule, assignee: who });
    onClose();
  };
  return (
    <Sheet onClose={onClose} title="New chore">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input className="input input--big" dir="auto" placeholder="Clean the bathroom" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus aria-label="Chore" />
        <div className="chips" style={{ marginTop: 14 }}>
          {['Dishes', 'Laundry', 'Vacuum', 'Bins', 'Bathroom', 'Sheets', 'Plants', 'Fridge'].map((s) => (
            <button key={s} type="button" className="chip" onClick={() => setTitle(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <OptRow
            icon="repeat"
            title="How often"
            value={describeRule(rule, (n) => weekdayName(n))}
            onClick={() => openSheet((close) => <RepeatSheet onClose={close} rule={rule} onSave={(r) => r && setRule(r)} />)}
          />
          <OptRow
            icon="user"
            title="Who"
            value={whoLabel(hub, who)}
            onClick={() => openSheet((close) => <WhoSheet onClose={close} value={who} onSave={setWho} repeating />)}
          />
        </div>
        <button type="submit" className="btn btn--me btn--block" style={{ marginTop: 18 }} disabled={!title.trim()}>
          Add chore
        </button>
      </form>
    </Sheet>
  );
}

export function Chores({ listId }: { listId?: string } = {}) {
  const hub = useHub();
  const { openSheet, toast } = useOverlays();
  const ref = todayStr();
  const all = choresView(hub, ref);
  const scoped = listId ? hub.list(listId) : undefined;
  const only = (rows: ChoreRow[]) => (scoped ? rows.filter((r) => r.list.id === scoped.id) : rows);
  const v = { ...all, now: only(all.now), soon: only(all.soon), fresh: only(all.fresh), paused: only(all.paused) };
  const total = v.now.length + v.soon.length + v.fresh.length + v.paused.length;
  const away = hub.isAway();
  const list = scoped ?? all.lists[0];

  const newChore = () => {
    const target = list ?? hub.list(hub.createList({ name: 'Chores', kind: 'chores', color: 'pink', icon: '🧽' }));
    if (target) openSheet((close) => <NewChoreSheet onClose={close} listId={target.id} />);
  };
  useAddAction(newChore);

  const toggleAway = () => {
    hub.setAway(!away);
    toast(away ? 'Welcome back. The chores waited for you.' : 'Have a good trip. Chore clocks are paused.');
  };

  return (
    <>
      <Band
        className={scoped ? 'band--tone' : undefined}
        style={scoped ? lineVars(scoped.color) : undefined}
        lead={scoped?.icon ? <span className="band__icon">{scoped.icon}</span> : undefined}
        onBack={scoped ? () => back({ name: 'lists' }) : undefined}
        title={scoped?.name ?? 'Chores'}
        sub={away ? 'Away mode · clocks paused' : v.now.length ? `${v.now.length} ready when you are` : 'Everything’s fresh'}
        actions={
          <>
            <button type="button" className="iconbtn" onClick={toggleAway} aria-label={away ? 'We’re back' : 'We’re away'} aria-pressed={away}>
              <Icon name="plane" />
            </button>
            {scoped ? <ProjectMenuButton listId={scoped.id} /> : null}
          </>
        }
      />
      <div className="column">
        {away ? (
          <button type="button" className="banner" onClick={toggleAway}>
            <Icon name="plane" />
            <span className="banner__text">
              You’re away
              <span className="banner__sub">Nothing goes stale while you travel. Tap when you’re home.</span>
            </span>
            <span className="btn btn--sm">We’re back</span>
          </button>
        ) : null}

        {!total ? (
          <Empty mark={<span style={{ fontSize: 56 }}>✨</span>} title="No chores yet" text="Add the things that keep coming back — dishes, bins, sheets. Tick them whenever you do them.">
            <button type="button" className="btn btn--me" style={{ marginTop: 18 }} onClick={newChore}>
              Add a chore
            </button>
          </Empty>
        ) : null}

        {v.now.length ? (
          <Section title="Today" count={v.now.length}>
            <ul className="rows">
              {v.now.map((r) => (
                <ChoreItem key={r.item.id} row={r} />
              ))}
            </ul>
          </Section>
        ) : total ? (
          <p className="hint" style={{ marginTop: 24 }}>
            Nothing needs doing today. Tick anything early — it just resets the clock.
          </p>
        ) : null}
        {v.soon.length ? (
          <Section title="Soon" count={v.soon.length}>
            <ul className="rows">
              {v.soon.map((r) => (
                <ChoreItem key={r.item.id} row={r} />
              ))}
            </ul>
          </Section>
        ) : null}
        {v.fresh.length ? (
          <Section title="Fresh" count={v.fresh.length}>
            <ul className="rows">
              {v.fresh.map((r) => (
                <ChoreItem key={r.item.id} row={r} />
              ))}
            </ul>
          </Section>
        ) : null}
        {v.paused.length ? (
          <Section title="Paused" count={v.paused.length}>
            <ul className="rows">
              {v.paused.map((r) => (
                <ChoreItem key={r.item.id} row={r} />
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </>
  );
}

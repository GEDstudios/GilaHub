import { useRef, useState } from 'react';
import { humanDate, relativeAgo, sinceDate, today as todayStr } from '../../core/dates';
import type { Assignee, RepeatRule } from '../../core/model';
import { freshness } from '../../smart/recurrence';
import { useAddAction } from '../addAction';
import { Options, ruleShort } from '../components/editors';
import { useHub } from '../context';
import { back, navigate } from '../router';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Avatar, Band, Check, IconButton, lineVars, Section } from '../ui/primitives';
import { choresView, type ChoreRow } from '../views';
import { ProjectHero, ProjectMenuButton } from './ListScreen';
import { SyncBadge } from './Today';

const WORD = { fresh: 'Fresh', soon: 'Soon', today: 'Today', whenever: 'When you can' } as const;

function ChoreItem({ row }: { row: ChoreRow }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const { item, list } = row;
  const ref = todayStr();
  const fresh = freshness(item.due, ref);
  const who = item.assignee === 'turns' ? hub.member(item.turn) : item.assignee && item.assignee !== 'both' ? hub.member(item.assignee) : undefined;
  const meta = [
    item.repeat ? ruleShort(item.repeat) : 'Once',
    item.assignee === 'turns' && who ? (who.id === hub.meId ? 'your turn' : `${who.name}’s turn`) : null,
    item.due && item.due < ref ? sinceDate(item.due, ref) : item.lastDoneAt ? `${item.lastDoneBy === hub.meId ? 'you' : (hub.member(item.lastDoneBy)?.name ?? '')}, ${relativeAgo(item.lastDoneAt)}` : null,
  ].filter(Boolean);

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
      <Check on={false} color={list.color} onToggle={done} label={`${item.title}, done`} />
      <div className="row__body">
        <span className="row__title" dir="auto">
          {item.title}
        </span>
        <span className="row__meta">
          <span className="meta">{meta.join(' · ')}</span>
        </span>
      </div>
      <span className="row__trail">
        <span className={`word ${fresh === 'today' || fresh === 'whenever' ? 'word--now' : ''}`}>{item.paused ? 'Paused' : WORD[fresh]}</span>
        {who && item.assignee !== 'turns' ? <Avatar member={who} size="xs" /> : null}
      </span>
    </li>
  );
}

const OFTEN: Array<{ key: string; label: string; rule: RepeatRule }> = [
  { key: 'd1', label: 'Every day', rule: { type: 'interval', every: 1, unit: 'day', from: 'done' } },
  { key: 'w1', label: 'Every week', rule: { type: 'interval', every: 1, unit: 'week', from: 'done' } },
  { key: 'm1', label: 'Every month', rule: { type: 'interval', every: 1, unit: 'month', from: 'done' } },
];

/** Add a chore in place: a name, how often, who. */
function AddChore({ listId, focusRef, suggest }: { listId: string | undefined; focusRef: React.RefObject<HTMLInputElement | null>; suggest?: boolean }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const partner = hub.partner();
  const [title, setTitle] = useState('');
  const [often, setOften] = useState('w1');
  const [who, setWho] = useState<Assignee>(null);

  const save = () => {
    if (!title.trim()) return;
    const target = listId ?? hub.createList({ name: 'Chores', kind: 'chores', color: 'pink' });
    hub.addItem(target, { title: title.trim(), repeat: OFTEN.find((o) => o.key === often)!.rule, assignee: who });
    toast(`Added ${title.trim()}`, { ms: 1800 });
    setTitle('');
    setWho(null);
  };

  return (
    <form
      className={`quickadd ${title.trim() ? 'is-typing' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="addrow">
        <span className="addrow__plus" aria-hidden="true">
          <Icon name="plus" className="icon--sm" />
        </span>
        <input ref={focusRef} value={title} dir="auto" onChange={(e) => setTitle(e.target.value)} placeholder="Add a chore" aria-label="Add a chore" enterKeyHint="done" />
      </div>
      {title.trim() ? (
        <div className="panel panel--flat">
          <Options value={often} onPick={setOften} options={OFTEN.map((o) => ({ value: o.key, label: o.label }))} />
          {partner ? (
            <Options
              value={who ?? 'either'}
              onPick={(k) => setWho(k === 'either' ? null : (k as Assignee))}
              options={[
                { value: 'either', label: 'Either of us' },
                { value: hub.meId, label: 'Me' },
                { value: partner.id, label: partner.name },
                { value: 'turns', label: 'Take turns' },
              ]}
            />
          ) : null}
          <button type="submit" className="btn btn--sm">
            Add chore
          </button>
        </div>
      ) : suggest ? (
        <div className="tokens">
          {['Dishes', 'Laundry', 'Bins', 'Sheets'].map((s) => (
            <button
              key={s}
              type="button"
              className="token"
              onClick={() => {
                setTitle(s);
                focusRef.current?.focus();
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}

export function Chores({ listId }: { listId?: string } = {}) {
  const hub = useHub();
  const { toast } = useOverlays();
  const ref = todayStr();
  const all = choresView(hub, ref);
  const scoped = listId ? hub.list(listId) : undefined;
  const only = (rows: ChoreRow[]) => (scoped ? rows.filter((r) => r.list.id === scoped.id) : rows);
  const v = { ...all, now: only(all.now), soon: only(all.soon), fresh: only(all.fresh), paused: only(all.paused) };
  const total = v.now.length + v.soon.length + v.fresh.length + v.paused.length;
  const away = hub.isAway();
  const list = scoped ?? all.lists[0];
  const input = useRef<HTMLInputElement>(null);
  useAddAction(() => input.current?.focus());

  const toggleAway = () => {
    hub.setAway(!away);
    toast(away ? 'Welcome back. The chores waited for you.' : 'Have a good trip. Chore clocks are paused.');
  };
  const sub = away ? 'Away · clocks paused' : v.now.length ? `${v.now.length} ready` : total ? 'All fresh' : undefined;
  const awayBtn = <IconButton icon="plane" label={away ? 'We’re back' : 'We’re away'} onClick={toggleAway} pressed={away} />;

  const group = (title: string, rows: ChoreRow[]) =>
    rows.length ? (
      <Section title={title} count={rows.length}>
        <ul className="rows">
          {rows.map((r) => (
            <ChoreItem key={r.item.id} row={r} />
          ))}
        </ul>
      </Section>
    ) : null;

  return (
    <>
      {scoped ? (
        <Band
          onBack={() => back({ name: 'lists' })}
          mini={scoped.name}
          actions={
            <>
              {awayBtn}
              <ProjectMenuButton listId={scoped.id} />
            </>
          }
        >
          <ProjectHero list={scoped} sub={sub ?? 'Empty'} />
        </Band>
      ) : (
        <Band top={<SyncBadge />} title="Chores" sub={sub} actions={awayBtn} />
      )}
      <div className="column">
        {away ? (
          <button type="button" className="notice" onClick={toggleAway}>
            <Icon name="plane" />
            <span className="notice__text">
              <strong>Away mode is on.</strong> Tap when you’re home.
            </span>
          </button>
        ) : null}

        {group('Today', v.now)}
        {group('Soon', v.soon)}
        {group('Fresh', v.fresh)}
        {group('Paused', v.paused)}

        <div className="section">
          <AddChore listId={list?.id} focusRef={input} suggest={!total} />
        </div>
      </div>
    </>
  );
}

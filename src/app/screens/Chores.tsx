import { useRef } from 'react';
import { createFromTemplate, PROJECT_TEMPLATES } from '../../core/actions';
import { humanDate, relativeAgo, sinceDate, today as todayStr } from '../../core/dates';
import { useAddAction } from '../addAction';
import { ruleShort } from '../components/editors';
import { AddRow, type AddRowHandle } from '../components/QuickAdd';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { useHub } from '../context';
import { back, navigate } from '../router';
import { Icon } from '../ui/Icon';
import { doneMany, useOverlays } from '../ui/overlays';
import { doerOf, requestState } from '../privacy';
import { Avatar, Band, Check, Disclosure, Empty, lineVars, NewButton, Section } from '../ui/primitives';
import { useFresh } from '../ui/fresh';
import { ReqTag, VisTag } from '../ui/tags';
import { useSettle } from '../ui/useSettle';
import { choresView, type ChoreRow } from '../views';
import { heroVis, ProjectActions, ProjectChips, ProjectHero } from './ListScreen';
import { NewProjectSheet } from './Lists';
import { SyncBadge } from '../components/SyncBadge';
import { AWAY_ON, welcomeBack } from '../settingsCopy';

/** One chore row; ticking it gives the "Fresh again. Next: …" toast. Also on Today (Chores ready). */
export function ChoreItem({ row, settling, onHold }: { row: ChoreRow; settling: boolean; onHold: (id: string) => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const { item, list } = row;
  const ref = todayStr();
  const who = doerOf(hub, item);
  const req = requestState(hub, item);
  const fresh = useFresh(item.id);
  const meta = [
    item.repeat ? ruleShort(item.repeat) : 'Once',
    item.assignee === 'turns' && who ? (who.id === hub.meId ? 'your turn' : `${who.name}’s turn`) : null,
    item.due && item.due < ref ? sinceDate(item.due, ref) : item.lastDoneAt ? `${item.lastDoneBy === hub.meId ? 'you' : (hub.member(item.lastDoneBy)?.name ?? '')}, ${relativeAgo(item.lastDoneAt)}` : null,
  ].filter(Boolean);

  const done = () => {
    onHold(item.id);
    if (!item.repeat) {
      const undo = hub.toggle(item.id);
      toast('Done', { action: { label: 'Undo', run: undo }, group: 'done', many: doneMany });
      return;
    }
    const undo = hub.completeRepeating(item.id);
    const next = hub.item(item.id);
    const turn = next?.assignee === 'turns' && next.turn ? ` · ${next.turn === hub.meId ? 'your' : `${hub.member(next.turn)?.name}’s`} turn next` : '';
    toast(`Fresh again. Next: ${next?.due ? humanDate(next.due, ref) : '—'}${turn}`, { action: { label: 'Undo', run: undo } });
  };

  return (
    <li
      className={`row row--tap chore ${settling ? 'is-settling' : ''} ${fresh ? 'row--fresh row--flash' : ''}`}
      onClick={() => navigate({ name: 'item', id: item.id })}
      style={lineVars(list.color)}
      data-settle={item.id}
      data-id={item.id}
    >
      <Check on={settling} color={list.color} onToggle={done} label={`${item.title}, done`} />
      <div className="row__body">
        <span className="row__title" dir="auto">
          {item.title}
        </span>
        <span className="row__meta">
          {req ? <ReqTag state={req} /> : null}
          <VisTag item={item} />
          <span className="meta">{meta.join(' · ')}</span>
        </span>
      </div>
      <span className="row__trail">
        {item.due && item.due > ref && !item.paused ? <span className="word">{humanDate(item.due, ref)}</span> : null}
        {who && item.assignee !== 'turns' ? <Avatar member={who} size="xs" /> : null}
      </span>
    </li>
  );
}

const choreId = (r: ChoreRow) => r.item.id;

/** A few to start with, while there are none of your own yet. */
const STARTERS = ['Dishes', 'Laundry', 'Bins', 'Sheets'];

export function Chores({ listId }: { listId?: string } = {}) {
  const hub = useHub();
  const { openSheet, toast } = useOverlays();
  const ref = todayStr();
  const all = choresView(hub, ref);
  const scoped = listId ? hub.list(listId) : undefined;
  const only = (rows: ChoreRow[]) => (scoped ? rows.filter((r) => r.list.id === scoped.id) : rows);
  const v = { ...all, now: only(all.now), soon: only(all.soon), fresh: only(all.fresh), paused: only(all.paused) };
  const rows = [...v.now, ...v.soon, ...v.fresh, ...v.paused];
  const away = hub.isAway();
  const list = scoped ?? all.lists[0];
  const addRef = useRef<AddRowHandle>(null);

  const openNew = () =>
    list
      ? openSheet((close) => <QuickAddSheet onClose={close} listId={list.id} />)
      : openSheet((close) => <NewProjectSheet onClose={close} initial={{ kind: 'chores' }} />);
  useAddAction(openNew, 'New chore');

  const toggleAway = () => {
    if (!away) {
      hub.setAway(true);
      toast(AWAY_ON);
      return;
    }
    const msg = welcomeBack(hub.settings()?.awaySince);
    hub.setAway(false);
    toast(msg);
  };
  const sub = away ? 'Away · clocks paused' : v.now.length ? `${v.now.length} ready` : rows.length ? 'All fresh' : undefined;
  // A finished chore stays a moment in its group (check, strike, fold), then shows up fresh.
  const settle = useSettle(choreId);
  const titles = new Set(rows.map((r) => r.item.title.toLowerCase()));
  const starters = rows.every((r) => STARTERS.includes(r.item.title)) ? STARTERS.filter((t) => !titles.has(t.toLowerCase())) : [];

  const choreRows = (shown: Array<{ row: ChoreRow; settling: boolean }>) => (
    <ul className="rows">
      {shown.map(({ row: r, settling }) => (
        <ChoreItem key={r.item.id} row={r} settling={settling} onHold={settle.hold} />
      ))}
    </ul>
  );
  const group = (title: string, rows: ChoreRow[]) => {
    const shown = settle.view(title, rows);
    return shown.length ? (
      <Section title={title} count={rows.length}>
        {choreRows(shown)}
      </Section>
    ) : null;
  };
  const paused = settle.view('Paused', v.paused);

  return (
    <>
      {scoped ? (
        <Band onBack={() => back({ name: 'lists' })} mini={scoped.name} actions={<ProjectActions listId={scoped.id} label="New chore" onNew={openNew} />}>
          <ProjectHero list={scoped} sub={`${sub ?? 'Empty'}${heroVis(hub, scoped)}`} />
        </Band>
      ) : (
        <Band top={<SyncBadge />} title="Chores" sub={sub} actions={<NewButton label="New chore" onClick={openNew} />} />
      )}
      <div className="column">
        {scoped ? <ProjectChips list={scoped} /> : null}
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

        {list ? (
          <div>
            <AddRow listId={list.id} handle={addRef} />
            {starters.length ? (
              <div className="tokens addrow__suggest">
                {starters.map((t) => (
                  <button key={t} type="button" className="token" onClick={() => addRef.current?.submit(t)}>
                    <Icon name="plus" />
                    {t}
                  </button>
                ))}
              </div>
            ) : null}
            {!away && rows.length ? (
              <button type="button" className="textbtn away" onClick={toggleAway}>
                <Icon name="plane" className="icon--sm" /> Going away? Pause chores
              </button>
            ) : null}
          </div>
        ) : (
          <Empty title="No chores project yet">
            <div className="tokens tokens--center">
              {PROJECT_TEMPLATES.filter((t) => t.kind === 'chores').map((t) => (
                <button key={t.key} type="button" className="token" onClick={() => createFromTemplate(hub, t)}>
                  <Icon name="plus" /> {t.name}
                </button>
              ))}
            </div>
          </Empty>
        )}

        {paused.length ? (
          <Disclosure title="Paused" count={v.paused.length}>
            {choreRows(paused)}
          </Disclosure>
        ) : null}
      </div>
    </>
  );
}

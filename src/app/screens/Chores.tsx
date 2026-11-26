import { createFromTemplate, PROJECT_TEMPLATES } from '../../core/actions';
import { humanDate, relativeAgo, sinceDate, today as todayStr } from '../../core/dates';
import { useAddAction } from '../addAction';
import { ruleShort } from '../components/editors';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { useHub } from '../context';
import { back, navigate } from '../router';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { useTick } from '../tick';
import { doerOf, requestState } from '../privacy';
import { Avatar, Band, Check, Disclosure, Empty, lineVars, NewButton, Section } from '../ui/primitives';
import { useFresh } from '../ui/fresh';
import { ReqTag, VisTag } from '../ui/tags';
import { useSettle } from '../ui/useSettle';
import { choresView, type ChoreRow } from '../views';
import { heroVis, ProjectActions, ProjectChips, ProjectHero } from './ListScreen';
import { NewProjectSheet } from './Lists';
import { SyncBadge } from '../components/SyncBadge';

/** One chore row; ticking it gives the "Laundry is fresh again. Next: …" toast (useTick). Also on Today (Chores ready). */
export function ChoreItem({ row, settling, onHold }: { row: ChoreRow; settling: boolean; onHold: (id: string) => void }) {
  const hub = useHub();
  const tick = useTick();
  const { item, list } = row;
  const ref = todayStr();
  const who = doerOf(hub, item);
  const req = requestState(hub, item);
  const fresh = useFresh(item.id);
  const meta = [
    item.repeat ? ruleShort(item.repeat) : 'Once',
    item.assignee === 'turns' && who ? (who.id === hub.meId ? 'your turn' : `${who.name}’s turn`) : null,
    item.due && item.due < ref
      ? sinceDate(item.due, ref)
      : item.lastDoneAt
        ? `${item.lastDoneBy === hub.meId ? 'you' : (hub.member(item.lastDoneBy)?.name ?? '')}, ${relativeAgo(item.lastDoneAt)}`
        : null,
  ].filter(Boolean);

  const done = () => {
    onHold(item.id);
    tick(item);
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
  const { openSheet } = useOverlays();
  const ref = todayStr();
  const all = choresView(hub, ref);
  // With one chores project, the Chores tab is that project, and looks like it.
  const scoped = listId ? hub.list(listId) : all.lists.length === 1 ? all.lists[0] : undefined;
  const only = (rows: ChoreRow[]) => (scoped ? rows.filter((r) => r.list.id === scoped.id) : rows);
  const v = {
    ...all,
    now: only(all.now),
    soon: only(all.soon),
    fresh: only(all.fresh),
    paused: only(all.paused),
  };
  const rows = [...v.now, ...v.soon, ...v.fresh, ...v.paused];
  const list = scoped ?? all.lists[0];
  const openNew = (text?: string) =>
    list
      ? openSheet((close) => <QuickAddSheet onClose={close} listId={list.id} text={text} />)
      : openSheet((close) => <NewProjectSheet onClose={close} initial={{ kind: 'chores' }} />);
  useAddAction(() => openNew(), 'New chore');

  const sub = v.now.length ? `${v.now.length} ready` : rows.length ? 'All fresh' : undefined;
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
        <Band
          onBack={listId ? () => back({ name: 'lists' }) : undefined}
          top={listId ? undefined : <SyncBadge />}
          mini={scoped.name}
          actions={<ProjectActions listId={scoped.id} label="New chore" onNew={() => openNew()} />}
        >
          <ProjectHero list={scoped} sub={`${sub ?? 'Empty'}${heroVis(hub, scoped)}`} />
        </Band>
      ) : (
        <Band top={<SyncBadge />} title="Chores" sub={sub} actions={<NewButton label="New chore" onClick={() => openNew()} />} />
      )}
      <div className="column">
        {scoped ? <ProjectChips list={scoped} /> : null}

        {group('Today', v.now)}
        {group('Soon', v.soon)}
        {group('Fresh', v.fresh)}

        {list ? (
          <div>
            {starters.length ? (
              <div className="tokens chores__starters">
                {starters.map((t) => (
                  <button key={t} type="button" className="token" onClick={() => openNew(t)}>
                    <Icon name="plus" />
                    {t}
                  </button>
                ))}
              </div>
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

import { useState } from 'react';
import { addDays, fromDateStr, humanDate, relativeAgo, today as todayStr } from '../../core/dates';
import type { LineColor } from '../../core/model';
import { useAddAction } from '../addAction';
import { ItemRow } from '../components/ItemRow';
import { PairSheet } from '../components/PairSheet';
import { QuickAdd } from '../components/QuickAdd';
import { useHub, usePartnerShopping, useSync } from '../context';
import { getPrefs } from '../prefs';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Avatar, Band, IconButton, lineVars, Section, Tag } from '../ui/primitives';
import { choresView, todayView } from '../views';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Morning';
  if (h < 18) return 'Hey';
  return 'Evening';
}

/** My avatar with a quiet sync dot; opens Settings. */
export function SyncBadge() {
  const hub = useHub();
  const { status } = useSync();
  const me = hub.me();
  const label =
    status === 'synced' ? 'Synced' : status === 'local' ? 'On this device only' : status === 'offline' ? 'Offline · saved on this device' : 'Syncing';
  return (
    <button type="button" className="me" onClick={() => navigate({ name: 'settings' })} aria-label={`Settings · ${label}`} title={label}>
      <Avatar member={me} size="md" />
      <span className={`syncdot syncdot--${status}`} />
    </button>
  );
}

/** Just the dot, for places that are already a button. */
export function SyncDot() {
  const { status } = useSync();
  return <span className={`syncdot syncdot--${status}`} style={{ marginLeft: 'auto' }} title={status} />;
}

function Strip({ color, num, label, onClick }: { color: LineColor; num: number; label: string; onClick?: () => void }) {
  return (
    <button type="button" className="strip" style={lineVars(color)} onClick={onClick} aria-label={`${num} ${label}`} disabled={!onClick}>
      <span className="strip__num num">{num}</span>
      <span className="strip__label">{label}</span>
    </button>
  );
}

export function Today() {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const ref = todayStr();
  const v = todayView(hub, ref);
  const chores = choresView(hub, ref);
  const me = hub.me();
  const partner = hub.partner();
  const shopping = usePartnerShopping();
  const [earlierOpen, setEarlierOpen] = useState(false);
  const due = v.today.length + v.earlier.length;
  const dueProjects = [...new Set([...v.today, ...v.earlier].map((i) => i.listId))].map((id) => hub.list(id)!).filter(Boolean).slice(0, 3);
  const taskLists = hub.lists().filter((l) => l.kind !== 'shopping');
  const last = getPrefs().lastList;
  const addTo = (last && taskLists.find((l) => l.id === last)) || taskLists.find((l) => l.kind === 'tasks') || taskLists[0];
  const shopper = shopping ? hub.member(shopping.member) : undefined;

  useAddAction(() => document.querySelector<HTMLInputElement>('.today-add input')?.focus());

  const strips = [
    v.shopping.count ? { color: 'lemon' as const, num: v.shopping.count, label: 'to buy', go: () => navigate({ name: 'shop' }) } : null,
    chores.now.length ? { color: 'pink' as const, num: chores.now.length, label: chores.now.length === 1 ? 'chore ready' : 'chores ready', go: () => navigate({ name: 'chores' }) } : null,
    v.together ? { color: 'lilac' as const, num: v.together, label: 'done together this week' } : null,
  ].filter(Boolean) as Array<{ color: LineColor; num: number; label: string; go?: () => void }>;

  return (
    <>
      <Band
        top={<SyncBadge />}
        actions={<IconButton icon="search" label="Search" onClick={() => navigate({ name: 'search' })} />}
        title={`${greeting()}, ${me?.name ?? 'you'}!`}
        mini={fromDateStr(ref).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
      />
      <div className="column">
        <div className="summary">
          <p className="summary__text">
            {due ? (
              <>
                You have {due} {due === 1 ? 'thing' : 'things'}
                <br />
                to tackle today
              </>
            ) : (
              <>
                Nothing due today.
                <br />
                Enjoy it.
              </>
            )}
          </p>
          {dueProjects.length ? (
            <span className="tags">
              {dueProjects.map((l) => (
                <Tag key={l.id} color={l.color}>
                  <span dir="auto">{l.name}</span>
                </Tag>
              ))}
            </span>
          ) : (
            <span className="summary__date">{fromDateStr(ref).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
          )}
        </div>

        {shopper ? (
          <button type="button" className="notice" onClick={() => navigate({ name: 'shop' })}>
            <Avatar member={shopper} size="sm" />
            <span className="notice__text">
              <strong>{shopper.name} is shopping now.</strong> Need anything? Add it and it lands on their list.
            </span>
            <Icon name="chevron-right" />
          </button>
        ) : null}

        <Section title="Today" id="today">
          {v.today.length ? (
            <ul className="rows">
              {v.today.map((i) => (
                <ItemRow key={i.id} item={i} showList />
              ))}
            </ul>
          ) : null}
          {addTo ? (
            <div className="today-add">
              <QuickAdd listId={addTo.id} defaultDue={ref} placeholder="Add something for today" allowListChange />
            </div>
          ) : null}
        </Section>

        {v.earlier.length ? (
          <Section
            title="From earlier"
            count={v.earlier.length}
            action={
              <button type="button" className="textbtn" onClick={() => setEarlierOpen(!earlierOpen)} aria-expanded={earlierOpen}>
                {earlierOpen ? 'Hide' : 'Show'}
              </button>
            }
          >
            {earlierOpen ? (
              <ul className="rows">
                {v.earlier.map((i) => (
                  <ItemRow
                    key={i.id}
                    item={i}
                    showList
                    trailing={
                      hub.canEdit(i) ? (
                        <span className="catchup" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="mini" onClick={() => (i.repeat ? hub.skip(i.id) : hub.snooze(i.id, ref))}>
                            {i.repeat ? 'Skip' : 'Today'}
                          </button>
                          {!i.repeat ? (
                            <button type="button" className="mini" onClick={() => hub.snooze(i.id, addDays(ref, 1))}>
                              Tomorrow
                            </button>
                          ) : null}
                        </span>
                      ) : null
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="hint">No rush. They wait here until you’re ready.</p>
            )}
          </Section>
        ) : null}

        {strips.length ? (
          <Section title="This week">
            <div className="stack">
              {strips.map((s) => (
                <Strip key={s.label} color={s.color} num={s.num} label={s.label} onClick={s.go} />
              ))}
            </div>
          </Section>
        ) : null}

        {v.upcoming.length ? (
          <Section title="Coming up" id="upcoming">
            {v.upcoming.map((g) => (
              <div key={g.date} className="day">
                <div className="day__head">{humanDate(g.date, ref)}</div>
                <ul className="rows">
                  {g.items.map((i) => (
                    <ItemRow key={i.id} item={i} showList dateMode="none" />
                  ))}
                </ul>
              </div>
            ))}
          </Section>
        ) : null}

        {v.recent.length && partner ? (
          <Section title={`${partner.name} did`}>
            <ul className="rows">
              {v.recent.map((r) => (
                <li key={r.log?.id ?? r.item.id} className="row">
                  <Avatar member={partner} size="sm" />
                  <div className="row__body">
                    <span className="row__title" dir="auto">
                      {r.item.title}
                    </span>
                    <span className="row__meta">
                      <span className="meta">{relativeAgo(r.at)}</span>
                    </span>
                  </div>
                  {r.log ? (
                    <button
                      type="button"
                      className={`heart ${r.log.thankedBy ? 'is-on' : ''}`}
                      onClick={() => hub.thank(r.log!.id)}
                      aria-label={`Thank ${partner.name}`}
                      aria-pressed={!!r.log.thankedBy}
                    >
                      <Icon name={r.log.thankedBy ? 'heart-fill' : 'heart'} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {!partner ? (
          <button type="button" className="invite" onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)}>
            <span className="invite__people" aria-hidden="true">
              <Avatar member={me} size="md" />
              <span className="invite__empty">
                <Icon name="plus" className="icon--sm" />
              </span>
            </span>
            <span className="invite__text">
              <strong>Bring your person in</strong>
              <span>Share a code and your projects sync, privately.</span>
            </span>
            <Icon name="chevron-right" />
          </button>
        ) : null}
      </div>
    </>
  );
}

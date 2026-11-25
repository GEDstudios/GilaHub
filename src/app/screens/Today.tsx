import { useState } from 'react';
import { addDays, fromDateStr, humanDate, relativeAgo, today as todayStr } from '../../core/dates';
import type { LineColor } from '../../core/model';
import { useAddAction } from '../addAction';
import { ItemRow } from '../components/ItemRow';
import { PairSheet } from '../components/PairSheet';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { useHub, usePartnerShopping, useSync } from '../context';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Band, lineVars, PersonBullet, Section, Tag } from '../ui/primitives';
import { choresView, todayView } from '../views';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Morning';
  if (h < 18) return 'Hey';
  return 'Evening';
}

/** My avatar with the sync state; opens Settings. */
export function SyncBadge() {
  const hub = useHub();
  const { status } = useSync();
  const me = hub.me();
  const label =
    status === 'synced' ? 'Synced' : status === 'local' ? 'On this device only' : status === 'offline' ? 'Offline · saved on this device' : 'Syncing';
  return (
    <button type="button" className="band__people" onClick={() => navigate({ name: 'settings' })} aria-label={`Settings · ${label}`} title={label}>
      <PersonBullet member={me} size="lg" />
      <span className={`syncdot syncdot--${status}`} />
    </button>
  );
}

function Strip({ color, num, label, onClick }: { color: LineColor; num: number; label: string; onClick?: () => void }) {
  return (
    <button type="button" className="strip" style={lineVars(color)} onClick={onClick} aria-label={`${num} ${label}`}>
      <span className="strip__num">{num}</span>
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
  const [showAll, setShowAll] = useState(false);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const shown = showAll ? v.today : v.today.slice(0, 5);
  const due = v.today.length + v.earlier.length;
  const dueProjects = [...new Set([...v.today, ...v.earlier].map((i) => i.listId))].map((id) => hub.list(id)).filter(Boolean).slice(0, 3);
  const upcomingCount = v.upcoming.reduce((n, g) => n + g.items.length, 0);

  useAddAction(() => openSheet((close) => <QuickAddSheet onClose={close} defaultDue={ref} />));

  return (
    <>
      <Band
        top={<SyncBadge />}
        actions={
          <button type="button" className="iconbtn" onClick={() => navigate({ name: 'search' })} aria-label="Search">
            <Icon name="search" />
          </button>
        }
        title={`${greeting()}, ${me?.name ?? 'you'}!`}
        sub={fromDateStr(ref).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
      />
      <div className="column">
        <div className="hero">
          <p className="hero__text">
            {due
              ? `You have ${due} ${due === 1 ? 'thing' : 'things'} to tackle today`
              : 'Nothing to tackle today. Enjoy it.'}
          </p>
          {dueProjects.length ? (
            <span className="tags">
              {dueProjects.map((l) => (
                <Tag key={l!.id} color={l!.color}>
                  <span dir="auto">{l!.name}</span>
                </Tag>
              ))}
            </span>
          ) : null}
        </div>

        {shopping && hub.member(shopping.member) ? (
          <button type="button" className="banner" style={lineVars(hub.member(shopping.member)!.color)} onClick={() => navigate({ name: 'shop' })}>
            <span className="live" />
            <span className="banner__text">
              {hub.member(shopping.member)!.name} is shopping now
              <span className="banner__sub">Need anything? Add it and it lands on their list.</span>
            </span>
            <Icon name="arrow" />
          </button>
        ) : null}

        {!partner ? (
          <button type="button" className="banner" style={lineVars('lilac')} onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)}>
            <span className="banner__text">
              Bring your person in
              <span className="banner__sub">Share a code and your projects sync, privately.</span>
            </span>
            <Icon name="arrow" />
          </button>
        ) : null}

        <div className="stack">
          {hub.shoppingLists().length ? <Strip color="lemon" num={v.shopping.count} label="To buy" onClick={() => navigate({ name: 'shop' })} /> : null}
          {chores.lists.length ? <Strip color="pink" num={chores.now.length} label="Chores ready" onClick={() => navigate({ name: 'chores' })} /> : null}
          <Strip color="lilac" num={v.together} label="Done together this week" />
          <Strip color="sky" num={upcomingCount} label="Coming up this week" onClick={() => document.getElementById('upcoming')?.scrollIntoView({ behavior: 'smooth' })} />
        </div>

        {v.today.length ? (
          <Section title="Today" count={v.today.length}>
            <ul className="rows">
              {shown.map((i) => (
                <ItemRow key={i.id} item={i} showList />
              ))}
            </ul>
            {v.today.length > 5 && !showAll ? (
              <button type="button" className="hint linkbtn" onClick={() => setShowAll(true)} style={{ marginLeft: 'var(--gutter)' }}>
                {v.today.length - 5} more if you’re up for it
              </button>
            ) : null}
          </Section>
        ) : null}

        {v.earlier.length ? (
          <Section
            title="From earlier"
            count={v.earlier.length}
            action={
              <button type="button" className="section__action" onClick={() => setEarlierOpen(!earlierOpen)} aria-expanded={earlierOpen}>
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
                          <button type="button" className="chip" onClick={() => (i.repeat ? hub.skip(i.id) : hub.snooze(i.id, ref))}>
                            {i.repeat ? 'Skip' : 'Today'}
                          </button>
                          {!i.repeat ? (
                            <button type="button" className="chip" onClick={() => hub.snooze(i.id, addDays(ref, 1))}>
                              Tmrw
                            </button>
                          ) : null}
                        </span>
                      ) : null
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="hint">No rush. They’ll wait here until you’re ready.</p>
            )}
          </Section>
        ) : null}

        {v.upcoming.length ? (
          <section className="section" id="upcoming">
            <div className="section__head">
              <h2 className="section__title">
                Coming up <span className="section__count">{upcomingCount}</span>
              </h2>
            </div>
            {v.upcoming.map((g) => (
              <div key={g.date}>
                <div className="dayhead">{humanDate(g.date, ref)}</div>
                <ul className="rows">
                  {g.items.map((i) => (
                    <ItemRow key={i.id} item={i} showList dateMode="none" />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ) : null}

        {v.recent.length && partner ? (
          <Section title={`${partner.name} did`}>
            <ul className="rows">
              {v.recent.map((r) => (
                <li key={r.log?.id ?? r.item.id} className="row">
                  <PersonBullet member={partner} size="md" />
                  <div className="row__body">
                    <span className="row__title" dir="auto">
                      {r.item.title}
                    </span>
                    <span className="row__meta">{relativeAgo(r.at)}</span>
                  </div>
                  {r.log ? (
                    <button
                      type="button"
                      className={`iconbtn heart ${r.log.thankedBy ? 'is-on' : ''}`}
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
      </div>
    </>
  );
}

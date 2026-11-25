import { useState } from 'react';
import { addDays, fromDateStr, humanDate, relativeAgo, today as todayStr } from '../../core/dates';
import { ItemRow } from '../components/ItemRow';
import { PairSheet } from '../components/PairSheet';
import { QuickAddSheet } from '../components/QuickAddSheet';
import { useHub, usePartnerShopping, useSync } from '../context';
import { navigate } from '../router';
import { Icon } from '../ui/Icon';
import { useOverlays } from '../ui/overlays';
import { Band, Bullet, Empty, ListBullet, Logo, PersonBullet, Section } from '../ui/primitives';
import { todayView } from '../views';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function SyncBadge() {
  const hub = useHub();
  const { status } = useSync();
  const members = hub.members();
  const label =
    status === 'synced' ? 'Synced' : status === 'local' ? 'On this device only' : status === 'offline' ? 'Offline · saved on this device' : 'Syncing';
  return (
    <button type="button" className="band__people" onClick={() => navigate({ name: 'settings' })} aria-label={`Settings · ${label}`} title={label}>
      <span className="bullets">
        {members.map((m) => (
          <PersonBullet key={m.id} member={m} size="md" />
        ))}
      </span>
      <span className={`syncdot syncdot--${status}`} />
    </button>
  );
}

export function Today() {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const ref = todayStr();
  const v = todayView(hub, ref);
  const me = hub.me();
  const partner = hub.partner();
  const shopping = usePartnerShopping();
  const [showAll, setShowAll] = useState(false);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const date = fromDateStr(ref);
  const shown = showAll ? v.today : v.today.slice(0, 5);
  const nothing = !v.today.length && !v.earlier.length;

  return (
    <>
      <Band
        title="Today"
        sub={`${greeting()}${me ? `, ${me.name}` : ''} · ${date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`}
        actions={
          <>
            <button type="button" className="iconbtn" onClick={() => navigate({ name: 'search' })} aria-label="Search">
              <Icon name="search" />
            </button>
            <SyncBadge />
          </>
        }
      />
      <div className="column">
        {shopping && hub.member(shopping.member) ? (
          <button type="button" className="banner" style={{ ['--c' as string]: `var(--${hub.member(shopping.member)!.color})` }} onClick={() => navigate({ name: 'shop' })}>
            <span className="live" />
            <span className="banner__text">
              {hub.member(shopping.member)!.name} is shopping now
              <span className="banner__sub">Need anything? Add it and it lands on their list.</span>
            </span>
            <Icon name="arrow" />
          </button>
        ) : null}

        {!partner ? (
          <button type="button" className="banner" onClick={() => openSheet((close) => <PairSheet kind="partner" onClose={close} />)}>
            <span className="bullets bullets--paper">
              {me ? <PersonBullet member={me} size="md" /> : null}
              <Bullet color="pebble" label="+" size="md" />
            </span>
            <span className="banner__text">
              Bring your person in
              <span className="banner__sub">Share a code — your lists sync, privately.</span>
            </span>
            <Icon name="arrow" />
          </button>
        ) : null}

        <button type="button" className="panel" onClick={() => navigate({ name: 'shop' })} aria-label={`Shopping, ${v.shopping.count} to buy`}>
          <div className="panel__main">
            <div className="panel__label">Shopping</div>
            <div className="panel__big">
              <span className="panel__num">{v.shopping.count}</span>
              <span className="panel__unit">{v.shopping.count === 1 ? 'thing to buy' : 'things to buy'}</span>
            </div>
            <div className="panel__hint" dir="auto">
              {v.shopping.count ? v.shopping.names.join(' · ') : 'All stocked up.'}
            </div>
          </div>
          <span className="bullets">
            {v.shopping.lists.map((l) => (
              <ListBullet key={l.id} list={l} size="sm" />
            ))}
          </span>
          <span className="panel__go">
            <Icon name="arrow" />
          </span>
        </button>

        {nothing ? (
          <Empty mark={<Logo size="xl" />} title="All clear. Enjoy today." text="Nothing is due. Add something with the + if it’s on your mind." />
        ) : null}

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
                          <button type="button" className="chip chip--outline" onClick={() => (i.repeat ? hub.skip(i.id) : hub.snooze(i.id, ref))}>
                            {i.repeat ? 'Skip' : 'Today'}
                          </button>
                          {!i.repeat ? (
                            <button type="button" className="chip chip--outline" onClick={() => hub.snooze(i.id, addDays(ref, 1))}>
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
          <Section title="Coming up" count={v.upcoming.reduce((n, g) => n + g.items.length, 0)}>
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
          </Section>
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

        {v.together > 0 ? (
          <div className="together">
            <span className="together__num">{v.together}</span>
            <span className="together__text">
              things done together this week.
              <br />
              Shopping, chores, plans — all of it counts.
            </span>
          </div>
        ) : null}
      </div>
      <button type="button" className="fab" aria-label="Add" onClick={() => openSheet((close) => <QuickAddSheet onClose={close} defaultDue={ref} />)}>
        <Icon name="plus" className="icon--lg" />
      </button>
    </>
  );
}

import { useIdeasBadge, useOpenIdeas } from './Ideas';
import { openSearch } from '../search';
import { useHub } from '../context';
import { usePrefs } from '../usePrefs';
import { navigate, useRoute } from '../router';
import { SyncDot } from './SyncBadge';
import { Icon } from '../ui/Icon';
import { useBarEdit } from '../barEdit';
import { Avatar, lineVars, Logo } from '../ui/primitives';
import { ProjectMark } from '../ui/ProjectMark';
import { activeTabKey, pinsOf, tabsOf } from '../tabs';
import { projectCount, todayRef, todayView } from '../views';
import { listIdOf } from '../../core/keys';
import { G } from '../ui/glyphs';

/**
 * A computer's top bar: the phone's tab bar, moved up and laid out flat. The brand; the tabs
 * (Today, your pins, Projects) in the middle; search, ideas and the two of us on the right.
 * Adding (the black +) and a note for my person float bottom right, as they do on the phone.
 */
export function TopNav() {
  const route = useRoute();
  const hub = useHub();
  const openIdeas = useOpenIdeas();
  const ideas = useIdeasBadge();
  const prefs = usePrefs();
  const on = activeTabKey(hub, route);
  const v = todayView(hub, todayRef());
  // Today's due, and each pinned project's open things (with what's inside it).
  const counts: Record<string, number> = { today: v.dueCount };
  for (const k of pinsOf(hub)) {
    const l = hub.list(listIdOf(k));
    if (l) counts[k] = projectCount(hub, l).n;
  }
  const tabs = tabsOf(hub).filter((t) => t.key !== 'search');
  // A folder held over this bar: where it would land.
  const { aim } = useBarEdit();
  const me = hub.me();
  const partner = hub.partner();
  return (
    <header className="topnav">
      <div className="topnav__in">
        <button type="button" className="topnav__brand" onClick={() => navigate('/')} aria-label="Today">
          <Logo size={24} />
        </button>
        {/* Also where a folder dragged up lands, pinned (barEdit: [data-key], ends are anchors). */}
        <nav className={`topnav__tabs ${aim ? 'is-receiving' : ''} ${aim?.refusing ? 'is-refusing' : ''}`} aria-label="Places">
          {tabs.map((t, i) => {
            const anchor = t.key === 'today' || t.key === 'projects';
            const pinAt = tabs.slice(0, i).filter((x) => x.key !== 'today' && x.key !== 'projects').length;
            return (
            <button
              key={t.key}
              type="button"
              className={`topnav__tab ${on === t.key ? 'is-on' : ''} ${anchor ? 'is-anchor' : ''} ${aim && !aim.refusing && aim.at !== null && !anchor && aim.at === pinAt ? 'is-before' : ''} ${aim && !aim.refusing && aim.at !== null && t.key === 'projects' && aim.at >= tabs.length - 2 ? 'is-before' : ''}`}
              aria-current={on === t.key ? 'page' : undefined}
              onClick={() => navigate(t.path)}
              data-drop-list={listIdOf(t.key) ?? undefined}
              data-tab={t.key}
              data-key={t.key}
            >
              {t.icon ? <Icon name={t.icon} /> : <ProjectMark color={t.color} icon={t.glyph} size="sm" />}
              <span dir="auto">{t.label}</span>
              {counts[t.key] ? <span className="topnav__count num">{counts[t.key]}</span> : null}
            </button>
            );
          })}
        </nav>
        <div className="topnav__end">
          <button type="button" className="topnav__search" onClick={() => openSearch()} aria-label="Search" aria-keyshortcuts="/">
            <Icon name={G.search} className="icon--sm" />
            <span>Search</span>
            <span className="kbd">/</span>
          </button>
          {prefs.ideasTag ? (
            <button type="button" className="topnav__icon" onClick={openIdeas} aria-label={`Ideas${ideas.n ? `, ${ideas.n} open` : ''}`} title="Ideas for Gila Hub">
              <Icon name={G.idea} />
              {ideas.fresh && ideas.partner ? <span className="topnav__dot" style={lineVars(ideas.partner.color)} /> : ideas.n ? <span className="topnav__n num">{ideas.n}</span> : null}
            </button>
          ) : null}
          <button type="button" className={`topnav__us ${route.name === 'settings' ? 'is-on' : ''}`} onClick={() => navigate({ name: 'settings' })} aria-label="Settings" title="Settings">
            <span className="topnav__faces">
              <Avatar member={me} size="sm" />
              {partner ? <Avatar member={partner} size="sm" /> : null}
            </span>
            <SyncDot />
          </button>
        </div>
      </div>
    </header>
  );
}

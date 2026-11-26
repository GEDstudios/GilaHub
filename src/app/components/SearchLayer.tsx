import { useEffect, useRef, useState } from 'react';
import { fold } from '../../smart/normalize';
import { hasFilters, parseSearch, runQuery } from '../query';
import { useHub } from '../context';
import { navigate, useRoute } from '../router';
import { clearRecentSearches, closeSearch, recentSearches, rememberSearch, searchEverywhere, useSearchOpen, useSearchScope } from '../search';
import { Icon } from '../ui/Icon';
import { lockScroll, useOverlays } from '../ui/overlays';
import { QuickAddSheet } from './QuickAddSheet';
import { NewProjectSheet } from '../screens/Lists';
import { ListBullet } from '../ui/primitives';
import { ItemRow } from './ItemRow';

/**
 * Search in place: a field drops into the top of the screen and the results float over the
 * page you were on (still there, softly veiled). A tap on a result goes there; Close, Esc, a
 * tap on the veil or any navigation puts it away.
 */
export function SearchLayer() {
  const open = useSearchOpen();
  if (!open) return null;
  return <Layer />;
}

function Layer() {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const route = useRoute();
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState(recentSearches);
  const input = useRef<HTMLInputElement>(null);
  const first = useRef(route);

  // Any navigation (a result, Back, a tab) closes it.
  useEffect(() => {
    if (route !== first.current && JSON.stringify(route) !== JSON.stringify(first.current)) closeSearch();
  }, [route]);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    const unlock = lockScroll();
    document.documentElement.classList.add('is-searching');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unlock();
      document.documentElement.classList.remove('is-searching');
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const scope = hub.list(useSearchScope());
  const term = q.trim();
  // "#work urgent this week report": tags, urgency and days are filters; the rest, words.
  const parsed = term ? parseSearch(hub, term) : null;
  const filtered = !!parsed && hasFilters(parsed.query);
  const items = !term
    ? []
    : filtered
      ? runQuery(hub, { ...parsed!.query, listId: scope?.id ?? parsed!.query.listId }).slice(0, 60)
      : hub.search(term, scope ? 200 : 30).filter((i) => !scope || i.listId === scope.id || hub.listPath(i.listId).some((l) => l.id === scope.id)).slice(0, 30);
  const lists = term && !scope && !filtered ? hub.lists().filter((l) => fold(l.name).includes(fold(term))) : [];
  // Ways to narrow, a tap away: urgent, the days, whose, and our tags (the ones used last first).
  const add = (word: string) => {
    setQ((x) => `${x.trim()} ${word}`.trim() + ' ');
    input.current?.focus();
  };
  const drop = (token: string) => setQ((x) => x.replace(token, '').replace(/\s+/g, ' ').trimStart());
  const tagIdeas = [...new Set([...hub.recentTags(), ...hub.tags().map((t) => t.id)])].map((id) => hub.tag(id)).filter((t): t is NonNullable<typeof t> => !!t).slice(0, 8);
  const ideas = ['urgent', 'today', 'overdue', 'this week', 'next week', ...(hub.partner() ? ['mine', 'ours'] : [])];
  const keep = () => rememberSearch(term);

  return (
    <div className="searchlayer" role="dialog" aria-modal="true" aria-label="Search">
      <button type="button" className="searchlayer__veil" aria-label="Close search" tabIndex={-1} onClick={closeSearch} />
      <div className="searchlayer__top">
        <div className="searchlayer__field column">
          <label className="searchlayer__box">
            <Icon name="search" className="icon--sm" />
            <input
              ref={input}
              value={q}
              dir="auto"
              onChange={(e) => setQ(e.target.value)}
              placeholder={scope ? `Search ${scope.name}` : 'Search, or #tag, urgent, this week…'}
              aria-label="Search"
              enterKeyHint="search"
              autoComplete="off"
            />
            {q ? (
              <button type="button" className="searchlayer__clear" onClick={() => setQ('')} aria-label="Clear">
                <Icon name="x" className="icon--xs" />
              </button>
            ) : null}
          </label>
          <button type="button" className="textbtn searchlayer__close" onClick={closeSearch}>
            Close
          </button>
        </div>
      </div>

      <div className="searchlayer__body column">
        {scope ? (
          <div className="tokens searchlayer__scope">
            <button type="button" className="token is-on" onClick={searchEverywhere} aria-label={`Only in ${scope.name}. Tap to search everything`}>
              <ListBullet list={scope} size="xs" />
              <span dir="auto">In {scope.name}</span>
              <Icon name="x" className="token__x" />
            </button>
          </div>
        ) : null}
        {parsed?.parts.length ? (
          <div className="tokens searchlayer__parts" aria-label="Filters">
            {parsed.parts.map((pt) => (
              <button key={pt.token} type="button" className="token is-on" onClick={() => drop(pt.token)} aria-label={`Remove ${pt.label}`}>
                {pt.kind === 'tag' ? <Icon name="tag" /> : <Icon name="funnel" />}
                <span dir="auto">{pt.label}</span>
                <Icon name="x" className="token__x" />
              </button>
            ))}
          </div>
        ) : null}
        {!term ? (
          <div className="searchlayer__card searchlayer__ideas">
            <p className="searchlayer__label">Narrow it down</p>
            <div className="tokens">
              {ideas.map((w) => (
                <button key={w} type="button" className="token" onClick={() => add(w)}>
                  <Icon name={w === 'urgent' ? 'urgent' : w === 'mine' ? 'mine' : w === 'ours' ? 'ours' : 'calendar'} />
                  <span>{w[0].toUpperCase() + w.slice(1)}</span>
                </button>
              ))}
              {tagIdeas.map((t) => (
                <button key={t.id} type="button" className="token" onClick={() => add(`#${t.name.replace(/\s+/g, '')}`)}>
                  <Icon name="tag" />
                  <span dir="auto">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {!term && recent.length ? (
          <div className="searchlayer__card searchlayer__recent">
            <div className="tokens">
              {recent.map((r) => (
                <button key={r} type="button" className="token" onClick={() => setQ(r)}>
                  <Icon name="clock" />
                  <span dir="auto">{r}</span>
                </button>
              ))}
              <button
                type="button"
                className="textbtn searchlayer__forget"
                onClick={() => {
                  clearRecentSearches();
                  setRecent([]);
                }}
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}

        {term ? (
          <div className="searchlayer__card" onClickCapture={keep}>
            {lists.length ? (
              <ul className="rows">
                {lists.map((l) => (
                  <li key={l.id} className="row row--tap" onClick={() => navigate({ name: 'list', id: l.id })}>
                    <ListBullet list={l} size="md" />
                    <div className="row__body">
                      <span className="row__title" dir="auto">
                        {l.name}
                      </span>
                      <span className="row__meta">
                        <span className="meta">Folder</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {items.length ? (
              <ul className="rows">
                {items.map((i) => (
                  <ItemRow key={i.id} item={i} showList />
                ))}
              </ul>
            ) : null}
            {filtered && !items.length ? (
              <div className="searchlayer__none">
                <p>Nothing open matches that</p>
              </div>
            ) : null}
            {!filtered && !items.length && !lists.length ? (
              // Nothing by that name: make it, a task (here, when searching in a folder) or a folder.
              <div className="searchlayer__none">
                <p>Nothing matches “{term}”</p>
                <div className="searchlayer__make">
                  <button
                    type="button"
                    className="token"
                    onClick={() => {
                      closeSearch();
                      // Where the + would add it: this folder (and the ones inside), a task's
                      // subtasks on its page, else where new things from Today go.
                      const it = route.name === 'item' ? hub.item(route.id) : undefined;
                      const here = scope?.id ?? (route.name === 'list' ? route.id : it?.listId);
                      const inside = !!here && !it && hub.nestedLists(here).length > 0;
                      openSheet((close) => <QuickAddSheet onClose={close} text={term} listId={here} parentId={it?.id} route={inside} />);
                    }}
                  >
                    <Icon name="plus" />
                    <span dir="auto">Create “{term}” task?</span>
                  </button>
                  {scope ? null : (
                    <button
                      type="button"
                      className="token"
                      onClick={() => {
                        closeSearch();
                        openSheet((close) => <NewProjectSheet onClose={close} name={term} />);
                      }}
                    >
                      <Icon name="folder" />
                      <span dir="auto">Create “{term}” folder?</span>
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

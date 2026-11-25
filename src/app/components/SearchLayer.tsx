import { useEffect, useRef, useState } from 'react';
import { fold } from '../../smart/normalize';
import { useHub } from '../context';
import { navigate, useRoute } from '../router';
import { clearRecentSearches, closeSearch, recentSearches, rememberSearch, searchEverywhere, useSearchOpen, useSearchScope } from '../search';
import { Icon } from '../ui/Icon';
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
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.classList.add('is-searching');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSearch();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.style.overflow = prev;
      document.documentElement.classList.remove('is-searching');
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const scope = hub.list(useSearchScope());
  const term = q.trim();
  const items = term ? hub.search(term, scope ? 200 : 30).filter((i) => !scope || i.listId === scope.id).slice(0, 30) : [];
  const lists = term && !scope ? hub.lists().filter((l) => fold(l.name).includes(fold(term))) : [];
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
              placeholder={scope ? `Search ${scope.name}` : 'Search everything'}
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
                        <span className="meta">Project</span>
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
            {!items.length && !lists.length ? <p className="searchlayer__none">Nothing matches “{term}”</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

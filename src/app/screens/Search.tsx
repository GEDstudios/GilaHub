import { useState } from 'react';
import { ItemRow } from '../components/ItemRow';
import { useHub } from '../context';
import { back, navigate } from '../router';
import { Icon } from '../ui/Icon';
import { Band, Empty, ListBullet } from '../ui/primitives';
import { fold } from '../../smart/normalize';

export function Search() {
  const hub = useHub();
  const [q, setQ] = useState('');
  const results = hub.search(q);
  const lists = q.trim() ? hub.lists().filter((l) => fold(l.name).includes(fold(q))) : [];
  return (
    <>
      <Band title="Search" onBack={() => back({ name: 'today' })} />
      <div className="column">
        <div className="searchbar">
          <Icon name="search" className="icon--sm" />
          <input autoFocus value={q} dir="auto" onChange={(e) => setQ(e.target.value)} placeholder="Everything you can see…" aria-label="Search" enterKeyHint="search" />
          {q ? (
            <button type="button" className="searchbar__clear" onClick={() => setQ('')} aria-label="Clear">
              <Icon name="x" className="icon--sm" />
            </button>
          ) : null}
        </div>
        {lists.length ? (
          <ul className="rows" style={{ marginTop: 16 }}>
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
        <ul className="rows" style={{ marginTop: 16 }}>
          {results.map((i) => (
            <ItemRow key={i.id} item={i} showList />
          ))}
        </ul>
        {q.trim() && !results.length && !lists.length ? <Empty title="Nothing matches" text="Search looks through every project you can see, in Hebrew and English." /> : null}
      </div>
    </>
  );
}

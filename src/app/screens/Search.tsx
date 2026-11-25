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
        <div className="addbar">
          <Icon name="search" className="icon--sm" style={{ color: 'var(--ink-3)' }} />
          <input autoFocus value={q} dir="auto" onChange={(e) => setQ(e.target.value)} placeholder="Everything you can see…" aria-label="Search" enterKeyHint="search" />
          {q ? (
            <button type="button" className="iconbtn" onClick={() => setQ('')} aria-label="Clear">
              <Icon name="x" className="icon--sm" />
            </button>
          ) : null}
        </div>
        {lists.length ? (
          <ul className="rows" style={{ marginTop: 12 }}>
            {lists.map((l) => (
              <li key={l.id} className="row row--tap" onClick={() => navigate(l.kind === 'shopping' ? '/shop' : { name: 'list', id: l.id })}>
                <ListBullet list={l} size="lg" />
                <div className="row__body">
                  <span className="row__title" dir="auto">
                    {l.name}
                  </span>
                  <span className="row__meta">List</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <ul className="rows" style={{ marginTop: 12 }}>
          {results.map((i) => (
            <ItemRow key={i.id} item={i} showList />
          ))}
        </ul>
        {q.trim() && !results.length && !lists.length ? <Empty title="Nothing matches" text="Search looks through every list you can see — Hebrew and English." /> : null}
      </div>
    </>
  );
}

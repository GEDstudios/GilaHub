import type { Item } from '../../core/model';
import { useHub } from '../context';
import { useLater } from '../tick';
import { Section } from '../ui/primitives';
import type { Settle } from '../ui/useSettle';
import type { TodayView } from '../views';
import { ItemRow } from './ItemRow';

// ---------------------------------------------------------------- today

/**
 * Today: what's late first, said plainly, each with its quick way out (Today, Tomorrow or Skip),
 * then today's, in time order. Nothing at all: no block (the day card says it).
 */
export function TodayBlock({ v, day, settle }: { v: TodayView; day: string; settle: Settle<Item> }) {
  const hub = useHub();
  const later = useLater();
  const late = settle.view('earlier', v.earlier);
  const rows = settle.view('today', v.today);
  if (!late.length && !rows.length) return null;
  return (
    <Section title="Today" count={v.today.length + v.earlier.length} id="today">
      {late.length ? (
        <>
          <p className="daylabel daylabel--late">From earlier</p>
          <ul className="rows">
            {late.map(({ row: i, settling }) => (
              <ItemRow
                key={i.id}
                item={i}
                showList
                settling={settling}
                below={
                  hub.canEdit(i) ? (
                    <span className="catchup row__acts" onClick={(e) => e.stopPropagation()}>
                      {!i.repeat ? (
                        <button type="button" className="mini" onClick={() => hub.snooze(i.id, day)}>
                          Today
                        </button>
                      ) : null}
                      <button type="button" className="mini" onClick={() => later.run(i)}>
                        {later.label(i)}
                      </button>
                    </span>
                  ) : null
                }
              />
            ))}
          </ul>
        </>
      ) : null}
      {rows.length ? (
        <>
          {late.length ? <p className="daylabel">Today</p> : null}
          <ul className="rows">
            {rows.map(({ row: i, settling }) => (
              <ItemRow key={i.id} item={i} showList settling={settling} />
            ))}
          </ul>
        </>
      ) : null}
    </Section>
  );
}

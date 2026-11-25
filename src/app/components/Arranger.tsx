import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { replay } from '../ui/flip';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Sortable, useSortableItem } from '../ui/Sortable';

/**
 * The arranger: one pattern for every "what goes where, in what order" editor (DECISIONS #7).
 * Edit Today (HomeEditor) and the bottom bar (BarEditor) both use it.
 *
 *   [locked anchor rows]              e.g. Summary "Always first", or Today / Projects in the bar
 *   [mark][title + live sub][×][grip] sortable rows (Sortable with grips; long-press the body on touch)
 *   Add to …  ([mark] token +)        a tray of tokens to bring things back; one may open a panel
 *   Back to the default               quiet, only when something changed
 *
 * It saves nothing itself: onMove gets the new order on drop, onHide the key after the row
 * folds away (onLeave as it starts to), and tokens run their own onClick. Rows that appear get
 * a lemon flash and scroll into view; tokens that appear pop in. A locked row shakes when
 * tapped. Every row and anchor carries data-slot={key}, so a preview elsewhere can find it.
 */

export interface ArrangerAnchor {
  key: string;
  mark: ReactNode;
  title: string;
  sub?: ReactNode;
}

export interface ArrangerRow {
  key: string;
  mark: ReactNode;
  title: string;
  /** One line under the title: a live preview, or why it's empty right now. */
  sub?: ReactNode;
}

export interface ArrangerToken {
  key: string;
  label: string;
  mark?: ReactNode;
  onClick: () => void;
  /** Opens a panel instead of adding (aria-expanded, drawn black while open). */
  toggle?: boolean;
  open?: boolean;
  disabled?: boolean;
  title?: string;
}

const OUT_MS = 200;
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function SlotBody({ mark, title, sub }: { mark: ReactNode; title: string; sub?: ReactNode }) {
  return (
    <>
      <span className="slot__mark" aria-hidden="true">
        {mark}
      </span>
      <span className="slot__text">
        <span className="slot__title" dir="auto">
          {title}
        </span>
        {sub ? (
          <span className="slot__sub" dir="auto">
            {sub}
          </span>
        ) : null}
      </span>
    </>
  );
}

function SlotRow({
  row,
  index,
  leaving,
  fresh,
  onHide,
  hideLabel,
  moveLabel,
}: {
  row: ArrangerRow;
  index: number;
  leaving: boolean;
  fresh: boolean;
  onHide: (key: string) => void;
  hideLabel: string;
  moveLabel: string;
}) {
  const s = useSortableItem(row.key, { disabled: leaving });
  return (
    <li
      ref={s.ref}
      style={{ ...s.style, '--i': index } as CSSProperties}
      className={`slot ${s.className} ${leaving ? 'is-leaving' : ''} ${fresh ? 'is-fresh' : ''}`}
      data-slot={row.key}
      {...s.props}
    >
      <SlotBody mark={row.mark} title={row.title} sub={row.sub} />
      <button type="button" className="slot__btn" aria-label={hideLabel} title={hideLabel} onClick={() => onHide(row.key)}>
        <Icon name="x" />
      </button>
      <button type="button" data-grip ref={s.gripRef} {...s.gripProps} className="slot__btn slot__grip" aria-label={moveLabel}>
        <Icon name="grip" />
      </button>
    </li>
  );
}

export function Arranger({
  top = [],
  bottom = [],
  rows,
  onMove,
  onHide,
  hideLabel = (r) => `Hide ${r.title}`,
  moveLabel = (r) => `Move ${r.title}`,
  trayTitle,
  tokens,
  trayEmpty,
  panel,
  reset,
  onPreview,
  onLift,
  onLeave,
}: {
  /** Locked rows before and after the ones that move. */
  top?: ArrangerAnchor[];
  bottom?: ArrangerAnchor[];
  rows: ArrangerRow[];
  onMove: (keys: string[], key: string) => void;
  onHide: (key: string) => void;
  hideLabel?: (row: ArrangerRow) => string;
  moveLabel?: (row: ArrangerRow) => string;
  trayTitle: string;
  tokens: ArrangerToken[];
  /** Said under the tray title when there is nothing left to add (no tray when not given). */
  trayEmpty?: ReactNode;
  /** Under the tokens: the panel an open toggle token reveals. */
  panel?: ReactNode;
  /** "Back to the default": shown only when given. */
  reset?: { label: string; run: () => void };
  /** The order as it would drop, while dragging (a live preview elsewhere). */
  onPreview?: (keys: string[] | null) => void;
  /** A row was picked up. */
  onLift?: (key: string) => void;
  /** A row starts folding away (onHide follows when it's gone). */
  onLeave?: (key: string) => void;
}) {
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const [going, setGoing] = useState<string | null>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => {
    if (!ms) return fn();
    timers.current.push(setTimeout(fn, ms));
  };

  // What just appeared: rows flash and come into view, tokens pop in. Nothing on first draw.
  const rowKeys = rows.map((r) => r.key);
  const tokenKeys = tokens.map((t) => t.key);
  const seen = useRef<{ rows: Set<string>; tokens: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<{ rows: Set<string>; tokens: Set<string> }>(() => ({ rows: new Set(), tokens: new Set() }));
  const list = useRef<HTMLUListElement>(null);
  const rowSig = rowKeys.join('|');
  const tokenSig = tokenKeys.join('|');
  useLayoutEffect(() => {
    const prev = seen.current;
    seen.current = { rows: new Set(rowKeys), tokens: new Set(tokenKeys) };
    if (!prev) return;
    const newRows = rowKeys.filter((k) => !prev.rows.has(k));
    const newTokens = tokenKeys.filter((k) => !prev.tokens.has(k));
    if (!newRows.length && !newTokens.length) return;
    setFresh({ rows: new Set(newRows), tokens: new Set(newTokens) });
    if (newRows.length) {
      const el = list.current?.querySelector(`[data-slot="${CSS.escape(newRows[0])}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
    }
    const t = setTimeout(() => setFresh({ rows: new Set(), tokens: new Set() }), 1400);
    return () => clearTimeout(t);
    // The keys, compared by value: a new array each render must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSig, tokenSig]);

  const hide = (key: string) => {
    if (leaving.has(key)) return;
    haptic('tick');
    // The row folds away from its real height.
    const el = list.current?.querySelector<HTMLElement>(`[data-slot="${CSS.escape(key)}"]`);
    el?.style.setProperty('--h', `${el.offsetHeight}px`);
    setLeaving((s) => new Set(s).add(key));
    onLeave?.(key);
    later(
      () => {
        setLeaving((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
        onHide(key);
      },
      calm() ? 0 : OUT_MS,
    );
  };

  const tap = (t: ArrangerToken) => {
    if (t.toggle) return t.onClick();
    if (going) return;
    haptic('tick');
    setGoing(t.key);
    later(
      () => {
        setGoing(null);
        t.onClick();
      },
      calm() ? 0 : 140,
    );
  };

  const byKey = new Map(rows.map((r) => [r.key, r]));
  const anchors = (locked: ArrangerAnchor[]) =>
    locked.length ? (
      <ul className="slots slots--fixed">
        {locked.map((a) => (
          // Not a control: a tap only shows (a shake) that it stays put.
          <li
            key={a.key}
            className="slot slot--fixed"
            data-slot={a.key}
            onClick={(e) => {
              haptic('select');
              replay(e.currentTarget);
            }}
          >
            <SlotBody mark={a.mark} title={a.title} sub={a.sub} />
            <Icon name="lock" className="slot__lock" />
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div className="arranger">
      {anchors(top)}
      {rows.length ? (
        <Sortable
          ids={rowKeys}
          onMove={onMove}
          onPreview={onPreview}
          onLift={onLift}
          grips
          label={(k) => byKey.get(k)?.title ?? k}
          liftClass="lift--slot"
          renderOverlay={(k) => {
            const r = byKey.get(k);
            return r ? (
              <div className="slot">
                <SlotBody mark={r.mark} title={r.title} sub={r.sub} />
                <span className="slot__btn" aria-hidden="true">
                  <Icon name="x" />
                </span>
                <span className="slot__btn slot__grip" aria-hidden="true">
                  <Icon name="grip" />
                </span>
              </div>
            ) : null;
          }}
        >
          <ul className="slots" ref={list}>
            {rows.map((r, i) => (
              <SlotRow
                key={r.key}
                row={r}
                index={i}
                leaving={leaving.has(r.key)}
                fresh={fresh.rows.has(r.key)}
                onHide={hide}
                hideLabel={hideLabel(r)}
                moveLabel={moveLabel(r)}
              />
            ))}
          </ul>
        </Sortable>
      ) : null}
      {anchors(bottom)}

      {tokens.length || trayEmpty ? (
        <section className="section tray">
          <div className="section__head">
            <h2 className="section__title">{trayTitle}</h2>
          </div>
          {tokens.length ? null : <p className="tray__empty">{trayEmpty}</p>}
          <div className="tokens">
            {tokens.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`token ${t.open ? 'is-open' : ''} ${fresh.tokens.has(t.key) ? 'is-new' : ''} ${going === t.key ? 'is-going' : ''}`}
                onClick={() => tap(t)}
                disabled={t.disabled}
                title={t.title}
                aria-expanded={t.toggle ? !!t.open : undefined}
              >
                {t.mark ?? <Icon name="plus" />}
                <span dir="auto">{t.label}</span>
                {t.mark ? <Icon name="plus" className="token__plus" /> : null}
              </button>
            ))}
          </div>
          {panel}
        </section>
      ) : null}

      {reset ? (
        <div className="arranger__reset">
          <button type="button" className="textbtn" onClick={reset.run}>
            {reset.label}
          </button>
        </div>
      ) : null}
    </div>
  );
}

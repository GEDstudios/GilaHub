import type { Store } from './store';
import type { Table } from './model';

/** One entity's part in a step: its fields before and after (`_s` = its privacy scope). */
interface Change {
  t: Table;
  id: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** It didn't exist before this step: undo removes it. */
  fresh: boolean;
}

type Step = Change[];

const key = (t: string, id: string) => `${t}\u0000${id}`;

/**
 * Undo and redo for everything I do here, whatever screen did it. The store tells it of each
 * local write; the writes of one moment (one tap, one key) make one step. Undo writes the old
 * values back as new writes (so they sync like any other change, and my person sees them); redo
 * writes the new ones again. What my person changes reaches the store another way: never mine to undo.
 */
export class History {
  private undos: Step[] = [];
  private redos: Step[] = [];
  private open: Map<string, Change> | null = null;
  private applying = false;

  constructor(
    private readonly store: Store,
    private readonly opts: { record?: (t: Table) => boolean; limit?: number; group?: (close: () => void) => void } = {},
  ) {
    store.onWrite = (t, id, before, after, fresh) => this.note(t, id, before, after, fresh);
  }

  private note(t: Table, id: string, before: Record<string, unknown>, after: Record<string, unknown>, fresh: boolean): void {
    if (this.applying || (this.opts.record && !this.opts.record(t))) return;
    if (!this.open) {
      this.open = new Map();
      (this.opts.group ?? queueMicrotask)(() => this.close());
    }
    const k = key(t, id);
    const c = this.open.get(k);
    if (!c) {
      this.open.set(k, { t, id, before: { ...before }, after: { ...after }, fresh });
      return;
    }
    // Several writes to one thing in one step: the first before, the last after.
    for (const [f, v] of Object.entries(before)) if (!(f in c.before)) c.before[f] = v;
    Object.assign(c.after, after);
  }

  /** End the step being written (normally at the end of the moment it started in). */
  close(): void {
    const open = this.open;
    this.open = null;
    if (!open?.size) return;
    // Writes that changed nothing (set to what it was) aren't a step.
    const step = [...open.values()].filter((c) => c.fresh || Object.keys(c.after).some((f) => !same(c.before[f], c.after[f])));
    if (!step.length) return;
    this.undos.push(step);
    if (this.undos.length > (this.opts.limit ?? 100)) this.undos.shift();
    this.redos = [];
  }

  canUndo(): boolean {
    return !!this.open?.size || this.undos.length > 0;
  }

  canRedo(): boolean {
    return this.redos.length > 0;
  }

  /** Take back the last step. Returns whether there was one. */
  undo(): boolean {
    this.close();
    const step = this.undos.pop();
    if (!step) return false;
    this.apply(step, 'before');
    this.redos.push(step);
    return true;
  }

  /** Do again what was just undone. */
  redo(): boolean {
    this.close();
    const step = this.redos.pop();
    if (!step) return false;
    this.apply(step, 'after');
    this.undos.push(step);
    return true;
  }

  private apply(step: Step, side: 'before' | 'after'): void {
    this.applying = true;
    try {
      this.store.batch(() => {
        const order = side === 'before' ? [...step].reverse() : step;
        for (const c of order) {
          if (side === 'before' && c.fresh) {
            this.store.mutate(c.t, c.id, { deleted: true } as never);
            continue;
          }
          const vals = c[side];
          if ('_s' in vals && typeof vals._s === 'string') {
            if (this.store.record(c.t, c.id)) this.store.setScope(c.t, c.id, vals._s as never);
            else this.store.init(c.t, c.id, vals._s as never);
          }
          const fields: Record<string, unknown> = {};
          for (const [f, v] of Object.entries(vals)) if (f !== '_s') fields[f] = v;
          // Brought back: no longer gone (unless it was gone then too).
          if (side === 'after' && c.fresh && !('deleted' in fields)) fields.deleted = null;
          if (Object.keys(fields).length) this.store.mutate(c.t, c.id, fields as never);
        }
      });
    } finally {
      this.applying = false;
    }
  }
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The app's own upkeep (a folder made for me, things filed away on their own): not something to undo. */
export function quietly<T>(store: Store, fn: () => T): T {
  const was = store.onWrite;
  store.onWrite = null;
  try {
    return fn();
  } finally {
    store.onWrite = was;
  }
}

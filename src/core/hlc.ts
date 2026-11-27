/**
 * Hybrid Logical Clock.
 *
 * Timestamps are strings that sort lexicographically in causal order:
 *   "<wall ms, base36, 10 chars>:<counter, base36, 5 chars>:<node id>"
 * The node id breaks ties deterministically, so every replica picks the same winner
 * for concurrent writes (last-writer-wins without coordination).
 */
export interface HlcState {
  ms: number;
  c: number;
}

const MAX_DRIFT_MS = 1000 * 60 * 60 * 24; // ignore remote clocks wildly in the future

export function encodeHlc(state: HlcState, node: string): string {
  return `${state.ms.toString(36).padStart(10, '0')}:${state.c.toString(36).padStart(5, '0')}:${node}`;
}

function decodeHlc(ts: string): HlcState & { node: string } {
  const [ms, c, node] = ts.split(':');
  return { ms: parseInt(ms, 36), c: parseInt(c, 36), node: node ?? '' };
}

export class Clock {
  private state: HlcState;

  constructor(
    readonly node: string,
    initial: HlcState = { ms: 0, c: 0 },
    private readonly wall: () => number = () => Date.now(),
  ) {
    this.state = { ...initial };
  }

  /** Issue a new timestamp for a local event. */
  now(): string {
    const wall = this.wall();
    if (wall > this.state.ms) this.state = { ms: wall, c: 0 };
    else this.state = { ms: this.state.ms, c: this.state.c + 1 };
    return encodeHlc(this.state, this.node);
  }

  /** Merge a remote timestamp so later local events sort after it. */
  observe(remote: string): void {
    const r = decodeHlc(remote);
    const wall = this.wall();
    if (!Number.isFinite(r.ms) || r.ms > wall + MAX_DRIFT_MS) return;
    const ms = Math.max(wall, this.state.ms, r.ms);
    let c: number;
    if (ms === this.state.ms && ms === r.ms) c = Math.max(this.state.c, r.c) + 1;
    else if (ms === this.state.ms) c = this.state.c + 1;
    else if (ms === r.ms) c = r.c + 1;
    else c = 0;
    this.state = { ms, c };
  }

  snapshot(): HlcState {
    return { ...this.state };
  }
}

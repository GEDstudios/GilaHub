import type { Hub } from '../core/actions';
import { atLocal, humanDate, humanTime } from '../core/dates';
import type { Item, List, Scope } from '../core/model';
import { api } from '../core/session';
import { isFlexible, nextDue } from '../smart/recurrence';
import { use24h } from './prefs';
import { sealNote, type NotePayload, type Runtime } from './runtime';

export interface ReminderSpec {
  id: string;
  at: number;
  members: string[];
  scope: Scope;
  note: NotePayload;
}

export const REMIND_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'When due' },
  { value: 15, label: '15 min before' },
  { value: 60, label: '1 hour before' },
  { value: 24 * 60, label: '1 day before' },
];

/** Who should hear about this item? Never the partner for private things. */
export function whoToRemind(hub: Hub, item: Item, scope: Scope): string[] {
  if (scope.startsWith('p:')) return [scope.slice(2)];
  const owner = hub.ownerOf(item);
  if (owner) return [owner];
  const all = hub.members().map((m) => m.id);
  if (item.assignee === 'turns') return item.turn ? [item.turn] : all;
  if (item.assignee && item.assignee !== 'both') return [item.assignee];
  return all;
}

export function reminderTime(item: Item, due: string): number {
  return atLocal(due, item.dueTime || '09:00') - (item.remind ?? 0) * 60_000;
}

export function desiredReminders(hub: Hub, now = Date.now()): ReminderSpec[] {
  const out: ReminderSpec[] = [];
  const lists = new Map<string, List>(hub.lists().map((l) => [l.id, l]));
  for (const item of hub.store.all('item')) {
    if (item.remind === null || item.remind === undefined || !item.due || item.done || item.paused || item.archived || item.someday) continue;
    const list = lists.get(item.listId);
    if (!list) continue;
    const scope = hub.store.scopeOf('item', item.id);
    const members = whoToRemind(hub, item, scope);
    const dues = [item.due];
    if (item.repeat && !isFlexible(item.repeat)) {
      let d = item.due;
      for (let i = 0; i < 3; i++) dues.push((d = nextDue(item.repeat, d, d)));
    }
    dues.forEach((due, i) => {
      const at = reminderTime(item, due);
      if (at < now - 60_000) return;
      const when = item.dueTime ? `${humanDate(due)} · ${humanTime(item.dueTime, use24h())}` : humanDate(due);
      out.push({ id: `${item.id}.${i}`, at, members, scope, note: { title: item.title, body: `${list.name} · ${when}`, url: `/i/${item.id}`, tag: item.id } });
    });
  }
  return out;
}

/** Mirrors the desired reminder set onto the relay (sealed), sending only changes. */
export class ReminderSync {
  private sent = new Map<string, string>();
  private loaded = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly rt: Runtime) {}

  schedule(delay = 2500): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  async run(): Promise<void> {
    if (!this.rt.relay || this.running) return;
    this.running = true;
    try {
      if (!this.loaded) {
        const saved = await this.rt.persistence.getMeta<Record<string, string>>('reminders');
        this.sent = new Map(Object.entries(saved ?? {}));
        this.loaded = true;
      }
      const want = desiredReminders(this.rt.hub);
      const keep = new Set<string>();
      const upsert: Array<{ id: string; at: number; members: string[]; payload: string }> = [];
      const fps = new Map<string, string>();
      for (const r of want) {
        const fp = `${r.at}|${r.members.join(',')}|${r.note.title}|${r.note.body}`;
        keep.add(r.id);
        fps.set(r.id, fp);
        if (this.sent.get(r.id) !== fp) upsert.push({ id: r.id, at: r.at, members: r.members, payload: await sealNote(this.rt, r.note, r.scope) });
      }
      const remove = [...this.sent.keys()].filter((id) => !keep.has(id));
      if (!upsert.length && !remove.length) return;
      await api(this.rt.session, 'reminders', { method: 'POST', body: JSON.stringify({ upsert, remove }) });
      for (const id of remove) this.sent.delete(id);
      for (const u of upsert) this.sent.set(u.id, fps.get(u.id)!);
      await this.rt.persistence.commit({ meta: { reminders: Object.fromEntries(this.sent) } });
    } catch {
      // Offline or relay hiccup — try again later.
      this.schedule(30_000);
    } finally {
      this.running = false;
    }
  }
}

/** While the app is open, fire due reminders locally too (covers local-only mode). */
export class LocalReminders {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private fired = new Set<string>();

  constructor(
    private readonly hub: Hub,
    private readonly onFire: (r: ReminderSpec) => void,
  ) {}

  refresh(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    const now = Date.now();
    for (const r of desiredReminders(this.hub, now)) {
      const delay = r.at - now;
      if (delay < 0 || delay > 12 * 3600_000 || this.fired.has(r.id)) continue;
      if (!r.members.includes(this.hub.meId)) continue;
      this.timers.set(
        r.id,
        setTimeout(() => {
          this.fired.add(r.id);
          this.onFire(r);
        }, delay),
      );
    }
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

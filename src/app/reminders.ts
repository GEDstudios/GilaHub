import type { Hub } from '../core/hub';
import { atLocal, humanDate, today } from '../core/dates';
import type { Item, List, Scope } from '../core/model';
import { api } from '../core/session';
import { isFlexible, nextDue } from '../smart/recurrence';
import { use24h } from './prefs';
import { sealNote, type NotePayload, type Runtime } from './runtime';
import { whenText } from './labels';
import { G_TEXT } from './ui/glyphs';

interface ReminderSpec {
  id: string;
  at: number;
  members: string[];
  scope: Scope;
  note: NotePayload;
}

/** Who should hear about this item? Never the partner for private things. */
function whoToRemind(hub: Hub, item: Item, scope: Scope): string[] {
  if (scope.startsWith('p:')) return [scope.slice(2)];
  const owner = hub.ownerOf(item);
  if (owner) return [owner];
  const all = hub.members().map((m) => m.id);
  if (item.assignee === 'turns') return item.turn ? [item.turn] : all;
  if (item.assignee && item.assignee !== 'both') return [item.assignee];
  return all;
}

/** Again until done: how many nags ahead are set at a time, and how far ahead at most. */
const NAGS_AHEAD = 6;
const NAG_HORIZON = 120 * 86_400_000;

/** The time of day a reminder comes when a task has a day and no time: each person's own (Settings). */
export const DEFAULT_REMIND_AT = '09:00';
const dayTimeOf = (hub: Hub, member: string) => hub.member(member)?.remindAt || DEFAULT_REMIND_AT;

function reminderTime(item: Item, due: string, dayTime = DEFAULT_REMIND_AT): number {
  return atLocal(due, item.dueTime || dayTime) - (item.remind ?? 0) * 60_000;
}

export function desiredReminders(hub: Hub, now = Date.now()): ReminderSpec[] {
  const out: ReminderSpec[] = [];
  const lists = new Map<string, List>(hub.lists().map((l) => [l.id, l]));
  for (const item of hub.store.all('item')) {
    if (item.remind === null || item.remind === undefined || !item.due || item.done || item.paused || item.archived) continue;
    const list = lists.get(item.listId);
    if (!list) continue;
    const scope = hub.store.scopeOf('item', item.id);
    const everyone = whoToRemind(hub, item, scope);
    // With a time, one reminder for all; with only a day, each of us at our own time of day.
    const byTime = new Map<string, string[]>();
    for (const m of everyone) {
      const t = item.dueTime ? '' : dayTimeOf(hub, m);
      byTime.set(t, [...(byTime.get(t) ?? []), m]);
    }
    if (!byTime.size) byTime.set(item.dueTime ? '' : DEFAULT_REMIND_AT, []);
    const several = byTime.size > 1;
    for (const [dayTime, members] of byTime) {
      const sfx = several ? `@${dayTime.replace(':', '')}` : '';
      const dues = [item.due];
      if (item.repeat && !isFlexible(item.repeat)) {
        let d = item.due;
        for (let i = 0; i < 3; i++) dues.push((d = nextDue(item.repeat, d, d)));
      }
      dues.forEach((due, i) => {
        const at = reminderTime(item, due, dayTime || DEFAULT_REMIND_AT);
        if (at < now - 60_000) return;
        const when = whenText(due, item.dueTime, today(), use24h());
        out.push({
          id: `${item.id}.${i}${sfx}`,
          at,
          members,
          scope,
          note: {
            title: `${item.urgent ? G_TEXT.urgent : G_TEXT.remind} ${item.title}`,
            body: `${when} · ${list.name}`,
            url: `/i/${item.id}`,
            tag: item.id,
          },
        });
      });
      // Again until done: the next few times on its rhythm after the first, while it's still open.
      // On a repeating task, for the time that's due now (a day its next time is due has that reminder already).
      if (item.nag) {
        const own = new Set(dues);
        const rule = item.nag.type === 'interval' ? { ...item.nag, from: 'schedule' as const } : item.nag;
        let d = item.due;
        let n = 0;
        for (let guard = 0; guard < 3000 && n < NAGS_AHEAD; guard++) {
          d = nextDue(rule, d, d);
          const at = reminderTime(item, d, dayTime || DEFAULT_REMIND_AT);
          if (at > now + NAG_HORIZON) break;
          if (at < now - 60_000 || own.has(d)) continue;
          n++;
          out.push({
            id: `${item.id}.n${d}${sfx}`,
            at,
            members,
            scope,
            note: {
              title: `${item.urgent ? G_TEXT.urgent : G_TEXT.remind} ${item.title}`,
              body: `Still to do · was due ${humanDate(item.due)} · ${list.name}`,
              url: `/i/${item.id}`,
              tag: item.id,
            },
          });
        }
      }
    }
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
      const upsert: Array<{
        id: string;
        at: number;
        members: string[];
        payload: string;
      }> = [];
      const fps = new Map<string, string>();
      for (const r of want) {
        const fp = `${r.at}|${r.members.join(',')}|${r.note.title}|${r.note.body}`;
        keep.add(r.id);
        fps.set(r.id, fp);
        if (this.sent.get(r.id) !== fp)
          upsert.push({
            id: r.id,
            at: r.at,
            members: r.members,
            payload: await sealNote(this.rt, r.note, r.scope),
          });
      }
      const remove = [...this.sent.keys()].filter((id) => !keep.has(id));
      if (!upsert.length && !remove.length) return;
      await api(this.rt.session, 'reminders', {
        method: 'POST',
        body: JSON.stringify({ upsert, remove }),
      });
      for (const id of remove) this.sent.delete(id);
      for (const u of upsert) this.sent.set(u.id, fps.get(u.id)!);
      await this.rt.persistence.commit({
        meta: { reminders: Object.fromEntries(this.sent) },
      });
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

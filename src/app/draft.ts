import type { Assignee, RepeatRule } from '../core/model';
import type { VisChoice } from './privacy';

/** Everything the inline editor can change about an item. */
export interface Draft {
  due: string | null;
  dueTime: string | null;
  repeat: RepeatRule | null;
  remind: number | null;
  /** Notify again until done (with a notification, on a thing that doesn't repeat). */
  nag?: RepeatRule | null;
  assignee: Assignee;
  urgent: boolean;
  visibility: VisChoice;
  /** For a request to the partner: I OK it before it counts as done. */
  needsOk?: boolean;
}

export type Field = 'when' | 'repeat' | 'remind' | 'who' | 'vis' | 'urgent';

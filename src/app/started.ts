import type { Hub } from '../core/actions';
import { DEFAULT_PINS } from './tabs';

/**
 * Getting started: a few first things, each learned by doing it. A step counts as done when
 * the app can see it happened (shared data, so it holds on every device), never by reading.
 */
export type StepKey = 'add' | 'tick' | 'person' | 'notify' | 'bar';

export interface Step {
  key: StepKey;
  title: string;
  done: boolean;
}

export function startedSteps(hub: Hub, pushOn: boolean): Step[] {
  const me = hub.meId;
  const items = hub.store.all('item');
  const pins = hub.me()?.tabs;
  return [
    { key: 'add', title: 'Add something with +', done: items.some((i) => i.createdBy === me) },
    { key: 'tick', title: 'Tick it off', done: items.some((i) => i.doneBy === me || i.lastDoneBy === me) || hub.store.all('log').some((l) => l.by === me) },
    { key: 'person', title: 'Bring your person in', done: !!hub.partner() },
    { key: 'notify', title: 'Turn on notifications', done: pushOn },
    { key: 'bar', title: 'Make the bar yours', done: !!pins && pins.join() !== DEFAULT_PINS.join() },
  ];
}

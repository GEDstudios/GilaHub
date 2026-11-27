import { useSyncExternalStore } from 'react';
import { getPrefs, subscribePrefs, type Prefs } from './prefs';

/** My preferences, kept current while the component is on screen. */
export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribePrefs, getPrefs);
}

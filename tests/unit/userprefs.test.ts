import { beforeEach, describe, expect, it } from 'vitest';
import { applyPrefs, getPrefs, setPrefs } from '../../src/app/prefs';
import { bindUserPrefs } from '../../src/app/userPrefs';
import { person, sync } from './_helpers';

describe('My preferences follow me, not the phone', () => {
  beforeEach(() => applyPrefs({ todayScope: 'all', todayNew: 'mine', filters: {} }));

  it('what I set on one device is there on my other one; my person can’t read it', async () => {
    const phone = await person('guy', { device: 'phone' });
    const laptop = await person('guy', { device: 'laptop' });
    const hila = await person('hila', { device: 'hila' });
    const off = bindUserPrefs(phone);
    // A folder's filter (its key is the folder's, as ListScreen stores it).
    setPrefs({ todayScope: 'mine', filters: { 'l:todo': { tags: [], who: 'me', urgent: true } } });
    off();
    sync(phone, laptop, hila);
    expect(laptop.store.get('settings', 'prefs:guy')).toMatchObject({ todayScope: 'mine' });
    expect(hila.store.get('settings', 'prefs:guy')).toBeUndefined();
    // The laptop takes them when it binds.
    applyPrefs({ todayScope: 'all', filters: {} });
    const off2 = bindUserPrefs(laptop);
    expect(getPrefs().todayScope).toBe('mine');
    expect(getPrefs().filters['l:todo']).toMatchObject({ who: 'me', urgent: true });
    off2();
  });
});

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

  it('a preferences record that a restore once left under the household key is sealed as mine again', async () => {
    const phone = await person('guy', { device: 'phone' });
    const hila = await person('hila', { device: 'hila' });
    // As the old restore did it: under 'h', readable by both.
    phone.store.mutate('settings', 'prefs:guy', { todayScope: 'mine' } as never);
    expect(phone.store.scopeOf('settings', 'prefs:guy')).toBe('h');
    const off = bindUserPrefs(phone);
    expect(phone.store.scopeOf('settings', 'prefs:guy')).toBe('p:guy');
    expect(getPrefs().todayScope).toBe('mine');
    setPrefs({ todayScope: 'all' });
    off();
    sync(phone, hila);
    // What I set from here on never reaches my person.
    expect((hila.store.get('settings', 'prefs:guy') as { todayScope?: string } | undefined)?.todayScope).not.toBe('all');
  });
});

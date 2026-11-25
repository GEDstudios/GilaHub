import { describe, expect, it, vi } from 'vitest';
import { flickSpeed, foldToast, sheetCloses, sheetPull, toastSwipedAway, type ToastLike } from '../../src/app/ui/motion';
import { AWAY_ON, syncTitle, welcomeBack } from '../../src/app/settingsCopy';
import { aisleIcon } from '../../src/app/aisles';

describe('sheet pull', () => {
  it('follows the finger down and only gives a little upward', () => {
    expect(sheetPull(80)).toBe(80);
    expect(sheetPull(0)).toBe(0);
    expect(sheetPull(-50)).toBeCloseTo(-9);
    expect(sheetPull(-400)).toBe(-24);
  });

  it('closes past 28% of the sheet (140px at most) or on a flick down; otherwise springs back', () => {
    // A short sheet: 28% of 300 is 84.
    expect(sheetCloses(90, 300, 0)).toBe(true);
    expect(sheetCloses(80, 300, 0)).toBe(false);
    // A tall sheet caps at 140.
    expect(sheetCloses(139, 800, 0)).toBe(false);
    expect(sheetCloses(141, 800, 0)).toBe(true);
    // A quick flick closes from a short pull, but not a flick upward.
    expect(sheetCloses(30, 800, 0.6)).toBe(true);
    expect(sheetCloses(30, 800, 0.5)).toBe(false);
    expect(sheetCloses(-10, 800, 0.9)).toBe(false);
  });

  it('measures the flick from the last stretch of the gesture', () => {
    expect(flickSpeed([])).toBe(0);
    expect(flickSpeed([[0, 0]])).toBe(0);
    // Slow for a while, then fast: only the last ~90ms counts.
    const samples: Array<[number, number]> = [
      [0, 0],
      [200, 10],
      [400, 20],
      [450, 50],
      [480, 80],
    ];
    expect(flickSpeed(samples)).toBeCloseTo((80 - 20) / (480 - 400));
    expect(flickSpeed([[0, 100], [100, 40]])).toBeCloseTo(-0.6);
  });
});

describe('toasts', () => {
  it('swipe away past 64px or with a flick either way', () => {
    expect(toastSwipedAway(70, 0)).toBe(true);
    expect(toastSwipedAway(-70, 0)).toBe(true);
    expect(toastSwipedAway(40, 0.2)).toBe(false);
    expect(toastSwipedAway(-20, -0.8)).toBe(true);
    // A tap (no movement) never dismisses, whatever the timing.
    expect(toastSwipedAway(0, 3)).toBe(false);
  });

  it('fold into one per group: the count goes up and Undo undoes all, newest first', () => {
    const order: string[] = [];
    const many = (n: number) => `${n} in the cart`;
    const first: ToastLike = { message: 'milk is in the cart', group: 'cart', many, count: 1, action: { label: 'Undo', run: () => order.push('milk') } };
    const second = foldToast(first, { message: 'eggs is in the cart', group: 'cart', many, action: { label: 'Undo', run: () => order.push('eggs') } });
    expect(second).not.toBeNull();
    expect(second!.count).toBe(2);
    expect(second!.message).toBe('2 in the cart');
    const third = foldToast(second!, { message: 'bread is in the cart', group: 'cart', many, action: { label: 'Undo', run: () => order.push('bread') } });
    expect(third!.message).toBe('3 in the cart');
    third!.action!.run();
    expect(order).toEqual(['bread', 'eggs', 'milk']);
  });

  it('do not fold across groups, or without a group', () => {
    const a: ToastLike = { message: 'Done', group: 'done', count: 1 };
    expect(foldToast(a, { message: 'milk is in the cart', group: 'cart' })).toBeNull();
    expect(foldToast({ message: 'Saved', count: 1 }, { message: 'Saved' })).toBeNull();
  });

  it('keep the newest action when the labels differ', () => {
    const run = vi.fn();
    const a: ToastLike = { message: 'Done', group: 'done', count: 1, action: { label: 'Undo', run: () => {} } };
    const b = foldToast(a, { message: 'Done', group: 'done', action: { label: 'Finish them', run } });
    b!.action!.run();
    expect(b!.action!.label).toBe('Finish them');
    expect(run).toHaveBeenCalledOnce();
    // No `many`: the newest message stays.
    expect(b!.message).toBe('Done');
  });
});

describe('words', () => {
  it('give the sync dot a human title everywhere', () => {
    expect(syncTitle('synced')).toBe('Synced');
    expect(syncTitle('local')).toBe('On this device only');
    expect(syncTitle('offline')).toBe('Offline · saved on this device');
    expect(syncTitle('connecting')).toBe('Syncing');
    expect(syncTitle('syncing')).toBe('Syncing');
  });

  it('say the same thing about Away mode from Chores and from Settings', () => {
    expect(AWAY_ON).toBe('Chores paused. Have a good trip.');
    expect(welcomeBack('2026-11-20', '2026-11-25')).toBe('Welcome back. Chores moved by 5 days.');
  });

  it('draw grocery aisles as icons and leave home departments to their emoji', () => {
    expect(aisleIcon('grocery', 'dairy')).toBe('cheese');
    expect(aisleIcon('grocery', 'nope')).toBeUndefined();
    expect(aisleIcon('home', 'dairy')).toBeUndefined();
  });
});

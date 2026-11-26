import { describe, expect, it } from 'vitest';
import { Hub } from '../../src/core/actions';
import { person } from './_helpers';

describe('Notes kept, and brought back', () => {
  it('a kept note comes back to its screen; Undo keeps it again', async () => {
    const guy = await person('guy');
    const id = guy.addNote('shop', 'Milk 💛', 'pink')!;
    guy.peelNote(id);
    expect(guy.collectedNotes().map((n) => n.id)).toEqual([id]);
    expect(guy.notesOn('shop')).toEqual([]);
    const undo = guy.unpeelNote(id);
    expect(guy.collectedNotes()).toEqual([]);
    expect(guy.notesOn('shop').map((n) => n.id)).toEqual([id]);
    undo();
    expect(guy.collectedNotes().map((n) => n.id)).toEqual([id]);
  });
});

describe('sticky notes', () => {
  it('stays where it was put, and a ticked one joins the collection', async () => {
    const hub = await person('guy');
    hub.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    hub.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    const id = hub.addNote('shop', 'Milk 💛', 'lemon')!;
    hub.placeNote(id, { x: 0.41234, y: 300.7, rot: -12.345 });
    expect(hub.store.get('note', id)).toMatchObject({ x: 0.412, y: 301, rot: -12.3 });
    expect(hub.notesOn('shop')).toHaveLength(1);
    // Hila ticks it (same store, her eyes)
    const hila = new Hub(hub.store, 'hila');
    hila.peelNote(id);
    expect(hub.notesOn('shop')).toHaveLength(0);
    expect(hub.collectedNotes().map((n) => n.text)).toEqual(['Milk 💛']);
    const undo = hub.deleteNote(id);
    expect(hub.collectedNotes()).toEqual([]);
    undo();
    expect(hub.collectedNotes()).toHaveLength(1);
  });
});

describe('sticky notes, sized', () => {
  it('keeps a size between the smallest and biggest, and either of us can tick it', async () => {
    const { NOTE_MAX, NOTE_MIN } = await import('../../src/core/actions');
    const hub = await person('guy');
    hub.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    hub.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    const id = hub.addNote('shop', 'Milk', 'lemon')!;
    hub.placeNote(id, { x: 0.5, y: 100, rot: 0, scale: 9 });
    expect(hub.store.get('note', id)?.scale).toBe(NOTE_MAX);
    hub.placeNote(id, { x: 0.5, y: 100, rot: 0, scale: 0.1 });
    expect(hub.store.get('note', id)?.scale).toBe(NOTE_MIN);
    // The one who left it ticks it: collected, not gone.
    hub.peelNote(id);
    expect(hub.collectedNotes().map((n) => n.id)).toEqual([id]);
  });
});

describe('editing a note', () => {
  it('lets me change my own note’s words and paper, never my person’s', async () => {
    const hub = await person('guy');
    hub.upsertMember('guy', { name: 'Guy', color: 'sky', createdAt: 1 });
    hub.upsertMember('hila', { name: 'Hila', color: 'pink', createdAt: 2 });
    const id = hub.addNote('shop', 'Milk', 'lemon')!;
    hub.editNote(id, { text: '  Oat milk 💛 ', color: 'pink' });
    expect(hub.store.get('note', id)).toMatchObject({ text: 'Oat milk 💛', color: 'pink' });
    hub.editNote(id, { text: '   ' });
    expect(hub.store.get('note', id)?.text).toBe('Oat milk 💛');
    const hila = new Hub(hub.store, 'hila');
    hila.editNote(id, { text: 'Soy' });
    expect(hub.store.get('note', id)?.text).toBe('Oat milk 💛');
  });
});

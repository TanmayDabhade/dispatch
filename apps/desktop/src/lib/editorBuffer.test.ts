import { describe, expect, it } from 'bun:test';

import {
  beginSave,
  editBuffer,
  hasUnsavedChanges,
  openBuffer,
  saveFailed,
  saveSucceeded,
  shouldSave,
} from './editorBuffer';

describe('editorBuffer', () => {
  it('opens clean', () => {
    const buffer = openBuffer('a.ts', 'hello');
    expect(buffer.status).toBe('clean');
    expect(shouldSave(buffer)).toBe(false);
    expect(hasUnsavedChanges(buffer)).toBe(false);
  });

  it('goes dirty on an edit', () => {
    const buffer = editBuffer(openBuffer('a.ts', 'hello'), 'hello world');
    expect(buffer.status).toBe('dirty');
    expect(shouldSave(buffer)).toBe(true);
  });

  it('goes clean again when edited back to what is on disk', () => {
    let buffer = editBuffer(openBuffer('a.ts', 'hello'), 'hello world');
    buffer = editBuffer(buffer, 'hello');
    expect(buffer.status).toBe('clean');
    expect(shouldSave(buffer)).toBe(false);
  });

  it('completes a save that nothing raced', () => {
    let buffer = editBuffer(openBuffer('a.ts', 'one'), 'two');
    buffer = beginSave(buffer);
    expect(buffer.status).toBe('saving');
    // Nothing may start a second save while one is in flight.
    expect(shouldSave(buffer)).toBe(false);

    buffer = saveSucceeded(buffer);
    expect(buffer.status).toBe('clean');
    expect(buffer.savedText).toBe('two');
    expect(shouldSave(buffer)).toBe(false);
  });

  it('does not mark clean when the user typed during the save', () => {
    // The work-losing case this module exists for: without the in-flight
    // text, the completing save clears the dirty flag and the third edit is
    // never written.
    let buffer = editBuffer(openBuffer('a.ts', 'one'), 'two');
    buffer = beginSave(buffer);
    buffer = editBuffer(buffer, 'three');

    buffer = saveSucceeded(buffer);
    expect(buffer.status).toBe('dirty');
    // 'two' really did reach disk, so that is what the next save compares to.
    expect(buffer.savedText).toBe('two');
    expect(shouldSave(buffer)).toBe(true);
    expect(hasUnsavedChanges(buffer)).toBe(true);
  });

  it('saves the newer text on the next pass', () => {
    let buffer = beginSave(editBuffer(openBuffer('a.ts', 'one'), 'two'));
    buffer = editBuffer(buffer, 'three');
    buffer = saveSucceeded(buffer);

    buffer = beginSave(buffer);
    expect(buffer.inFlightText).toBe('three');
    buffer = saveSucceeded(buffer);
    expect(buffer.status).toBe('clean');
    expect(buffer.savedText).toBe('three');
  });

  it('keeps the work when a save fails', () => {
    let buffer = beginSave(editBuffer(openBuffer('a.ts', 'one'), 'two'));
    buffer = saveFailed(buffer, 'disk full');

    expect(buffer.status).toBe('error');
    expect(buffer.error).toBe('disk full');
    // Not advanced: the file on disk is still 'one', so a retry is still owed.
    expect(buffer.savedText).toBe('one');
    expect(shouldSave(buffer)).toBe(true);
    expect(hasUnsavedChanges(buffer)).toBe(true);
  });

  it('clears an error once the user types again', () => {
    let buffer = saveFailed(
      beginSave(editBuffer(openBuffer('a.ts', 'one'), 'two')),
      'nope'
    );
    buffer = editBuffer(buffer, 'four');
    expect(buffer.status).toBe('dirty');
    expect(buffer.error).toBeNull();
  });

  it('stays in the saving state while the user types', () => {
    // The status must not flicker dirty/saving on every keystroke.
    let buffer = beginSave(editBuffer(openBuffer('a.ts', 'one'), 'two'));
    buffer = editBuffer(buffer, 'twoo');
    expect(buffer.status).toBe('saving');
  });
});

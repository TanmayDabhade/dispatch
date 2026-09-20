import { describe, expect, it } from 'bun:test';

import { parseActivity } from './activityFeed';
import { isSubmitChord, noteFromDraft, notePatch } from './noteDraft';

describe('noteFromDraft', () => {
  it('trims the draft', () => {
    expect(noteFromDraft('  ship it  \n')).toBe('ship it');
  });

  it('is null for whitespace', () => {
    expect(noteFromDraft('   \n\t')).toBeNull();
    expect(noteFromDraft('')).toBeNull();
  });
});

describe('notePatch', () => {
  const now = new Date('2026-09-20T10:00:00.000Z');

  it('appends a timestamped line credited to a human', () => {
    expect(notePatch('looks good', now)).toEqual({
      appendActivity: '2026-09-20T10:00:00.000Z looks good',
      activityActor: 'human',
    });
  });

  it('keeps a multi-line comment intact', () => {
    const patch = notePatch('first\nsecond', now);
    expect(patch?.appendActivity).toBe(
      '2026-09-20T10:00:00.000Z first\nsecond'
    );
  });

  it('round-trips a multi-line comment through the feed as one comment', () => {
    // The wire shape core's appendActivity writes for the patch: `- <line> — <actor>`,
    // newlines kept. (The node entry that exports appendActivity is off-limits to the
    // webview, so the shape is spelled out here.)
    const patch = notePatch('first\nsecond', now);
    if (patch?.appendActivity === undefined) throw new Error('no patch');
    const section = `- ${patch.appendActivity} — ${patch.activityActor}\n`;
    expect(parseActivity(section)).toEqual([
      {
        at: '2026-09-20T10:00:00.000Z',
        text: 'first\nsecond',
        actor: 'human',
        kind: 'comment',
      },
    ]);
  });

  it('is null for an empty draft', () => {
    expect(notePatch('  ', now)).toBeNull();
  });
});

describe('isSubmitChord', () => {
  it('is ⌘⏎ or Ctrl⏎', () => {
    expect(isSubmitChord({ key: 'Enter', metaKey: true, ctrlKey: false })).toBe(
      true
    );
    expect(isSubmitChord({ key: 'Enter', metaKey: false, ctrlKey: true })).toBe(
      true
    );
  });

  it('is not a plain Enter — that is a newline in the composer', () => {
    expect(
      isSubmitChord({ key: 'Enter', metaKey: false, ctrlKey: false })
    ).toBe(false);
  });

  it('is not any other chord', () => {
    expect(isSubmitChord({ key: 'k', metaKey: true, ctrlKey: false })).toBe(
      false
    );
  });
});

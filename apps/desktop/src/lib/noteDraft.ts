import type { UpdatePatch } from '@dispatch/core/browser';

// The task page's comment composer, as plain rules: what a draft has to contain before
// it can be sent, the patch that sends it, and which keystroke sends it. Kept out of the
// component so the submit path is testable without a textarea.

/** The comment text a draft would post — trimmed — or `null` when there is nothing to post. */
export function noteFromDraft(draft: string): string | null {
  const text = draft.trim();
  return text === '' ? null : text;
}

/**
 * The `onUpdate` patch that appends a comment to the task's Activity section. The line is
 * timestamped and credited to a human so the feed can tell it from the orchestrator's own
 * `dispatched (…)` events (see `lib/activityFeed.ts`). `null` for an empty draft.
 */
export function notePatch(
  draft: string,
  now: Date = new Date()
): UpdatePatch | null {
  const text = noteFromDraft(draft);
  if (text === null) return null;
  return {
    appendActivity: `${now.toISOString()} ${text}`,
    activityActor: 'human',
  };
}

/** `⌘⏎` / `Ctrl⏎` — the one chord that submits from inside the composer's textarea. */
export function isSubmitChord(input: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return input.key === 'Enter' && (input.metaKey || input.ctrlKey);
}

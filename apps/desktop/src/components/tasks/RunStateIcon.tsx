import type { RunState } from '@dispatch/client';

/** A task is blocked by an unmet dependency rather than by anything a run is doing, so it
 * isn't a `RunState` — but it occupies the same slot on a card and deserves the same word
 * language, hence one shared label map keyed by this widened type. */
export type RunStateIconState = RunState | 'blocked';

// The whose-move vocabulary's words, not process states: a run parked on an approval says
// "Approve" (the ask), a finished one says "Review". The glyph itself is `RunStatePill`
// (components/runs), which draws the feed's StateMark; this file only owns the wording.
const RUN_STATE_LABEL: Record<RunStateIconState, string> = {
  provisioning: 'Provisioning',
  running: 'Working',
  'awaiting-approval': 'Approve',
  failed: 'Failed',
  'interrupted-dirty': 'Interrupted',
  blocked: 'Blocked',
  finished: 'Review',
  cancelled: 'Cancelled',
};

/** Exported so call sites that render their own text for a run state (the fleet view's
 * summary line) label it from the same source rather than keeping a parallel map. */
export function runStateLabel(state: RunStateIconState): string {
  return RUN_STATE_LABEL[state];
}

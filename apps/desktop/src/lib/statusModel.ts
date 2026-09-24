import {
  DEFAULT_STATUS_MODEL,
  isCanceledStatus,
  isCompletedStatus,
  isDoneStatus,
} from '@dispatch/core/browser';
import type { StatusModel } from '@dispatch/core/browser';
import { useSyncExternalStore } from 'react';

// The open project's status types and lifecycle roles, held at module level
// (like notifications.ts's toggles) so pure view helpers can ask without
// threading config through every call. useDispatchProject sets it on load.
let active: StatusModel = DEFAULT_STATUS_MODEL;
const listeners = new Set<() => void>();

export function activeStatusModel(): StatusModel {
  return active;
}

/** Null (config still loading) resets to the built-in model. */
export function setActiveStatusModel(model: StatusModel | null): void {
  const next = model ?? DEFAULT_STATUS_MODEL;
  if (next === active) return;
  active = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The open project's model, re-rendering the caller when it changes — so a memoized
 * card drawn before config loaded still redraws its glyph once it does. */
export function useActiveStatusModel(): StatusModel {
  return useSyncExternalStore(subscribe, activeStatusModel);
}

/** Terminal (completed or canceled) under the open project's statuses. */
export function isStatusDone(status: string): boolean {
  return isDoneStatus(status, active);
}

/** Completed (landed/merged/done) under the open project's statuses. */
export function isStatusCompleted(status: string): boolean {
  return isCompletedStatus(status, active);
}

/** Canceled (dropped) under the open project's statuses. */
export function isStatusCanceled(status: string): boolean {
  return isCanceledStatus(status, active);
}

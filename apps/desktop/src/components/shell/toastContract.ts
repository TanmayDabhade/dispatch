import type { ReactNode } from 'react';

export type ToastTone = 'error' | 'success' | 'info';

/** A toast's follow-up: the indigo text link under the description (`View task`), or a
 * quieter ghost beside it. Both dismiss the toast when clicked. */
export interface ToastLink {
  label: ReactNode;
  onClick: () => void;
}

/** Errors do not auto-dismiss: a failure you did not manage to read is the
 * same as a failure that was never reported. */
export function sonnerOptionsFor(tone: ToastTone): { duration: number } {
  const ms = { success: 3500, info: 4500, error: Infinity } as const;
  return { duration: ms[tone] };
}

/**
 * Maps a toast's follow-ups onto sonner's two slots. `link` and `action` are the same slot —
 * sonner's `action`, which the Toaster styles as an indigo text link — with `link` winning
 * when a caller passes both; `secondary` is sonner's `cancel`, styled as a ghost.
 */
export function sonnerActionsFor(input: {
  link?: ToastLink;
  action?: ToastLink;
  secondary?: ToastLink;
}): { action?: ToastLink; cancel?: ToastLink } {
  const action = input.link ?? input.action;
  return {
    ...(action !== undefined && { action }),
    ...(input.secondary !== undefined && { cancel: input.secondary }),
  };
}

/** The `View task` link every toast about a task carries. */
export function viewTaskLink(
  taskId: string,
  openTask: (taskId: string) => void
): ToastLink {
  return { label: 'View task', onClick: () => openTask(taskId) };
}

/** The second line of a task toast: `t-8f2a — Cache the search index`. */
export function taskToastDescription(taskId: string, title: string): string {
  return `${taskId} — ${title}`;
}

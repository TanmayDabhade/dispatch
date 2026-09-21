// The `dispatch://` link format and its browser-harness twin. Pure: no React,
// no Tauri — `hooks/useDeepLinks.ts` delivers the URLs, `useDeepLinkRouter`
// acts on the parsed shape, and `DeepLinkContext`'s `copyTaskLink` formats one.

/** The URL scheme the bundled app registers (`plugins.deep-link` in
 * tauri.conf.json writes it into the .app's `CFBundleURLTypes`). */
export const DEEP_LINK_SCHEME = 'dispatch';

// Hand-copied from packages/core/src/ids.ts's TASK_ID_PATTERN: core's `ids.ts`
// imports `node:crypto` and is not re-exported from `@dispatch/core/browser`,
// so the desktop cannot import `isTaskId`. Kept byte-identical so a link never
// accepts an id the store would refuse.
const TASK_ID_PATTERN = /^[te]-[0-9a-f]{6}$/;

export interface TaskLink {
  taskId: string;
  /** The project's absolute git root — the link switches the window to it. */
  project: string;
}

/**
 * Formats a task link for one of the two places the UI runs. `'app'` is the
 * `dispatch://task/<id>?project=<root>` form the bundled app opens; `'browser'`
 * is the browser-dev harness's own URL with `task=<id>` set — `root`/`port`
 * ride along so the link lands on the same daemon, but `token` (the harness's
 * agent token) never rides on a pasted link.
 */
export function formatTaskLink(
  link: TaskLink,
  target: 'app' | 'browser',
  browserLocation: string = window.location.href
): string {
  if (target === 'app') {
    return `${DEEP_LINK_SCHEME}://task/${link.taskId}?project=${encodeURIComponent(link.project)}`;
  }
  const url = new URL(browserLocation);
  url.searchParams.set('task', link.taskId);
  url.searchParams.delete('token');
  return url.toString();
}

/**
 * Parses the `'app'` form back into a `TaskLink`, or `null` for anything else:
 * another scheme, a non-task host, an id the store would refuse, or a missing
 * or relative `project`. WHATWG parses `dispatch://task/<id>` with `task` as
 * the host and `/<id>` as the path.
 */
export function parseTaskLink(url: string): TaskLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
  if (parsed.hostname !== 'task') return null;
  const taskId = parsed.pathname.slice(1);
  if (!parsed.pathname.startsWith('/') || !TASK_ID_PATTERN.test(taskId)) {
    return null;
  }
  const project = parsed.searchParams.get('project');
  if (project === null || !project.startsWith('/')) return null;
  return { taskId, project };
}

import { useCallback, useEffect, useRef, useState } from 'react';

import { parseTaskLink, type TaskLink } from '../lib/deepLink';
import { useDeepLinks } from './useDeepLinks';

/** Everything the router needs from App, injected so it runs under happy-dom. */
export interface DeepLinkRouterDeps {
  activeProjectPath: string | null;
  tasksLoading: boolean;
  /** Whether the active project's loaded tasks (archived included) hold `id`. */
  hasTask(id: string): boolean;
  /** Whether `path` is a dispatch-enabled project (`lib/tauri.ts`'s `hasDispatch`). */
  hasDispatch(path: string): Promise<boolean>;
  /** App's `selectSwitchProject` — resets nav, so the task opens afterwards. */
  switchProject(path: string): void;
  openTask(id: string): void;
  notify(toast: {
    title: string;
    description?: string;
    tone: 'error' | 'info';
  }): void;
}

/**
 * Turns a received deep link into "switch project if needed, then open the
 * task". A link for another project is held as `pending` across the switch
 * and lands once `activeProjectPath` matches and that project's tasks have
 * loaded — waiting on `tasksLoading` is what keeps a cold-start link from
 * landing on the task view's "no longer available" state. Every failure is a
 * toast: a link that does not parse, a project without `.dispatch/`, or an id
 * the project does not have.
 */
export function useDeepLinkRouter(deps: DeepLinkRouterDeps): void {
  const [pending, setPending] = useState<TaskLink | null>(null);
  // The deps object is rebuilt every App render; the handlers read the latest
  // through a ref so neither the link subscription nor the effect re-arms.
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const handleLink = useCallback((url: string) => {
    const link = parseTaskLink(url);
    const current = depsRef.current;
    if (link === null) {
      current.notify({ title: 'Bad link', description: url, tone: 'error' });
      return;
    }
    if (link.project === current.activeProjectPath) {
      setPending(link);
      return;
    }
    // A check that throws (no backend, unreadable path) reads as not found.
    void current
      .hasDispatch(link.project)
      .catch(() => false)
      .then((enabled) => {
        if (!enabled) {
          depsRef.current.notify({
            title: 'Project not found',
            description: link.project,
            tone: 'error',
          });
          return;
        }
        depsRef.current.switchProject(link.project);
        setPending(link);
      });
  }, []);

  useDeepLinks(handleLink);

  const { activeProjectPath, tasksLoading } = deps;
  useEffect(() => {
    if (pending === null) return;
    if (activeProjectPath !== pending.project || tasksLoading) return;
    const current = depsRef.current;
    if (current.hasTask(pending.taskId)) {
      current.openTask(pending.taskId);
    } else {
      current.notify({
        title: 'Task not found',
        description: pending.taskId,
        tone: 'error',
      });
    }
    setPending(null);
  }, [pending, activeProjectPath, tasksLoading]);
}

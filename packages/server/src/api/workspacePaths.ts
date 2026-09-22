import { existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { worktreePath } from '../orchestrator/paths.js';

/**
 * Resolving a caller-supplied path against the project or one of its
 * worktrees, without ever letting it escape.
 *
 * Shared by the terminal and file routes, which both take "a run, or a path"
 * and both have to answer the same question: which directory is this relative
 * to, and is the result still inside it. Keeping one copy means the traversal
 * guard is written — and reviewed — once.
 */

export interface WorkspaceTarget {
  /** The absolute resolved path. */
  path: string;
  /** The directory it was resolved against: the repo, or a run's worktree. */
  base: string;
  /** The run whose worktree `base` is, or null for the project itself. */
  runId: string | null;
}

export type WorkspaceResolution =
  | ({ ok: true } & WorkspaceTarget)
  | { ok: false; message: string };

/** The directory a request is scoped to: a run's worktree, or the repo root. */
export function resolveWorkspaceBase(
  rootDir: string,
  runId: unknown
):
  | { ok: true; base: string; runId: string | null }
  | { ok: false; message: string } {
  if (typeof runId === 'string' && runId !== '') {
    const base = worktreePath(rootDir, runId);
    if (!existsSync(base)) {
      return { ok: false, message: `run ${runId} has no worktree on disk` };
    }
    return { ok: true, base, runId };
  }
  return { ok: true, base: resolve(rootDir), runId: null };
}

/**
 * A path inside the project or a run's worktree.
 *
 * The containment check compares against `base + sep` rather than `base`
 * alone, so a sibling directory whose name merely starts with the base's
 * (`/repo-backup` next to `/repo`) is not mistaken for something inside it.
 * `resolve` has already collapsed any `..`, so this one comparison is the
 * whole guard.
 */
export function resolveWorkspacePath(
  rootDir: string,
  spec: { runId?: unknown; path?: unknown }
): WorkspaceResolution {
  const scope = resolveWorkspaceBase(rootDir, spec.runId);
  if (!scope.ok) return scope;

  const raw = spec.path;
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, path: scope.base, base: scope.base, runId: scope.runId };
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: 'path must be a string' };
  }
  const path = resolve(scope.base, raw);
  if (path !== scope.base && !path.startsWith(scope.base + sep)) {
    return {
      ok: false,
      message: 'path must be inside the project or the run’s worktree',
    };
  }
  return { ok: true, path, base: scope.base, runId: scope.runId };
}

/** Whether the resolved path exists and is a directory. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

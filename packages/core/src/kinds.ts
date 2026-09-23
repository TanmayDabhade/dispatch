// Task kinds and the container rule. Browser-safe: no node:* imports.
import type { TaskKind } from './types.js';

/** Kinds that exist to group other tasks (Linear's hierarchy above an issue). */
export const CONTAINER_KINDS = ['initiative', 'project', 'milestone'] as const;
export type ContainerKind = (typeof CONTAINER_KINDS)[number];

/** The pre-hierarchy container kind. Still accepted as input; reads as milestone. */
export const LEGACY_EPIC_KIND = 'epic';

/** A kind as callers may pass it: canonical, or the legacy `epic` alias. */
export type TaskKindInput = TaskKind | typeof LEGACY_EPIC_KIND;

/** Every kind string an input may carry, legacy `epic` included. */
export const ACCEPTED_KINDS: readonly TaskKindInput[] = [
  'task',
  ...CONTAINER_KINDS,
  LEGACY_EPIC_KIND,
];

/**
 * Canonical form of a kind string: legacy `epic` becomes `milestone` (an
 * epic was always the milestone-level grouping), anything else passes
 * through. Applied at every read and write boundary, like canonicalStatus.
 */
export function canonicalKind(raw: string): string {
  return raw === LEGACY_EPIC_KIND ? 'milestone' : raw;
}

/** A container by kind alone: initiative, project, milestone (or legacy epic). */
export function isContainerKind(kind: string): boolean {
  return (CONTAINER_KINDS as readonly string[]).includes(canonicalKind(kind));
}

/** Ids that some task in `tasks` names as its parent. */
export function parentIdsOf(
  tasks: Iterable<{ meta: { parent: string | null } }>
): Set<string> {
  const ids = new Set<string>();
  for (const t of tasks) if (t.meta.parent !== null) ids.add(t.meta.parent);
  return ids;
}

/**
 * Whether a task can fan out: a container kind, or anything with children.
 * `parentIds` is `parentIdsOf(allTasks)`; omitted, only the kind counts.
 */
export function isContainer(
  meta: { id: string; kind: string },
  parentIds?: ReadonlySet<string>
): boolean {
  return isContainerKind(meta.kind) || (parentIds?.has(meta.id) ?? false);
}

/**
 * Whether children of a parent with this kind stack on its integration
 * branch (`epic/<id>`). Milestones (legacy epics) and parent issues do;
 * projects and initiatives are too broad to share one branch.
 */
export function usesIntegrationBranch(parentKind: string): boolean {
  const kind = canonicalKind(parentKind);
  return kind === 'milestone' || kind === 'task';
}

const KIND_RANK: Record<string, number> = {
  task: 0,
  milestone: 1,
  project: 2,
  initiative: 3,
};

/**
 * Whether `parentKind` may parent `childKind` in the hierarchy: a strictly
 * broader kind, or a task under a task (a sub-issue).
 */
export function isValidParentKind(
  childKind: string,
  parentKind: string
): boolean {
  const child = KIND_RANK[canonicalKind(childKind)] ?? 0;
  const parent = KIND_RANK[canonicalKind(parentKind)] ?? 0;
  return parent > child || (child === 0 && parent === 0);
}

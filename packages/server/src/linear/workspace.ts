// The per-pass picture of the linked team: its workflow states mirrored into
// the project's statuses, its users folded into the people registry, and the
// mapping context every field projection reads.
import {
  defaultStatusRoles,
  labelKey,
  loadConfig,
  migrateStatus,
  parseLinearExternal,
  peopleIndex,
  reconcileStatusRoles,
  resolvePeople,
  statusesFromWorkflowStates,
  statusModelOf,
  statusRenames,
  syncLinearPeople,
  updateConfig,
} from '@dispatch/core';
import type {
  DispatchConfig,
  LinearLabel,
  LinearMapContext,
  LinearProjectStatus,
  LinearUser,
  LinearWorkflowState,
  StatusDefinition,
  StatusRoles,
  TaskDoc,
  TaskMeta,
  TaskStorePort,
} from '@dispatch/core';

import { rosterMembers } from '../api/people.js';
import type { LinearSyncState } from './state.js';

/** A mapping context whose indexes the pass keeps current as it writes. */
export interface PassContext extends LinearMapContext {
  tasks: Map<string, TaskMeta>;
  taskByRemote: Map<string, string>;
  labels: Map<string, LinearLabel>;
  labelsById: Map<string, LinearLabel>;
}

function sameDefinitions(
  a: readonly StatusDefinition[] | undefined,
  b: readonly StatusDefinition[]
): boolean {
  return (
    a !== undefined &&
    a.length === b.length &&
    a.every(
      (d, i) =>
        d.name === b[i].name &&
        d.type === b[i].type &&
        (d.color ?? null) === (b[i].color ?? null)
    )
  );
}

function sameRoles(a: StatusRoles | undefined, b: StatusRoles): boolean {
  return (
    a !== undefined &&
    a.ready === b.ready &&
    a.dispatched === b.dispatched &&
    a.review === b.review &&
    a.landing === b.landing &&
    a.landed === b.landed &&
    a.dropped === b.dropped
  );
}

export interface StatusRegeneration {
  config: DispatchConfig;
  /** Whether config.yml was rewritten. */
  configChanged: boolean;
  /** Tasks whose status moved to the new vocabulary. */
  migrated: string[];
}

/**
 * Makes the project's statuses the team's workflow states (names, types,
 * colors, order) and its roles the generated defaults plus any user override,
 * then moves every task whose status left the vocabulary onto its successor.
 * A migration is bookkeeping, so it keeps each task's `updated`.
 */
export function regenerateStatuses(
  rootDir: string,
  store: TaskStorePort,
  docs: Map<string, TaskDoc>,
  state: LinearSyncState,
  states: readonly LinearWorkflowState[]
): StatusRegeneration {
  const config = loadConfig(rootDir);
  const generated = statusesFromWorkflowStates(states);
  if (generated.definitions.length === 0) {
    return { config, configChanged: false, migrated: [] };
  }
  const names = generated.definitions.map((d) => d.name);
  const renames = statusRenames(state.stateNames, generated.names);
  const fresh = defaultStatusRoles(generated.definitions);
  const roles = reconcileStatusRoles(
    config.statusRoles,
    state.generatedRoles,
    fresh,
    names,
    renames
  );
  state.stateNames = generated.names;
  state.generatedRoles = fresh;
  if (
    sameDefinitions(config.statusDefinitions, generated.definitions) &&
    sameRoles(config.statusRoles, roles)
  ) {
    return { config, configChanged: false, migrated: [] };
  }
  const before = statusModelOf(config);
  const after = { definitions: generated.definitions, roles };
  const next = updateConfig(rootDir, {
    statuses: generated.definitions.map((d) => ({
      name: d.name,
      type: d.type,
      color: d.color,
    })),
    statusRoles: roles,
  });
  const migrated: string[] = [];
  for (const doc of docs.values()) {
    const status = migrateStatus(doc.meta.status, {
      renames,
      before,
      after,
      legacyMap: config.linear.statusMap,
      states,
      names: generated.names,
    });
    if (status === doc.meta.status) continue;
    const moved = store.update(doc.meta.id, { status }, doc.meta.updated);
    docs.set(moved.meta.id, moved);
    migrated.push(moved.meta.id);
  }
  return { config: next, configChanged: true, migrated };
}

/**
 * Folds the team's users into `people:`, the API key's own user as the local
 * human. Returns the config as it stands afterwards and whether it changed.
 */
export function syncPeople(
  rootDir: string,
  config: DispatchConfig,
  users: readonly LinearUser[],
  viewerId: string,
  localRef: string
): { config: DispatchConfig; changed: boolean } {
  const configured = config.people ?? [];
  const result = syncLinearPeople({
    configured,
    known: resolvePeople(configured, rosterMembers(rootDir)),
    users,
    viewerId,
    localRef,
  });
  if (!result.changed) return { config, changed: false };
  return {
    config: updateConfig(rootDir, { people: result.configured }),
    changed: true,
  };
}

/** The mapping context over the pass's task snapshot. */
export function buildContext(
  rootDir: string,
  config: DispatchConfig,
  state: LinearSyncState,
  docs: Map<string, TaskDoc>,
  labels: readonly LinearLabel[],
  projectStatuses: readonly LinearProjectStatus[],
  localRef: string
): PassContext {
  const tasks = new Map<string, TaskMeta>();
  const taskByRemote = new Map<string, string>();
  for (const doc of docs.values()) {
    tasks.set(doc.meta.id, doc.meta);
    const ref = parseLinearExternal(doc.meta.external);
    if (ref !== null) taskByRemote.set(ref.id, doc.meta.id);
  }
  const statusByState = new Map(Object.entries(state.stateNames));
  const stateByStatus = new Map(
    Object.entries(state.stateNames).map(([id, name]) => [name, id])
  );
  const people = resolvePeople(config.people ?? [], rosterMembers(rootDir));
  return {
    tasks,
    taskByRemote,
    statusByState,
    stateByStatus,
    model: statusModelOf(config),
    people: peopleIndex(people, localRef),
    labels: new Map(labels.map((l) => [labelKey(l).toLowerCase(), l])),
    labelsById: new Map(labels.map((l) => [l.id, l])),
    includeAcceptanceCriteria: config.linear.includeAcceptanceCriteria,
    projectStatuses,
  };
}

/** Keeps the context's indexes in step with a task the pass just wrote. */
export function track(ctx: PassContext, doc: TaskDoc): void {
  ctx.tasks.set(doc.meta.id, doc.meta);
  const ref = parseLinearExternal(doc.meta.external);
  if (ref !== null) ctx.taskByRemote.set(ref.id, doc.meta.id);
}

/** Refreshes the people index after `people:` changed mid-pass. */
export function refreshPeople(
  rootDir: string,
  ctx: PassContext,
  config: DispatchConfig
): void {
  ctx.people = peopleIndex(
    resolvePeople(config.people ?? [], rosterMembers(rootDir)),
    ctx.people.localRef
  );
}

/** Adds a label the pass created to the context. */
export function trackLabel(ctx: PassContext, label: LinearLabel): void {
  ctx.labels.set(labelKey(label).toLowerCase(), label);
  ctx.labelsById.set(label.id, label);
}

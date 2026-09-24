// A linked team's workflow states as the project's statuses: one status per
// state, same name, type, color and order, so a custom state round-trips
// exactly. Pure: no node:* imports.
import type { LinearWorkflowState } from './linearMap.js';
import { resolveWorkflowState } from './linearMap.js';
import type {
  StatusDefinition,
  StatusModel,
  StatusRoles,
  StatusType,
} from './status.js';
import {
  canonicalStatus,
  STATUS_ROLE_KEYS,
  STATUS_TYPES,
  statusesOfType,
  statusType,
} from './status.js';

/** The statuses a team's states generate, and which state each one is. */
export interface GeneratedStatuses {
  definitions: StatusDefinition[];
  /** Workflow state id -> status name. */
  names: Record<string, string>;
}

/** A Linear state type as a status type; `duplicate` is a kind of canceled. */
export function statusTypeOfState(type: string): StatusType {
  if (type === 'duplicate') return 'canceled';
  return (STATUS_TYPES as readonly string[]).includes(type)
    ? (type as StatusType)
    : 'backlog';
}

// A state named like a legacy alias (`done`, `todo`) would be rewritten to a
// built-in on every read, so it keeps Linear's name with a capital instead.
function safeName(raw: string): string {
  const name = raw.trim() === '' ? 'Untitled' : raw.trim();
  if (canonicalStatus(name) === name) return name;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** Statuses in Linear's board order: by type, then position within the type. */
export function statusesFromWorkflowStates(
  states: readonly LinearWorkflowState[]
): GeneratedStatuses {
  const order = (s: LinearWorkflowState) =>
    STATUS_TYPES.indexOf(statusTypeOfState(s.type));
  const sorted = [...states].sort((a, b) => {
    const byType = order(a) - order(b);
    if (byType !== 0) return byType;
    const byPosition = (a.position ?? 0) - (b.position ?? 0);
    return byPosition !== 0 ? byPosition : a.name.localeCompare(b.name);
  });
  const used = new Set<string>();
  const definitions: StatusDefinition[] = [];
  const names: Record<string, string> = {};
  for (const state of sorted) {
    const base = safeName(state.name);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base} (${n})`;
    used.add(name);
    names[state.id] = name;
    definitions.push({
      name,
      type: statusTypeOfState(state.type),
      color: state.color ?? null,
    });
  }
  return { definitions, names };
}

/**
 * The lifecycle roles a generated status list implies: runs start in the first
 * started state, review lands in the first started state named like "review"
 * (else the first started one), work merges into the first completed state and
 * is dropped into the first canceled one. Landing is a run fact, not a status.
 */
export function defaultStatusRoles(
  definitions: readonly StatusDefinition[]
): StatusRoles {
  const ofType = (type: StatusType) =>
    definitions.filter((d) => d.type === type).map((d) => d.name);
  const first = (...types: StatusType[]) => {
    for (const type of types) {
      const hit = ofType(type)[0];
      if (hit !== undefined) return hit;
    }
    return definitions[0]?.name ?? '';
  };
  const dispatched = first('started', 'unstarted');
  return {
    ready: first('unstarted', 'backlog', 'triage'),
    dispatched,
    review:
      ofType('started').find((name) => /review/i.test(name)) ?? dispatched,
    landing: null,
    landed: first('completed'),
    dropped: first('canceled', 'completed'),
  };
}

/**
 * The roles to write after regenerating statuses. A role the user changed away
 * from what the last generation wrote is an override and survives, following a
 * rename, as long as it still names a status; everything else takes the fresh
 * default. With no previous generation (the first link) there are no overrides.
 */
export function reconcileStatusRoles(
  current: StatusRoles | undefined,
  lastGenerated: StatusRoles | null,
  fresh: StatusRoles,
  names: readonly string[],
  renames: ReadonlyMap<string, string>
): StatusRoles {
  if (current === undefined || lastGenerated === null) return { ...fresh };
  const valid = new Set(names);
  const out: StatusRoles = { ...fresh };
  for (const key of STATUS_ROLE_KEYS) {
    const mine = current[key];
    if (mine === lastGenerated[key]) continue;
    if (mine === null) {
      if (key === 'landing') out.landing = null;
      continue;
    }
    const renamed = renames.get(mine) ?? mine;
    if (!valid.has(renamed)) continue;
    if (key === 'landing') out.landing = renamed;
    else out[key] = renamed;
  }
  return out;
}

/** Old status name -> new, for every state whose generated name changed. */
export function statusRenames(
  previous: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>
): Map<string, string> {
  const renames = new Map<string, string>();
  for (const [stateId, before] of Object.entries(previous)) {
    const after = next[stateId];
    if (after !== undefined && after !== before) renames.set(before, after);
  }
  return renames;
}

/** Everything `migrateStatus` needs about the old and new vocabularies. */
export interface StatusMigration {
  renames: ReadonlyMap<string, string>;
  /** The model statuses were read under before this generation. */
  before: StatusModel;
  /** The model being written. */
  after: StatusModel;
  /** The pre-generation `linear.statusMap` (status -> state name or type). */
  legacyMap: Readonly<Record<string, string>>;
  states: readonly LinearWorkflowState[];
  names: Readonly<Record<string, string>>;
}

/**
 * The status a task should hold under the new vocabulary: its renamed state,
 * then itself if still defined, then where the old status map pointed, then
 * the status holding the same lifecycle role, then the first of the same type,
 * then the ready role.
 */
export function migrateStatus(status: string, m: StatusMigration): string {
  const valid = new Set(m.after.definitions.map((d) => d.name));
  const renamed = m.renames.get(status);
  if (renamed !== undefined) return renamed;
  if (valid.has(status)) return status;
  const mapped = resolveWorkflowState(status, { ...m.legacyMap }, [
    ...m.states,
  ]);
  const mappedName = mapped === null ? undefined : m.names[mapped.id];
  if (mappedName !== undefined && valid.has(mappedName)) return mappedName;
  for (const key of STATUS_ROLE_KEYS) {
    if (m.before.roles[key] !== status) continue;
    const target = m.after.roles[key];
    if (target !== null && valid.has(target)) return target;
  }
  const sameType = statusesOfType(statusType(status, m.before), m.after)[0];
  return sameType ?? m.after.roles.ready;
}

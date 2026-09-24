import type { CreateInput, UpdatePatch } from './store.js';
import type { Priority, TaskCycle, TaskDoc } from './types.js';

/** One Linear workflow state. `type` is the fixed semantic bucket; `name` is per-team config. */
export interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
  /** `#rrggbb`; absent on callers that only need the name and type. */
  color?: string;
  /** Board order within the team. */
  position?: number;
}

export interface LinearLabel {
  id: string;
  name: string;
  color?: string;
  /** The group label's name, for a label nested in a group. */
  group?: string | null;
  /** The owning team, or null for a workspace label. */
  teamId?: string | null;
}

/** A workspace member. `displayName` is Linear's short handle. */
export interface LinearUser {
  id: string;
  name: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  active: boolean;
}

/** One relation, normalized so `issueId` is always the source side
 *  (`issueId` blocks / duplicates / relates to `relatedIssueId`). */
export interface LinearRelation {
  id: string;
  type: string;
  issueId: string;
  relatedIssueId: string;
}

/** A link attached to an issue. `url` is unique per issue. */
export interface LinearAttachment {
  id: string;
  title: string;
  url: string;
  subtitle: string | null;
  sourceType: string | null;
}

/** A nested list the fetch cut short; that field is not trusted this pass. */
export type LinearTruncatedField =
  | 'labels'
  | 'relations'
  | 'attachments'
  | 'children';

/** The Issue fields this sync reads. `id` is the stable UUID; `identifier` is display-only. */
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  estimate: number | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /** ISO date (TimelessDate). */
  dueDate: string | null;
  state: LinearWorkflowState | null;
  labels: LinearLabel[];
  team: { id: string; key: string } | null;
  assigneeId: string | null;
  creatorId: string | null;
  cycle: TaskCycle | null;
  projectId: string | null;
  projectMilestoneId: string | null;
  parentId: string | null;
  childIds: string[];
  /** Outgoing and inverse relations together, one entry per relation id. */
  relations: LinearRelation[];
  attachments: LinearAttachment[];
  truncated: LinearTruncatedField[];
}

/** A comment on an issue; `parentId` threads a reply under its parent. */
export interface LinearComment {
  id: string;
  issueId: string;
  body: string;
  userId: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/** A project status: one of the workspace's, bucketed by `type`
 *  (backlog | planned | started | paused | completed | canceled). */
export interface LinearProjectStatus {
  id: string;
  name: string;
  type: string;
  color?: string;
  position?: number;
}

/** A Linear project. `summary` is the short description; `content` the long markdown. */
export interface LinearProject {
  id: string;
  name: string;
  summary: string;
  content: string | null;
  icon: string | null;
  color: string | null;
  startDate: string | null;
  targetDate: string | null;
  leadId: string | null;
  status: LinearProjectStatus | null;
  priority: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  teamIds: string[];
  /** Membership rows (the join entity's id and the initiative), in Linear's order. */
  initiatives: { id: string; initiativeId: string }[];
}

export interface LinearProjectMilestone {
  id: string;
  name: string;
  description: string | null;
  targetDate: string | null;
  sortOrder: number;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/** An initiative. `status` is Linear's PascalCase enum (Planned, Active, …). */
export interface LinearInitiative {
  id: string;
  name: string;
  description: string | null;
  content: string | null;
  ownerId: string | null;
  creatorId: string | null;
  status: string;
  targetDate: string | null;
  color: string | null;
  icon: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/** Issue mutation input. `null` clears a field; an absent key leaves it alone. */
export interface LinearIssueInput {
  teamId?: string;
  title?: string;
  description?: string;
  priority?: number;
  estimate?: number | null;
  stateId?: string;
  assigneeId?: string | null;
  labelIds?: string[];
  dueDate?: string | null;
  cycleId?: string | null;
  projectId?: string | null;
  projectMilestoneId?: string | null;
  parentId?: string | null;
}

export interface LinearProjectInput {
  name?: string;
  content?: string;
  leadId?: string | null;
  statusId?: string;
  startDate?: string | null;
  targetDate?: string | null;
  color?: string;
  icon?: string | null;
  priority?: number;
  teamIds?: string[];
}

export interface LinearMilestoneInput {
  name?: string;
  description?: string;
  targetDate?: string | null;
  projectId?: string;
}

export interface LinearInitiativeInput {
  name?: string;
  content?: string;
  ownerId?: string | null;
  status?: string;
  targetDate?: string | null;
  color?: string;
  icon?: string | null;
}

export const LINEAR_EXTERNAL_PREFIX = 'linear:';

/** The value stored in `TaskMeta.external` for a Linear issue — always keyed by the UUID. */
export function externalId(issue: { id: string }): string {
  return `${LINEAR_EXTERNAL_PREFIX}${issue.id}`;
}

/** The Linear issue UUID inside an `external` value, or null when it names another system. */
export function parseExternal(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith(LINEAR_EXTERNAL_PREFIX)) return null;
  const id = value.slice(LINEAR_EXTERNAL_PREFIX.length).trim();
  return id === '' ? null : id;
}

/** The Linear record kinds a task can mirror. */
export type LinearEntity = 'issue' | 'project' | 'milestone' | 'initiative';

/** A task's link to one Linear record. */
export interface LinearRef {
  entity: LinearEntity;
  id: string;
}

// Issues keep the historical `linear:` prefix; containers get their own so an
// `external` value alone says which API a push goes to.
const ENTITY_PREFIXES: readonly [LinearEntity, string][] = [
  ['issue', LINEAR_EXTERNAL_PREFIX],
  ['project', 'linear-project:'],
  ['milestone', 'linear-milestone:'],
  ['initiative', 'linear-initiative:'],
];

/** The `TaskMeta.external` value for a Linear record of any kind. */
export function linearExternal(ref: LinearRef): string {
  const prefix = ENTITY_PREFIXES.find(([entity]) => entity === ref.entity);
  return `${prefix?.[1] ?? LINEAR_EXTERNAL_PREFIX}${ref.id}`;
}

/** The Linear record an `external` value names, of any kind, or null. */
export function parseLinearExternal(
  value: string | null | undefined
): LinearRef | null {
  if (typeof value !== 'string') return null;
  for (const [entity, prefix] of ENTITY_PREFIXES) {
    if (!value.startsWith(prefix)) continue;
    const id = value.slice(prefix.length).trim();
    return id === '' ? null : { entity, id };
  }
  return null;
}

// Linear's priority is an Int where 0 means "unset" and 1 is the most urgent —
// so it is not an ordering the local scale can be compared against directly.
const PRIORITY_TO_LINEAR: Record<Priority, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
  none: 0,
};

const LINEAR_TO_PRIORITY: Record<number, Priority> = {
  0: 'none',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
};

export function priorityToLinear(priority: Priority): number {
  return PRIORITY_TO_LINEAR[priority] ?? 0;
}

export function priorityFromLinear(value: number): Priority {
  return LINEAR_TO_PRIORITY[value] ?? 'none';
}

/** Default dispatch-status -> Linear-state mapping, matching Linear's out-of-the-box state names. */
export const DEFAULT_STATUS_MAP: Record<string, string> = {
  draft: 'Backlog',
  ready: 'Todo',
  working: 'In Progress',
  review: 'In Review',
  // Linear has no landing lane; In Review is the closest started-category
  // state for "approved, merging".
  landing: 'In Review',
  landed: 'Done',
  dropped: 'Canceled',
};

// Fallback for a Linear state the configured map says nothing about: its `type`
// is a fixed enum, so it always yields a sensible local status.
const STATUS_BY_STATE_TYPE: Record<string, string> = {
  backlog: 'draft',
  triage: 'ready',
  unstarted: 'ready',
  started: 'working',
  completed: 'landed',
  canceled: 'dropped',
  duplicate: 'dropped',
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** The Linear state a dispatch status maps to, matched by state name then by `type`.
 *  Null when nothing matches, which callers treat as "leave the state alone". */
export function resolveWorkflowState(
  status: string,
  statusMap: Record<string, string>,
  states: LinearWorkflowState[]
): LinearWorkflowState | null {
  const target = statusMap[status];
  if (target === undefined || target.trim() === '') return null;
  const wanted = normalize(target);
  return (
    states.find((s) => normalize(s.name) === wanted) ??
    states.find((s) => normalize(s.type) === wanted) ??
    null
  );
}

/** The reverse direction: the configured map inverted, then the state's `type`, then
 *  `fallback` — so a renamed state never writes a status the project does not define. */
export function statusFromState(
  state: LinearWorkflowState | null,
  statusMap: Record<string, string>,
  statuses: readonly string[],
  fallback: string
): string {
  const valid = (candidate: string | undefined): string | null =>
    candidate !== undefined && statuses.includes(candidate) ? candidate : null;
  if (state === null) return fallback;
  const byName = Object.keys(statusMap).find(
    (key) =>
      normalize(statusMap[key]) === normalize(state.name) ||
      normalize(statusMap[key]) === normalize(state.type)
  );
  return (
    valid(byName) ??
    valid(STATUS_BY_STATE_TYPE[normalize(state.type)]) ??
    fallback
  );
}

/** Everything the two `taskFromIssue` directions need that is not on the issue itself. */
export interface TaskMapContext {
  statusMap: Record<string, string>;
  statuses: readonly string[];
  /** Status used when the issue's state maps to nothing the project defines. */
  fallbackStatus: string;
}

/** A Linear issue as a brand-new local task. */
export function taskCreateFromIssue(
  issue: LinearIssue,
  ctx: TaskMapContext
): CreateInput {
  return {
    title: issue.title,
    status: statusFromState(
      issue.state,
      ctx.statusMap,
      ctx.statuses,
      ctx.fallbackStatus
    ),
    description: issue.description ?? '',
    labels: issue.labels.map((l) => l.name),
    priority: priorityFromLinear(issue.priority),
  };
}

/** A Linear issue as a patch over an existing local task. */
export function taskPatchFromIssue(
  issue: LinearIssue,
  ctx: TaskMapContext
): UpdatePatch {
  return {
    title: issue.title,
    status: statusFromState(
      issue.state,
      ctx.statusMap,
      ctx.statuses,
      ctx.fallbackStatus
    ),
    description: issue.description ?? '',
    labels: issue.labels.map((l) => l.name),
    priority: priorityFromLinear(issue.priority),
  };
}

/** Everything `issueFromTask` needs beyond the task: the team, its states and its labels. */
export interface IssueMapContext {
  teamId: string;
  statusMap: Record<string, string>;
  states: LinearWorkflowState[];
  labels: LinearLabel[];
  /** The task body's `## Description` section, already extracted by the caller. */
  description: string;
}

/** A local task as Linear mutation input. Labels are matched by name against the team's
 *  own labels; unknown ones are dropped rather than created. */
export function issueFromTask(
  doc: TaskDoc,
  ctx: IssueMapContext
): LinearIssueInput {
  const state = resolveWorkflowState(
    doc.meta.status,
    ctx.statusMap,
    ctx.states
  );
  const labelIds = doc.meta.labels
    .map(
      (name) =>
        ctx.labels.find((l) => normalize(l.name) === normalize(name))?.id
    )
    .filter((id): id is string => id !== undefined);
  return {
    teamId: ctx.teamId,
    title: doc.meta.title,
    description: ctx.description,
    priority: priorityToLinear(doc.meta.priority),
    ...(state === null ? {} : { stateId: state.id }),
    ...(labelIds.length === 0 ? {} : { labelIds }),
  };
}

/** Which side of a link has the newer edit. Ties and unparseable timestamps resolve to
 *  `'none'`, so an ambiguous comparison never triggers a write in either direction. */
export function resolveConflict(
  localUpdated: string,
  remoteUpdated: string
): 'local' | 'remote' | 'none' {
  const local = Date.parse(localUpdated);
  const remote = Date.parse(remoteUpdated);
  if (Number.isNaN(local) || Number.isNaN(remote)) return 'none';
  if (local > remote) return 'local';
  if (remote > local) return 'remote';
  return 'none';
}

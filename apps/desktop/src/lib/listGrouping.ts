import type { Assignee, Priority, TaskDoc } from '@dispatch/core/browser';
import { isDoneStatus, PRIORITY_ORDER } from '@dispatch/core/browser';

import { statusColor } from '../components/tasks/StatusIcon';
import { rollupMilestoneStatus } from './milestoneRollup';
import { colorForEpic } from './projectColor';
import {
  assigneeLabel,
  assigneeRef,
  priorityLabel,
  statusLabel,
} from './taskDisplay';
import type { TasksDisplayPrefs, TasksGrouping } from './tasksPrefs';

/**
 * The list's grouping model: `groupTasks` turns the visible tasks plus the display prefs into
 * the ordered sections the list (and the Milestones page) render — one `GroupHeader` per
 * group over a run of `ListRow`s. Every grouping (status, epic, milestone, assignee,
 * priority, none) comes out in the same shape so the view has one rendering path, and the
 * ordering / completed-by-recency / nested-sub-task rules apply identically to all of them.
 */

/** What the group's 14px glyph is — the view maps this to a `StatusIcon`, an epic swatch, a
 * milestone target, an avatar or a priority glyph. */
export type GroupIcon =
  | { kind: 'status'; status: string }
  | { kind: 'epic'; epicId: string | null }
  | { kind: 'milestone'; status: string }
  | { kind: 'assignee'; assignee: Assignee }
  | { kind: 'priority'; priority: Priority }
  | null;

export interface ListGroupRow {
  doc: TaskDoc;
  /** `1` nests the row under its parent, which is the row directly above it (or above its
   * indented siblings). */
  indent: 0 | 1;
}

export interface ListGroup {
  /** Stable across renders and groupings — `status:ready`, `epic:e-1`, `epic:none`,
   * `assignee:agent`, `priority:high`, `all`, `archived`. Collapse state is keyed by it. */
  key: string;
  kind: TasksGrouping | 'archived';
  label: string;
  /** The status colour the header's left edge picks up, or none for a neutral bar. */
  tint: string | null;
  icon: GroupIcon;
  rows: ListGroupRow[];
  /** What a `+` on this header pre-fills into the task creator. */
  preset: { status?: string; epic?: string; milestone?: string };
  /** The epic this group stands for, when it stands for one — the dependency-graph button
   * and the milestone's "open" affordance key off it. */
  epicId: string | null;
  /** Rows in the trailing "Archived" section render read-only. */
  archived: boolean;
}

export interface GroupContext {
  /** The project's statuses in config order — status groups follow it. */
  statuses: readonly string[];
  /** The project's epics in their own order — epic and milestone groups follow it. */
  epics: readonly TaskDoc[];
  /** Appended as a trailing `Archived` group when non-empty (the "Show archived" toggle). */
  archivedTasks?: readonly TaskDoc[];
}

const NO_EPIC_KEY = 'epic:none';
const ARCHIVED_KEY = 'archived';

function byDateDesc(field: 'updated' | 'created') {
  return (a: TaskDoc, b: TaskDoc) =>
    Date.parse(b.meta[field]) - Date.parse(a.meta[field]);
}

// Each ordering's natural comparator: urgent first, newest first, A→Z. `manual` keeps the
// input order (the tracker's own file order).
function comparatorFor(
  prefs: TasksDisplayPrefs
): ((a: TaskDoc, b: TaskDoc) => number) | null {
  switch (prefs.ordering) {
    case 'priority':
      return (a, b) =>
        PRIORITY_ORDER[a.meta.priority] - PRIORITY_ORDER[b.meta.priority];
    case 'updated':
      return byDateDesc('updated');
    case 'created':
      return byDateDesc('created');
    case 'title':
      return (a, b) => a.meta.title.localeCompare(b.meta.title);
    case 'manual':
      return null;
  }
}

/** Orders one group's tasks by `ordering`/`orderDir`, then — when `completedByRecency` —
 * sinks landed/dropped tasks to the bottom, most recently updated first. Stable: ties keep
 * their input order. */
export function sortTasks(
  tasks: TaskDoc[],
  prefs: TasksDisplayPrefs
): TaskDoc[] {
  const compare = comparatorFor(prefs);
  const sign = prefs.orderDir === 'desc' ? -1 : 1;
  const decorated = tasks.map((doc, index) => ({ doc, index }));
  if (compare !== null) {
    decorated.sort((a, b) => {
      const cmp = compare(a.doc, b.doc) * sign;
      return cmp !== 0 ? cmp : a.index - b.index;
    });
  }
  const sorted = decorated.map((d) => d.doc);
  if (!prefs.completedByRecency) return sorted;
  const open = sorted.filter((doc) => !isDoneStatus(doc.meta.status));
  const done = sorted
    .filter((doc) => isDoneStatus(doc.meta.status))
    .map((doc, index) => ({ doc, index }))
    .sort((a, b) => {
      const cmp = byDateDesc('updated')(a.doc, b.doc);
      return cmp !== 0 ? cmp : a.index - b.index;
    })
    .map((d) => d.doc);
  return [...open, ...done];
}

/** Lays a sorted group out as rows: with `nestedSubtasks`, a task whose parent is also in
 * the group moves directly under that parent at indent 1 (children keep their sorted order);
 * otherwise every task is a top-level row in sorted order. */
export function nestRows(
  sorted: TaskDoc[],
  prefs: TasksDisplayPrefs
): ListGroupRow[] {
  if (!prefs.nestedSubtasks) {
    return sorted.map((doc) => ({ doc, indent: 0 }));
  }
  const present = new Set(sorted.map((doc) => doc.meta.id));
  const childrenByParent = new Map<string, TaskDoc[]>();
  const top: TaskDoc[] = [];
  for (const doc of sorted) {
    const parent = doc.meta.parent;
    if (parent !== null && present.has(parent) && parent !== doc.meta.id) {
      const bucket = childrenByParent.get(parent);
      if (bucket !== undefined) bucket.push(doc);
      else childrenByParent.set(parent, [doc]);
    } else {
      top.push(doc);
    }
  }
  const rows: ListGroupRow[] = [];
  for (const doc of top) {
    rows.push({ doc, indent: 0 });
    for (const child of childrenByParent.get(doc.meta.id) ?? []) {
      rows.push({ doc: child, indent: 1 });
    }
  }
  return rows;
}

// A sub-task is a task whose parent is another *task* — an epic's children are its members,
// not sub-tasks (Linear's project members vs sub-issues), so `showSubtasks: false` leaves an
// epic-grouped list intact.
function isSubtask(doc: TaskDoc, epicIds: ReadonlySet<string>): boolean {
  return doc.meta.parent !== null && !epicIds.has(doc.meta.parent);
}

interface Bucket {
  key: string;
  label: string;
  tint: string | null;
  icon: GroupIcon;
  preset: ListGroup['preset'];
  epicId: string | null;
  tasks: TaskDoc[];
}

function bucket(fields: Omit<Bucket, 'tasks'>, tasks: TaskDoc[] = []): Bucket {
  return { ...fields, tasks };
}

// Buckets by status in config order, with a trailing bucket per status the config does not
// list but a task still carries (a renamed status must not vanish from the list).
function byStatus(tasks: TaskDoc[], ctx: GroupContext): Bucket[] {
  const buckets = new Map<string, Bucket>();
  const add = (status: string) =>
    buckets.set(
      status,
      bucket({
        key: `status:${status}`,
        label: statusLabel(status),
        tint: statusColor(status),
        icon: { kind: 'status', status },
        preset: { status },
        epicId: null,
      })
    );
  for (const status of ctx.statuses) add(status);
  for (const doc of tasks) {
    if (!buckets.has(doc.meta.status)) add(doc.meta.status);
    buckets.get(doc.meta.status)?.tasks.push(doc);
  }
  return [...buckets.values()];
}

// Buckets under each epic in project order, then dangling parent ids, then "No epic". Epic
// docs themselves are the headers, not rows. `asMilestone` swaps the epic swatch for the
// milestone target tinted by the rolled-up status and sinks finished milestones to the end.
function byEpic(
  tasks: TaskDoc[],
  ctx: GroupContext,
  asMilestone: boolean
): Bucket[] {
  const kind = asMilestone ? 'milestone' : 'epic';
  const buckets = new Map<string, Bucket>();
  const noEpic: TaskDoc[] = [];
  for (const epic of ctx.epics) {
    buckets.set(
      epic.meta.id,
      bucket({
        key: `${kind}:${epic.meta.id}`,
        label: epic.meta.title,
        tint: asMilestone ? null : colorForEpic(epic.meta.id),
        icon: asMilestone
          ? { kind: 'milestone', status: 'draft' }
          : { kind: 'epic', epicId: epic.meta.id },
        preset: asMilestone
          ? { milestone: epic.meta.id }
          : { epic: epic.meta.id },
        epicId: epic.meta.id,
      })
    );
  }
  for (const doc of tasks) {
    if (doc.meta.kind === 'epic') continue;
    const parent = doc.meta.parent;
    if (parent === null) {
      noEpic.push(doc);
      continue;
    }
    let target = buckets.get(parent);
    if (target === undefined) {
      target = bucket({
        key: `${kind}:${parent}`,
        label: parent,
        tint: null,
        icon: asMilestone
          ? { kind: 'milestone', status: 'draft' }
          : { kind: 'epic', epicId: parent },
        preset: asMilestone ? { milestone: parent } : { epic: parent },
        epicId: parent,
      });
      buckets.set(parent, target);
    }
    target.tasks.push(doc);
  }
  let result = [...buckets.values()];
  if (asMilestone) {
    for (const b of result) {
      const rollup = rollupMilestoneStatus(b.tasks);
      b.icon = { kind: 'milestone', status: rollup };
      b.tint = statusColor(rollup);
    }
    result = [
      ...result.filter((b) => !isFinishedBucket(b)),
      ...result.filter(isFinishedBucket),
    ];
  }
  if (noEpic.length > 0) {
    result.push(
      bucket(
        {
          key: NO_EPIC_KEY,
          label: asMilestone ? 'No milestone' : 'No epic',
          tint: null,
          icon: { kind: 'epic', epicId: null },
          preset: {},
          epicId: null,
        },
        noEpic
      )
    );
  }
  return result;
}

function isFinishedBucket(b: Bucket): boolean {
  return b.tasks.length > 0 && rollupMilestoneStatus(b.tasks) === 'landed';
}

// Agents first, then people by handle, then unassigned.
function byAssignee(tasks: TaskDoc[]): Bucket[] {
  const buckets = new Map<string, Bucket>();
  for (const doc of tasks) {
    const assignee = doc.meta.assignee;
    let target = buckets.get(assignee);
    if (target === undefined) {
      target = bucket({
        key: `assignee:${assignee}`,
        label: assigneeLabel(assignee),
        tint: null,
        icon: { kind: 'assignee', assignee },
        preset: {},
        epicId: null,
      });
      buckets.set(assignee, target);
    }
    target.tasks.push(doc);
  }
  const rank = (a: Assignee) => {
    const ref = assigneeRef(a);
    if (ref === null) return 2;
    return ref.kind === 'agent' ? 0 : 1;
  };
  return [...buckets.values()].sort((a, b) => {
    const ra = rank(a.tasks[0]?.meta.assignee ?? 'none');
    const rb = rank(b.tasks[0]?.meta.assignee ?? 'none');
    return ra !== rb ? ra - rb : a.label.localeCompare(b.label);
  });
}

function byPriority(tasks: TaskDoc[]): Bucket[] {
  const order = Object.keys(PRIORITY_ORDER) as Priority[];
  const buckets = new Map<Priority, Bucket>(
    order.map((priority) => [
      priority,
      bucket({
        key: `priority:${priority}`,
        label: priorityLabel(priority),
        tint: null,
        icon: { kind: 'priority', priority },
        preset: {},
        epicId: null,
      }),
    ])
  );
  for (const doc of tasks) buckets.get(doc.meta.priority)?.tasks.push(doc);
  return [...buckets.values()];
}

/** The list's sections for the current display prefs. Empty groups are dropped unless
 * `showEmptyGroups`; the `none` grouping yields one headerless group keyed `all`; archived
 * tasks (when given) trail as one read-only `archived` group. */
export function groupTasks(
  tasks: TaskDoc[],
  prefs: TasksDisplayPrefs,
  ctx: GroupContext
): ListGroup[] {
  const epicIds = new Set(ctx.epics.map((e) => e.meta.id));
  const visible = prefs.showSubtasks
    ? tasks
    : tasks.filter((doc) => !isSubtask(doc, epicIds));

  let buckets: Bucket[];
  switch (prefs.grouping) {
    case 'status':
      buckets = byStatus(visible, ctx);
      break;
    case 'epic':
      buckets = byEpic(visible, ctx, false);
      break;
    case 'milestone':
      buckets = byEpic(visible, ctx, true);
      break;
    case 'assignee':
      buckets = byAssignee(visible);
      break;
    case 'priority':
      buckets = byPriority(visible);
      break;
    case 'none':
      buckets = [
        bucket(
          {
            key: 'all',
            label: '',
            tint: null,
            icon: null,
            preset: {},
            epicId: null,
          },
          visible
        ),
      ];
      break;
  }

  const groups: ListGroup[] = buckets
    .filter((b) => prefs.showEmptyGroups || b.tasks.length > 0)
    .map((b) => ({
      key: b.key,
      kind: prefs.grouping,
      label: b.label,
      tint: b.tint,
      icon: b.icon,
      rows: nestRows(sortTasks(b.tasks, prefs), prefs),
      preset: b.preset,
      epicId: b.epicId,
      archived: false,
    }));

  const archived = ctx.archivedTasks ?? [];
  if (archived.length > 0) {
    groups.push({
      key: ARCHIVED_KEY,
      kind: 'archived',
      label: 'Archived',
      tint: null,
      icon: null,
      rows: nestRows(sortTasks([...archived], prefs), prefs),
      preset: {},
      epicId: null,
      archived: true,
    });
  }
  return groups;
}

/** Every row id in reading order, skipping collapsed groups — the j/k traversal order. */
export function visibleRowIds(
  groups: ListGroup[],
  collapsed: ReadonlySet<string>
): string[] {
  return groups.flatMap((g) =>
    collapsed.has(g.key) ? [] : g.rows.map((r) => r.doc.meta.id)
  );
}

import type { TaskDoc } from '@dispatch/core/browser';
import { describe, expect, test } from 'bun:test';

import { groupTasks, nestRows, sortTasks, visibleRowIds } from './listGrouping';
import { DEFAULT_TASKS_DISPLAY, type TasksDisplayPrefs } from './tasksPrefs';

type Meta = TaskDoc['meta'];

function task(id: string, overrides: Partial<Meta> = {}, title = id): TaskDoc {
  return {
    meta: {
      id,
      title,
      status: 'ready',
      kind: 'task',
      parent: null,
      milestone: null,
      blockedBy: [],
      labels: [],
      priority: 'none',
      assignee: 'none',
      created: '2026-09-01T12:00:00.000Z',
      updated: '2026-09-01T12:00:00.000Z',
      external: null,
      selfReview: false,
      writes: [],
      risk: 'routine',
      model: null,
      exercised: false,
      ...overrides,
    },
    body: '',
  } as TaskDoc;
}

const STATUSES = ['draft', 'ready', 'working', 'review', 'landed', 'dropped'];

function prefs(overrides: Partial<TasksDisplayPrefs> = {}): TasksDisplayPrefs {
  return { ...DEFAULT_TASKS_DISPLAY, ...overrides };
}

describe('groupTasks by status (the default)', () => {
  test('groups follow config order, skipping empty statuses', () => {
    const groups = groupTasks(
      [task('a', { status: 'working' }), task('b', { status: 'ready' })],
      prefs(),
      { statuses: STATUSES, epics: [] }
    );
    expect(groups.map((g) => g.key)).toEqual([
      'status:ready',
      'status:working',
    ]);
    expect(groups[0]?.label).toBe('Ready');
    expect(groups[0]?.icon).toEqual({ kind: 'status', status: 'ready' });
    expect(groups[0]?.tint).toBe('var(--status-todo)');
    expect(groups[0]?.preset).toEqual({ status: 'ready' });
  });

  test('showEmptyGroups keeps every configured status', () => {
    const groups = groupTasks(
      [task('a', { status: 'ready' })],
      prefs({ showEmptyGroups: true }),
      { statuses: STATUSES, epics: [] }
    );
    expect(groups.map((g) => g.key)).toEqual(
      STATUSES.map((s) => `status:${s}`)
    );
  });

  test('a status the config no longer lists still gets a trailing group', () => {
    const groups = groupTasks([task('a', { status: 'qa' })], prefs(), {
      statuses: STATUSES,
      epics: [],
    });
    expect(groups.map((g) => g.key)).toEqual(['status:qa']);
  });

  test('archived tasks trail as one read-only group', () => {
    const groups = groupTasks([task('a')], prefs(), {
      statuses: STATUSES,
      epics: [],
      archivedTasks: [task('old')],
    });
    expect(groups.at(-1)).toMatchObject({
      key: 'archived',
      kind: 'archived',
      archived: true,
    });
    expect(groups.at(-1)?.rows.map((r) => r.doc.meta.id)).toEqual(['old']);
  });
});

describe('nested sub-tasks', () => {
  test('a child whose parent is in the same group indents under it', () => {
    const epic = task('e-1', { kind: 'epic', status: 'ready' }, 'Payments');
    const child = task('t-1', { parent: 'e-1', status: 'ready' });
    const other = task('t-2', { status: 'ready' });
    const groups = groupTasks([other, child, epic], prefs(), {
      statuses: STATUSES,
      epics: [epic],
    });
    const rows = groups[0]?.rows.map((r) => [r.doc.meta.id, r.indent]);
    expect(rows).toEqual([
      ['t-2', 0],
      ['e-1', 0],
      ['t-1', 1],
    ]);
  });

  test('a child in another group is its own top-level row', () => {
    const epic = task('e-1', { kind: 'epic', status: 'ready' });
    const child = task('t-1', { parent: 'e-1', status: 'working' });
    const groups = groupTasks([epic, child], prefs(), {
      statuses: STATUSES,
      epics: [epic],
    });
    expect(groups.map((g) => g.rows.map((r) => r.indent))).toEqual([[0], [0]]);
  });

  test('nestedSubtasks off flattens everything', () => {
    const parent = task('p');
    const child = task('c', { parent: 'p' });
    expect(nestRows([parent, child], prefs({ nestedSubtasks: false }))).toEqual(
      [
        { doc: parent, indent: 0 },
        { doc: child, indent: 0 },
      ]
    );
  });

  // Epic members are not sub-tasks; only a task under another task is.
  test('showSubtasks off hides task-under-task children but keeps epic members', () => {
    const epic = task('e-1', { kind: 'epic' });
    const member = task('t-1', { parent: 'e-1' });
    const sub = task('t-2', { parent: 't-1' });
    const groups = groupTasks(
      [epic, member, sub],
      prefs({ showSubtasks: false, nestedSubtasks: false }),
      { statuses: STATUSES, epics: [epic] }
    );
    expect(groups[0]?.rows.map((r) => r.doc.meta.id)).toEqual(['e-1', 't-1']);
  });
});

describe('groupTasks by epic and milestone', () => {
  const epic = task('e-1', { kind: 'epic' }, 'Payments');
  const tasks = [
    epic,
    task('t-1', { parent: 'e-1' }),
    task('t-2', { parent: 'ghost' }),
    task('t-3'),
  ];

  test('epic order, then dangling parents, then No epic; epic docs are headers not rows', () => {
    const groups = groupTasks(tasks, prefs({ grouping: 'epic' }), {
      statuses: STATUSES,
      epics: [epic],
    });
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['epic:e-1', 'Payments'],
      ['epic:ghost', 'ghost'],
      ['epic:none', 'No epic'],
    ]);
    expect(groups[0]?.epicId).toBe('e-1');
    expect(groups[0]?.preset).toEqual({ epic: 'e-1' });
    expect(groups[0]?.tint).toMatch(/^var\(--project-color-[1-8]\)$/);
    expect(groups.flatMap((g) => g.rows.map((r) => r.doc.meta.id))).toEqual([
      't-1',
      't-2',
      't-3',
    ]);
  });

  test('milestone grouping wears the rolled-up status and sinks finished milestones', () => {
    const done = task('e-2', { kind: 'epic' }, 'Shipped');
    const groups = groupTasks(
      [
        done,
        task('t-9', { parent: 'e-2', status: 'landed' }),
        epic,
        task('t-1', { parent: 'e-1', status: 'working' }),
      ],
      prefs({ grouping: 'milestone' }),
      { statuses: STATUSES, epics: [done, epic] }
    );
    expect(groups.map((g) => g.key)).toEqual([
      'milestone:e-1',
      'milestone:e-2',
    ]);
    expect(groups[0]?.icon).toEqual({ kind: 'milestone', status: 'working' });
    expect(groups[0]?.tint).toBe('var(--status-progress)');
    expect(groups[1]?.icon).toEqual({ kind: 'milestone', status: 'landed' });
  });
});

describe('groupTasks by assignee, priority and none', () => {
  test('assignee: agents, then people, then unassigned', () => {
    const groups = groupTasks(
      [
        task('a', { assignee: 'none' }),
        task('b', { assignee: 'human' }),
        task('c', { assignee: 'agent' }),
      ],
      prefs({ grouping: 'assignee' }),
      { statuses: STATUSES, epics: [] }
    );
    expect(groups.map((g) => g.label)).toEqual([
      'Agent',
      'Human',
      'Unassigned',
    ]);
  });

  test('priority: urgent first, empties dropped unless shown', () => {
    const tasks = [
      task('a', { priority: 'low' }),
      task('b', { priority: 'urgent' }),
    ];
    expect(
      groupTasks(tasks, prefs({ grouping: 'priority' }), {
        statuses: STATUSES,
        epics: [],
      }).map((g) => g.label)
    ).toEqual(['Urgent', 'Low']);
    expect(
      groupTasks(
        tasks,
        prefs({ grouping: 'priority', showEmptyGroups: true }),
        { statuses: STATUSES, epics: [] }
      ).map((g) => g.key)
    ).toEqual([
      'priority:urgent',
      'priority:high',
      'priority:medium',
      'priority:low',
      'priority:none',
    ]);
  });

  test('none: one headerless group', () => {
    const groups = groupTasks(
      [task('a'), task('b')],
      prefs({ grouping: 'none' }),
      {
        statuses: STATUSES,
        epics: [],
      }
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'all', kind: 'none', icon: null });
  });
});

describe('sortTasks', () => {
  const urgent = task('u', {
    priority: 'urgent',
    updated: '2026-09-02T12:00:00.000Z',
  });
  const low = task('l', {
    priority: 'low',
    updated: '2026-09-03T12:00:00.000Z',
  });
  const none = task('n', {
    priority: 'none',
    updated: '2026-09-01T12:00:00.000Z',
  });

  test('priority ascending is urgent first; desc reverses', () => {
    expect(
      sortTasks([low, none, urgent], prefs()).map((t) => t.meta.id)
    ).toEqual(['u', 'l', 'n']);
    expect(
      sortTasks([low, none, urgent], prefs({ orderDir: 'desc' })).map(
        (t) => t.meta.id
      )
    ).toEqual(['n', 'l', 'u']);
  });

  test('updated is newest first; title is A→Z; manual keeps input order', () => {
    expect(
      sortTasks([urgent, low, none], prefs({ ordering: 'updated' })).map(
        (t) => t.meta.id
      )
    ).toEqual(['l', 'u', 'n']);
    const b = task('b', {}, 'Beta');
    const a = task('a', {}, 'alpha');
    expect(
      sortTasks([b, a], prefs({ ordering: 'title' })).map((t) => t.meta.id)
    ).toEqual(['a', 'b']);
    expect(
      sortTasks([low, urgent], prefs({ ordering: 'manual' })).map(
        (t) => t.meta.id
      )
    ).toEqual(['l', 'u']);
  });

  test('completedByRecency sinks landed/dropped below open rows, newest first', () => {
    const doneOld = task('d1', {
      status: 'landed',
      priority: 'urgent',
      updated: '2026-08-01T12:00:00.000Z',
    });
    const doneNew = task('d2', {
      status: 'dropped',
      priority: 'urgent',
      updated: '2026-08-05T12:00:00.000Z',
    });
    expect(
      sortTasks([doneOld, doneNew, low], prefs()).map((t) => t.meta.id)
    ).toEqual(['l', 'd2', 'd1']);
    expect(
      sortTasks(
        [doneOld, doneNew, low],
        prefs({ completedByRecency: false })
      ).map((t) => t.meta.id)
    ).toEqual(['d1', 'd2', 'l']);
  });
});

describe('visibleRowIds', () => {
  test('walks expanded groups only', () => {
    const groups = groupTasks(
      [task('a', { status: 'ready' }), task('b', { status: 'working' })],
      prefs(),
      { statuses: STATUSES, epics: [] }
    );
    expect(visibleRowIds(groups, new Set())).toEqual(['a', 'b']);
    expect(visibleRowIds(groups, new Set(['status:ready']))).toEqual(['b']);
  });
});

import type { TaskListItem } from '@dispatch/core/browser';
import { describe, expect, test } from 'bun:test';

import { childrenByParent, DIRECT_BAND, flightScope } from './flightScope';

function task(
  id: string,
  overrides: Partial<TaskListItem['meta']> = {}
): TaskListItem {
  return {
    meta: {
      id,
      title: id,
      status: 'ready',
      kind: 'task',
      parent: null,
      blockedBy: [],
      created: '2026-09-01T00:00:00.000Z',
      dueDate: null,
      ...overrides,
    },
  } as TaskListItem;
}

describe('flightScope', () => {
  test('a milestone plans its direct children, unbanded', () => {
    const tasks = [
      task('e-m', { kind: 'milestone' }),
      task('t-b', { parent: 'e-m' }),
      task('t-a', { parent: 'e-m' }),
      task('t-sub', { parent: 't-a' }),
      task('t-other'),
    ];
    const scope = flightScope(tasks[0], childrenByParent(tasks));
    expect(scope.bands).toBeNull();
    expect(scope.nodes.map((t) => t.meta.id)).toEqual(['t-a', 't-b']);
  });

  test('a project bands its milestones by target date, direct tasks last', () => {
    const tasks = [
      task('e-p', { kind: 'project' }),
      task('e-late', {
        kind: 'milestone',
        parent: 'e-p',
        dueDate: '2026-12-01',
      }),
      task('e-soon', {
        kind: 'milestone',
        parent: 'e-p',
        dueDate: '2026-10-01',
      }),
      task('e-undated', { kind: 'milestone', parent: 'e-p' }),
      task('t-1', { parent: 'e-late' }),
      task('t-2', { parent: 'e-soon' }),
      task('t-3', { parent: 'e-p' }),
      // A parent issue is one node; its sub-issue belongs to its own plan.
      task('t-4', { parent: 'e-soon' }),
      task('t-4a', { parent: 't-4' }),
    ];
    const scope = flightScope(tasks[0], childrenByParent(tasks));
    expect(scope.bands?.map((b) => b.key)).toEqual([
      'e-soon',
      'e-late',
      'e-undated',
      DIRECT_BAND,
    ]);
    expect(scope.nodes.map((t) => t.meta.id)).toEqual([
      't-2',
      't-4',
      't-1',
      't-3',
    ]);
    expect(scope.bandOf.get('t-3')).toBe(DIRECT_BAND);
    expect(scope.bandOf.get('t-4')).toBe('e-soon');
  });

  test('an initiative rolls a project’s milestones up into the project’s band', () => {
    const tasks = [
      task('e-i', { kind: 'initiative' }),
      task('e-p', { kind: 'project', parent: 'e-i' }),
      task('e-m', { kind: 'milestone', parent: 'e-p' }),
      task('t-1', { parent: 'e-m' }),
      task('t-2', { parent: 'e-p' }),
    ];
    const scope = flightScope(tasks[0], childrenByParent(tasks));
    expect(scope.bands?.map((b) => b.key)).toEqual(['e-p']);
    expect(scope.nodes.map((t) => t.meta.id).sort()).toEqual(['t-1', 't-2']);
  });

  test('a project without milestones is one unbanded plan', () => {
    const tasks = [
      task('e-p', { kind: 'project' }),
      task('t-1', { parent: 'e-p' }),
    ];
    const scope = flightScope(tasks[0], childrenByParent(tasks));
    expect(scope.bands).toBeNull();
    expect(scope.nodes).toHaveLength(1);
  });
});

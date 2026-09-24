import type { TaskListItem, TaskMeta } from '@dispatch/core/browser';
import { DEFAULT_STATUS_MODEL } from '@dispatch/core/browser';
import { describe, expect, test } from 'bun:test';

import {
  removeTaskListItem,
  touchesFanout,
  upsertTaskListItem,
  withDispatching,
} from './taskListCache';

function item(id: string, created: string, updated = created): TaskListItem {
  return { meta: { id, title: id, created, updated } as TaskMeta };
}

const ids = (list: TaskListItem[]) => list.map((t) => t.meta.id);

describe('upsertTaskListItem', () => {
  const list = [
    item('t-a', '2026-01-01'),
    item('t-b', '2026-01-02'),
    item('t-c', '2026-01-03'),
  ];

  test('replaces an existing entry in place', () => {
    const next = upsertTaskListItem(list, {
      ...list[1].meta,
      title: 'renamed',
      updated: '2026-02-01',
    });
    expect(ids(next)).toEqual(['t-a', 't-b', 't-c']);
    expect(next[1].meta.title).toBe('renamed');
    expect(list[1].meta.title).toBe('t-b');
  });

  test('inserts a new task where the server orders it (created, then id)', () => {
    expect(
      ids(upsertTaskListItem(list, item('t-0', '2026-01-02').meta))
    ).toEqual(['t-a', 't-0', 't-b', 't-c']);
    expect(
      ids(upsertTaskListItem(list, item('t-z', '2026-01-04').meta))
    ).toEqual(['t-a', 't-b', 't-c', 't-z']);
  });

  test('ignores a response older than the cached entry', () => {
    const fresh = [item('t-a', '2026-01-01', '2026-03-01')];
    const stale = { ...fresh[0].meta, title: 'old', updated: '2026-02-01' };
    expect(upsertTaskListItem(fresh, stale)).toBe(fresh);
  });
});

test('removeTaskListItem drops only the named task', () => {
  const list = [item('t-a', '2026-01-01'), item('t-b', '2026-01-02')];
  expect(ids(removeTaskListItem(list, 't-a'))).toEqual(['t-b']);
});

describe('touchesFanout', () => {
  const node = (id: string, parent: string | null, kind = 'task') =>
    ({ meta: { id, parent, kind } as TaskMeta }) as TaskListItem;
  const list = [
    node('e-1', null, 'milestone'),
    node('t-child', 'e-1'),
    node('t-parent', null),
    node('t-sub', 't-parent'),
    node('t-loose', null),
  ];

  test('a loose task that stays loose moves no progress', () => {
    expect(touchesFanout(list, 't-loose', node('t-loose', null).meta)).toBe(
      false
    );
    expect(touchesFanout(list, 't-new', node('t-new', null).meta)).toBe(false);
    expect(touchesFanout(list, 't-loose', null)).toBe(false);
  });

  test('a task under a container, before or after, does', () => {
    expect(touchesFanout(list, 't-child', node('t-child', null).meta)).toBe(
      true
    );
    expect(touchesFanout(list, 't-loose', node('t-loose', 'e-1').meta)).toBe(
      true
    );
  });

  test('a container, by kind or by children, does', () => {
    expect(touchesFanout(list, 'e-1', null)).toBe(true);
    expect(touchesFanout(list, 't-parent', node('t-parent', null).meta)).toBe(
      true
    );
  });

  test('with no list cached, it might', () => {
    expect(touchesFanout(undefined, 't-loose', null)).toBe(true);
  });
});

describe('withDispatching', () => {
  const at = (id: string, status: string) =>
    ({ meta: { id, status } as TaskMeta }) as TaskListItem;
  const list = [at('t-1', 'ready'), at('t-2', 'ready'), at('t-3', 'review')];
  const statuses = (next: TaskListItem[]) => next.map((t) => t.meta.status);

  test('shows a waiting task being dispatched as the dispatched status', () => {
    const next = withDispatching(
      list,
      new Map([['t-2', 0]]),
      DEFAULT_STATUS_MODEL
    );
    expect(statuses(next)).toEqual(['ready', 'working', 'review']);
    expect(list[1].meta.status).toBe('ready');
  });

  test('leaves a task the daemon already moved, and returns the same list', () => {
    expect(
      withDispatching(list, new Map([['t-3', 0]]), DEFAULT_STATUS_MODEL)
    ).toBe(list);
    expect(withDispatching(list, new Map(), DEFAULT_STATUS_MODEL)).toBe(list);
  });
});

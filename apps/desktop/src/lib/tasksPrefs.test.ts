import type { TaskDoc } from '@dispatch/core/browser';
import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_TASKS_DISPLAY,
  EMPTY_TASK_FILTERS,
  hasActiveFilters,
  matchesTaskFilters,
  parseTaskFilters,
  parseTasksDisplay,
  serializeTasksDisplay,
  TASKS_DISPLAY_STORAGE_KEY,
  toggleDisplayProperty,
  toggleFilterValue,
} from './tasksPrefs';

function makeTask(status: string, priority = 'none'): TaskDoc {
  return {
    meta: {
      id: 't-1',
      title: 'T',
      status,
      kind: 'task',
      parent: null,
      milestone: null,
      blockedBy: [],
      labels: [],
      priority: priority as TaskDoc['meta']['priority'],
      assignee: 'none',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
      external: null,
      selfReview: false,
      writes: [],
      risk: 'routine',
      model: null,
      exercised: false,
    },
    body: '',
  };
}

describe('parseTaskFilters', () => {
  it('defaults on null, garbage, and wrong shapes', () => {
    expect(parseTaskFilters(null)).toEqual(EMPTY_TASK_FILTERS);
    expect(parseTaskFilters('not json')).toEqual(EMPTY_TASK_FILTERS);
    expect(parseTaskFilters('"a string"')).toEqual(EMPTY_TASK_FILTERS);
    expect(parseTaskFilters('{"statuses": [1, "ready"]}')).toEqual({
      statuses: ['ready'],
      priorities: [],
    });
  });
});

describe('parseTasksDisplay', () => {
  it('has Linear defaults: status grouping, priority order, the eight row properties', () => {
    expect(TASKS_DISPLAY_STORAGE_KEY).toBe('dispatch:tasks-display-v1');
    const d = parseTasksDisplay(null);
    expect(d).toEqual(DEFAULT_TASKS_DISPLAY);
    expect(d.grouping).toBe('status');
    expect(d.ordering).toBe('priority');
    expect(d.showEmptyGroups).toBe(false);
    expect([...d.properties].sort()).toEqual([
      'assignee',
      'epic',
      'id',
      'labels',
      'priority',
      'run',
      'status',
      'updated',
    ]);
  });

  it('round-trips through serializeTasksDisplay', () => {
    const prefs = {
      ...DEFAULT_TASKS_DISPLAY,
      layout: 'list' as const,
      grouping: 'epic' as const,
      ordering: 'updated' as const,
      orderDir: 'desc' as const,
      nestedSubtasks: false,
      properties: new Set(['id', 'status'] as const),
      dateField: 'created' as const,
    };
    expect(parseTasksDisplay(serializeTasksDisplay(prefs))).toEqual(prefs);
  });

  it('degrades unknown enum values and non-boolean toggles to the defaults, field by field', () => {
    const parsed = parseTasksDisplay(
      JSON.stringify({
        layout: 'lanes',
        grouping: 'milestone',
        ordering: 'weight',
        showEmptyGroups: 'yes',
        properties: ['id', 'weight', 7],
      })
    );
    expect(parsed.layout).toBe(DEFAULT_TASKS_DISPLAY.layout);
    expect(parsed.grouping).toBe('milestone');
    expect(parsed.ordering).toBe('priority');
    expect(parsed.showEmptyGroups).toBe(false);
    expect([...parsed.properties]).toEqual(['id']);
  });

  // The retired v1 board/list column payloads share no keys with the display model, so a
  // user who somehow lands one under the new key gets the defaults rather than a half-read
  // preference.
  it('reads the retired v1 column shapes as the defaults', () => {
    expect(
      parseTasksDisplay(
        '{"hideEmpty": false, "hidden": ["landed"], "compact": false}'
      )
    ).toEqual(DEFAULT_TASKS_DISPLAY);
    expect(parseTasksDisplay('["tags", "updated"]')).toEqual(
      DEFAULT_TASKS_DISPLAY
    );
    expect(parseTasksDisplay('not json')).toEqual(DEFAULT_TASKS_DISPLAY);
  });
});

describe('toggleDisplayProperty', () => {
  it('flips membership without mutating the input', () => {
    const on = toggleDisplayProperty(DEFAULT_TASKS_DISPLAY, 'milestone');
    expect(on.properties.has('milestone')).toBe(true);
    expect(DEFAULT_TASKS_DISPLAY.properties.has('milestone')).toBe(false);
    const off = toggleDisplayProperty(on, 'milestone');
    expect(off.properties.has('milestone')).toBe(false);
  });
});

describe('toggleFilterValue / hasActiveFilters', () => {
  it('toggles membership', () => {
    expect(toggleFilterValue([], 'ready')).toEqual(['ready']);
    expect(toggleFilterValue(['ready'], 'ready')).toEqual([]);
  });

  it('reports active state', () => {
    expect(hasActiveFilters(EMPTY_TASK_FILTERS)).toBe(false);
    expect(hasActiveFilters({ statuses: ['ready'], priorities: [] })).toBe(
      true
    );
  });
});

describe('matchesTaskFilters', () => {
  it('empty filters pass everything', () => {
    expect(matchesTaskFilters(makeTask('ready'), EMPTY_TASK_FILTERS)).toBe(
      true
    );
  });

  it('unions within a group, intersects across groups', () => {
    const filters = { statuses: ['ready', 'working'], priorities: ['high'] };
    expect(matchesTaskFilters(makeTask('ready', 'high'), filters)).toBe(true);
    expect(matchesTaskFilters(makeTask('working', 'high'), filters)).toBe(true);
    expect(matchesTaskFilters(makeTask('ready', 'low'), filters)).toBe(false);
    expect(matchesTaskFilters(makeTask('review', 'high'), filters)).toBe(false);
  });
});

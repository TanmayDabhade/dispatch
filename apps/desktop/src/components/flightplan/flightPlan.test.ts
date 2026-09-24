import type { TaskListItem } from '@dispatch/core/browser';
import { DEFAULT_STATUS_MODEL } from '@dispatch/core/browser';
import { describe, expect, test } from 'bun:test';

import { buildFlightPlan } from './flightPlan';

function child(
  id: string,
  overrides: Partial<TaskListItem['meta']> = {}
): TaskListItem {
  return {
    meta: {
      id,
      title: id,
      status: 'ready',
      kind: 'task',
      parent: 'e-1',
      blockedBy: [],
      assignee: 'none',
      created: `2026-09-01T00:00:0${id.slice(-1)}.000Z`,
      ...overrides,
    },
  } as TaskListItem;
}

const opts = (live: string[] = [], concurrency: number | null = 3) => ({
  liveTaskIds: new Set(live),
  model: DEFAULT_STATUS_MODEL,
  concurrency,
});

// a, b → c → d: three waves.
const CHAIN = [
  child('t-a', { status: 'landed' }),
  child('t-b', { status: 'working' }),
  child('t-c', { blockedBy: ['t-a', 't-b'] }),
  child('t-d', { blockedBy: ['t-c'] }),
];

describe('buildFlightPlan', () => {
  test('layers children into waves along their blockers', () => {
    const plan = buildFlightPlan(CHAIN, opts(['t-b']));
    expect(plan.nodes.map((n) => [n.task.meta.id, n.wave])).toEqual([
      ['t-a', 0],
      ['t-b', 0],
      ['t-c', 1],
      ['t-d', 2],
    ]);
    expect(plan.waves).toEqual([
      { index: 0, total: 2, done: 1, running: 1 },
      { index: 1, total: 1, done: 0, running: 0 },
      { index: 2, total: 1, done: 0, running: 0 },
    ]);
    expect(plan.currentWave).toBe(0);
  });

  test('names each child’s state and what it waits on', () => {
    const plan = buildFlightPlan(
      [
        ...CHAIN,
        child('t-e'),
        child('t-f', { status: 'working', assignee: 'human:maya' }),
      ],
      opts(['t-b'])
    );
    const state = Object.fromEntries(
      plan.nodes.map((n) => [n.task.meta.id, n.state])
    );
    expect(state).toEqual({
      't-a': 'done',
      't-b': 'running',
      't-c': 'blocked',
      't-d': 'blocked',
      't-e': 'queued',
      't-f': 'teammate',
    });
    expect(plan.nodes.find((n) => n.task.meta.id === 't-c')?.waitingOn).toEqual(
      ['t-b']
    );
    expect(plan).toMatchObject({ total: 6, done: 1, running: 1, queued: 1 });
  });

  test('counts slots against the session’s concurrency', () => {
    expect(buildFlightPlan(CHAIN, opts(['t-b'], 3)).slots).toEqual({
      used: 1,
      total: 3,
    });
    expect(buildFlightPlan(CHAIN, opts([], null)).slots).toEqual({
      used: 0,
      total: null,
    });
  });

  test('a finished plan has no current wave; children with no edges are one wave', () => {
    const done = buildFlightPlan(
      [child('t-a', { status: 'landed' }), child('t-b', { status: 'dropped' })],
      opts()
    );
    expect(done.waves).toHaveLength(1);
    expect(done.currentWave).toBeNull();
  });

  test('a blocker outside the container never holds a wave', () => {
    const plan = buildFlightPlan(
      [child('t-a', { blockedBy: ['t-elsewhere'] })],
      opts()
    );
    expect(plan.nodes[0]).toMatchObject({
      wave: 0,
      state: 'queued',
      waitingOn: [],
    });
  });

  test('a blocker in review no longer holds its dependent (the server stacks it)', () => {
    const plan = buildFlightPlan(
      [
        child('t-a', { status: 'review' }),
        child('t-b', { blockedBy: ['t-a'] }),
      ],
      opts()
    );
    expect(plan.nodes.map((n) => [n.task.meta.id, n.state])).toEqual([
      ['t-a', 'review'],
      ['t-b', 'queued'],
    ]);
    expect(plan.nodes[1]?.waitingOn).toEqual([]);
  });

  test('critical work, a sub-plan and a backlog child never read as queued', () => {
    const plan = buildFlightPlan(
      [
        child('t-a', { risk: 'critical' }),
        child('t-b'),
        child('t-c', { status: 'draft' }),
      ],
      { ...opts(), containerIds: new Set(['t-b']) }
    );
    expect(plan.nodes.map((n) => [n.state, n.subPlan])).toEqual([
      ['blocked', false],
      ['blocked', true],
      ['blocked', false],
    ]);
    expect(plan.queued).toBe(0);
  });

  test('uses the waves it is handed instead of recomputing them', () => {
    const plan = buildFlightPlan(CHAIN, {
      ...opts(),
      waves: new Map([
        ['t-a', 3],
        ['t-b', 3],
        ['t-c', 4],
        ['t-d', 5],
      ]),
    });
    expect(plan.nodes.map((n) => n.wave)).toEqual([3, 3, 4, 5]);
  });
});

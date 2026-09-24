import { describe, expect, it } from 'bun:test';

import { DEFAULT_STATUS_MAP } from '../src/linearMap.js';
import type { LinearWorkflowState } from '../src/linearMap.js';
import {
  defaultStatusRoles,
  migrateStatus,
  reconcileStatusRoles,
  statusesFromWorkflowStates,
  statusRenames,
  statusTypeOfState,
} from '../src/linearStatuses.js';
import { DEFAULT_STATUS_MODEL } from '../src/status.js';
import type { StatusModel } from '../src/status.js';
import { STATES } from './linearFixtures.js';

describe('statusesFromWorkflowStates', () => {
  it('mirrors the team’s states in Linear’s board order, with types and colors', () => {
    const { definitions, names } = statusesFromWorkflowStates(
      [...STATES].reverse()
    );
    expect(definitions.map((d) => d.name)).toEqual([
      'Triage',
      'Backlog',
      'Todo',
      'In Progress',
      'QA',
      'In Review',
      'Done',
      'Canceled',
      'Duplicate',
    ]);
    expect(definitions.find((d) => d.name === 'QA')).toEqual({
      name: 'QA',
      type: 'started',
      color: '#26b5ce',
    });
    expect(definitions.find((d) => d.name === 'Duplicate')?.type).toBe(
      'canceled'
    );
    expect(names['s-qa']).toBe('QA');
  });

  it('round-trips every state, custom ones included, through its status name', () => {
    const { names } = statusesFromWorkflowStates(STATES);
    const back = new Map(Object.entries(names).map(([id, name]) => [name, id]));
    for (const state of STATES)
      expect(back.get(names[state.id])).toBe(state.id);
  });

  it('never generates a name the legacy alias layer would rewrite', () => {
    const states: LinearWorkflowState[] = [
      { id: 'a', name: 'done', type: 'completed' },
      { id: 'b', name: 'todo', type: 'unstarted' },
    ];
    const { names } = statusesFromWorkflowStates(states);
    expect(names).toEqual({ a: 'Done', b: 'Todo' });
  });

  it('keeps two states that spell the same name apart', () => {
    const states: LinearWorkflowState[] = [
      { id: 'a', name: 'Doing', type: 'started', position: 0 },
      { id: 'b', name: 'Doing', type: 'started', position: 1 },
    ];
    expect(statusesFromWorkflowStates(states).names).toEqual({
      a: 'Doing',
      b: 'Doing (2)',
    });
  });

  it('types an unknown state type as backlog', () => {
    expect(statusTypeOfState('mystery')).toBe('backlog');
  });
});

describe('defaultStatusRoles', () => {
  it('routes runs to started, review to the review-named state, landing nowhere', () => {
    const { definitions } = statusesFromWorkflowStates(STATES);
    expect(defaultStatusRoles(definitions)).toEqual({
      ready: 'Todo',
      dispatched: 'In Progress',
      review: 'In Review',
      landing: null,
      landed: 'Done',
      dropped: 'Canceled',
    });
  });

  it('falls back to the first started state when none is named like review', () => {
    const { definitions } = statusesFromWorkflowStates(
      STATES.filter((s) => s.id !== 's-review')
    );
    expect(defaultStatusRoles(definitions).review).toBe('In Progress');
  });

  it('makes do with a team that has no unstarted or canceled states', () => {
    const { definitions } = statusesFromWorkflowStates([
      { id: 'b', name: 'Ideas', type: 'backlog' },
      { id: 's', name: 'Doing', type: 'started' },
      { id: 'd', name: 'Shipped', type: 'completed' },
    ]);
    expect(defaultStatusRoles(definitions)).toMatchObject({
      ready: 'Ideas',
      dropped: 'Shipped',
    });
  });
});

describe('reconcileStatusRoles', () => {
  const fresh = defaultStatusRoles(
    statusesFromWorkflowStates(STATES).definitions
  );
  const names = statusesFromWorkflowStates(STATES).definitions.map(
    (d) => d.name
  );

  it('takes the fresh defaults on the first link', () => {
    const current = { ...fresh, review: 'QA' };
    expect(
      reconcileStatusRoles(current, null, fresh, names, new Map())
    ).toEqual(fresh);
  });

  it('keeps a role the user changed since the last generation', () => {
    const current = { ...fresh, review: 'QA' };
    expect(
      reconcileStatusRoles(current, fresh, fresh, names, new Map()).review
    ).toBe('QA');
  });

  it('follows a renamed state, and drops an override whose state is gone', () => {
    const current = { ...fresh, review: 'QA', landed: 'Shipped' };
    const renamed = names.map((n) => (n === 'QA' ? 'Verify' : n));
    const out = reconcileStatusRoles(
      current,
      fresh,
      fresh,
      renamed,
      new Map([['QA', 'Verify']])
    );
    expect(out.review).toBe('Verify');
    expect(out.landed).toBe('Done');
  });

  it('keeps a landing role the user switched on', () => {
    const current = { ...fresh, landing: 'In Review' };
    expect(
      reconcileStatusRoles(current, fresh, fresh, names, new Map()).landing
    ).toBe('In Review');
  });
});

describe('statusRenames and migrateStatus', () => {
  const generated = statusesFromWorkflowStates(STATES);
  const after: StatusModel = {
    definitions: generated.definitions,
    roles: defaultStatusRoles(generated.definitions),
  };
  const migration = {
    renames: new Map<string, string>(),
    before: DEFAULT_STATUS_MODEL,
    after,
    legacyMap: DEFAULT_STATUS_MAP,
    states: STATES,
    names: generated.names,
  };

  it('moves every built-in status to the state the old map pointed at', () => {
    const moved = Object.fromEntries(
      [
        'draft',
        'ready',
        'working',
        'review',
        'landing',
        'landed',
        'dropped',
      ].map((s) => [s, migrateStatus(s, migration)])
    );
    expect(moved).toEqual({
      draft: 'Backlog',
      ready: 'Todo',
      working: 'In Progress',
      review: 'In Review',
      landing: 'In Review',
      landed: 'Done',
      dropped: 'Canceled',
    });
  });

  it('falls back to the role, then the type, for a status the map never named', () => {
    const before: StatusModel = {
      definitions: [
        ...DEFAULT_STATUS_MODEL.definitions,
        { name: 'blocked', type: 'started', color: null },
      ],
      roles: DEFAULT_STATUS_MODEL.roles,
    };
    expect(
      migrateStatus('blocked', { ...migration, before, legacyMap: {} })
    ).toBe('In Progress');
  });

  it('renames a status when its state was renamed in Linear', () => {
    const renames = statusRenames({ 's-qa': 'QA' }, { 's-qa': 'Verify' });
    expect([...renames]).toEqual([['QA', 'Verify']]);
    expect(migrateStatus('QA', { ...migration, renames })).toBe('Verify');
  });

  it('leaves a status that is still defined alone', () => {
    expect(migrateStatus('QA', migration)).toBe('QA');
  });
});

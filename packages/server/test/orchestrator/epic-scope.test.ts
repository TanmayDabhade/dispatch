import { ActorContext, TaskStore } from '@dispatch/core';
import type { CreateInput } from '@dispatch/core';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TaskCache } from '../../src/cache.js';
import { EventBus } from '../../src/events.js';
import { EpicEngine } from '../../src/orchestrator/epic.js';
import { FakeExecutor } from '../../src/orchestrator/executors/fake.js';
import { Orchestrator } from '../../src/orchestrator/orchestrator.js';
import { epicSessionsPath } from '../../src/orchestrator/paths.js';
import { initGitRepo, WatchedTaskStore } from './helpers.js';

// Who a fan-out may pick up: never a teammate's task.

let fakeHome: string;
let repo: string;
const originalDispatchHome = process.env.DISPATCH_HOME;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'dispatch-home-'));
  process.env.DISPATCH_HOME = fakeHome;
  repo = initGitRepo('dispatch-epic-scope-');
});

afterEach(() => {
  if (originalDispatchHome === undefined) delete process.env.DISPATCH_HOME;
  else process.env.DISPATCH_HOME = originalDispatchHome;
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('waitFor timed out');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The daemon's local human resolves to `human:test` from this git identity.
const gitReader = (args: string[]): string =>
  args.includes('user.email') ? 'test@example.com' : 'Test';

// Every run parks at an approval gate, so live runs stay live until approved.
function makeHarness() {
  const store = TaskStore.init(repo);
  const cache = new TaskCache();
  cache.rebuild(store);
  const events = new EventBus();
  const actorContext = ActorContext.resolve(repo, gitReader);
  const orchestrator = new Orchestrator({
    rootDir: repo,
    store,
    cache,
    events,
    actorContext,
  });
  orchestrator.registerExecutor(
    'fake',
    new FakeExecutor({
      steps: [{ approval: { requestId: 'go', toolName: 'noop', input: {} } }],
      finish: { state: 'finished', costUsd: 0, turns: 1 },
    })
  );
  const epics = new EpicEngine({
    rootDir: repo,
    store,
    cache,
    events,
    orchestrator,
    actorContext,
    eventDebounceMs: 0,
  });
  const watched = new WatchedTaskStore(repo, cache);
  // A distinct write-set per task, so claims never serialize these tests.
  const task = (title: string, input: Partial<CreateInput> = {}): string =>
    watched.create({ title, kind: 'task', writes: [`${title}.ts`], ...input })
      .meta.id;
  const dispatched = () =>
    new Set(orchestrator.list().map((run) => run.taskId));
  return {
    orchestrator,
    epics,
    store: watched,
    cache,
    events,
    actorContext,
    task,
    dispatched,
  };
}

describe('a fan-out never picks up a teammate’s task', () => {
  it('dispatches unassigned, agent and the starter’s own work only (single-user daemon)', async () => {
    const h = makeHarness();
    expect(h.actorContext.humanRef).toBe('human:test');
    const m = h.store.create({ title: 'Milestone', kind: 'milestone' }).meta.id;
    const ids = {
      unassigned: h.task('unassigned', { parent: m }),
      agent: h.task('agent', { parent: m, assignee: 'agent:claude' }),
      mine: h.task('mine', { parent: m, assignee: 'human:test' }),
      legacyMine: h.task('legacy', { parent: m, assignee: 'human' }),
      samTask: h.task('samTask', { parent: m, assignee: 'human:sam' }),
      samAgent: h.task('sam-agent', {
        parent: m,
        assignee: 'agent:sam/claude',
      }),
    };
    const samBefore = h.store.get(ids.samTask);

    const session = await h.epics.start(m, {
      executor: 'fake',
      concurrency: 8,
    });
    expect(session.startedBy).toBe('human:test');
    await waitFor(() => h.orchestrator.list().length === 4);
    await sleep(50);

    expect(h.dispatched()).toEqual(
      new Set([ids.unassigned, ids.agent, ids.mine, ids.legacyMine])
    );
    // Untouched: no dispatched status, so nothing for Linear to push.
    const samAfter = h.store.get(ids.samTask);
    expect(samAfter?.meta.status).toBe(samBefore?.meta.status);
    expect(samAfter?.meta.updated).toBe(samBefore?.meta.updated);
    expect(samAfter?.body).toBe(samBefore?.body);

    const phases = new Map(h.epics.progress(m).children.map((c) => [c.id, c]));
    expect(phases.get(ids.samTask)).toMatchObject({
      phase: 'held',
      reason: 'assigned to human:sam',
    });
    expect(phases.get(ids.samAgent)).toMatchObject({
      phase: 'held',
      reason: 'assigned to human:sam',
    });
  });

  it('works for whoever started it on a shared daemon, bare human included', async () => {
    const h = makeHarness();
    const m = h.store.create({ title: 'Milestone', kind: 'milestone' }).meta.id;
    const ids = {
      unassigned: h.task('unassigned', { parent: m }),
      ada: h.task('ada', { parent: m, assignee: 'human:ada' }),
      operator: h.task('operator', { parent: m, assignee: 'human:test' }),
      bare: h.task('bare', { parent: m, assignee: 'human' }),
    };

    const session = await h.epics.start(m, {
      executor: 'fake',
      concurrency: 8,
      startedBy: 'human:ada',
    });
    expect(session.startedBy).toBe('human:ada');
    await waitFor(() => h.orchestrator.list().length === 2);
    await sleep(50);

    // Bare `human` is the daemon's operator, a teammate from Ada's side.
    expect(h.dispatched()).toEqual(new Set([ids.unassigned, ids.ada]));
    const phases = new Map(h.epics.progress(m).children.map((c) => [c.id, c]));
    expect(phases.get(ids.operator)?.reason).toBe('assigned to human:test');
    expect(phases.get(ids.bare)?.reason).toBe('assigned to human:test');
  });

  it('holds a teammate’s blocker’s dependents until it lands, then starts them', async () => {
    const h = makeHarness();
    const m = h.store.create({ title: 'Milestone', kind: 'milestone' }).meta.id;
    const samTask = h.task('samTask', { parent: m, assignee: 'human:sam' });
    const dependent = h.task('dependent', { parent: m, blockedBy: [samTask] });

    await h.epics.start(m, { executor: 'fake', concurrency: 4 });
    await sleep(50);
    expect(h.orchestrator.list()).toHaveLength(0);
    expect(h.epics.progress(m).session?.state).toBe('active');

    // Sam's issue moves on in Linear; the sync writes it and says so.
    h.store.update(samTask, { status: 'working' });
    h.events.broadcast({ type: 'task.changed', ids: [samTask] });
    await sleep(50);
    expect(h.orchestrator.list()).toHaveLength(0);

    h.store.update(samTask, { status: 'landed' });
    h.events.broadcast({ type: 'task.changed', ids: [samTask] });
    await waitFor(() => h.dispatched().has(dependent));
    expect(h.dispatched()).toEqual(new Set([dependent]));
  });

  it('does not complete on a teammate’s leftover task alone', async () => {
    const h = makeHarness();
    const m = h.store.create({ title: 'Milestone', kind: 'milestone' }).meta.id;
    const mine = h.task('mine', { parent: m });
    h.task('samTask', { parent: m, assignee: 'human:sam' });

    await h.epics.start(m, { executor: 'fake', concurrency: 4 });
    await waitFor(() => h.dispatched().has(mine));
    const run = h.orchestrator.list()[0];
    if (run === undefined) throw new Error('no run');
    h.orchestrator.approve(run.id, 'go', true);
    await waitFor(() => h.epics.progress(m).session?.state === 'complete');
  });
});

it('a session persisted without a starter works for the local human', async () => {
  const h0 = makeHarness();
  const m = h0.store.create({ title: 'Milestone', kind: 'milestone' }).meta.id;
  const mine = h0.task('mine', { parent: m, assignee: 'human:test' });
  h0.task('samTask', { parent: m, assignee: 'human:sam' });
  mkdirSync(join(epicSessionsPath(repo), '..'), { recursive: true });
  writeFileSync(
    epicSessionsPath(repo),
    JSON.stringify({
      version: 1,
      sessions: {
        [m]: {
          concurrency: 4,
          executor: 'fake',
          state: 'active',
          maxSpendUsd: null,
          maxRuns: null,
          startedAt: '2026-09-20T00:00:00Z',
          updatedAt: '2026-09-20T00:00:00Z',
          heldCritical: [],
        },
      },
    })
  );
  const store = TaskStore.init(repo);
  const cache = new TaskCache();
  cache.rebuild(store);
  const events = new EventBus();
  const actorContext = ActorContext.resolve(repo, gitReader);
  const orchestrator = new Orchestrator({
    rootDir: repo,
    store,
    cache,
    events,
    actorContext,
  });
  orchestrator.registerExecutor(
    'fake',
    new FakeExecutor({
      steps: [{ approval: { requestId: 'go', toolName: 'noop', input: {} } }],
      finish: { state: 'finished', costUsd: 0, turns: 1 },
    })
  );
  const epics = new EpicEngine({
    rootDir: repo,
    store,
    cache,
    events,
    orchestrator,
    actorContext,
    resumeDelayMs: 0,
  });
  expect(epics.progress(m).session?.startedBy).toBeNull();
  expect(epics.resumeOnBoot()).toBe(1);
  await waitFor(() => orchestrator.list().length === 1);
  await sleep(50);
  expect(orchestrator.list().map((r) => r.taskId)).toEqual([mine]);
});

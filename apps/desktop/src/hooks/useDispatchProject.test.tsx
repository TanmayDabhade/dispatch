import type {
  ConnectEventsOptions,
  EpicProgress,
  EpicSessionOptions,
  RunMeta,
  RunScopeRequest,
  ServerEvent,
} from '@dispatch/client';
import * as dispatchClient from '@dispatch/client';
import type { TaskDoc, TaskListItem } from '@dispatch/core/browser';
import { defaultTaskFields } from '@dispatch/core/browser';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, mock, test } from 'bun:test';
import type { ReactNode } from 'react';

const PORT = 4321;

// The one connection the hook asks for. Mocked at the module level because
// `ensureDispatchd` shells out to Tauri, which does not exist under bun:test.
// bun hoists this mock across every file in the run, so `isTauri` keeps the
// real function's contract (the window global) rather than a constant — the
// deep-link tests enter Tauri by defining `__TAURI_INTERNALS__`.
void mock.module('../lib/tauri', () => ({
  ensureDispatchd: () =>
    Promise.resolve({ port: PORT, appToken: 'app-token', agentToken: null }),
  restartDispatchd: () => Promise.resolve(),
  isTauri: () => '__TAURI_INTERNALS__' in window,
  // The boot warm-up (lib/bootWarm.ts) imports these; a file run after this one sees them.
  currentProjectRoot: () => Promise.resolve('/repo'),
  hasDispatch: () => Promise.resolve(true),
}));

// Captured from the hook's own `connectEvents` call, so a test can play the
// daemon and push frames at it.
let sink: {
  onChange: () => void;
  onEvent: (event: ServerEvent) => void;
} | null = null;

// What the daemon's run list says right now, and the open scope requests it
// reports per run — set by the restart test below, empty for everyone else.
let runsFixture: RunMeta[] = [];
let openScopeRequests = new Map<string, RunScopeRequest[]>();
const scopeRequestListings: string[] = [];

// The bulk epic-progress listing the daemon returns, how many times it was
// asked for, and every `startEpic` body the hook sent — the fan-out tests
// below read these.
let epicProgressFixture: EpicProgress[] = [];
let epicProgressFetches = 0;
const epicStarts: [string, EpicSessionOptions | undefined][] = [];

// The daemon's task list and per-task docs, for the `task.changed` tests. The
// list rejects until a test opts in, so the others keep seeding it by hand.
let taskListFixture: TaskListItem[] | null = null;
let taskListFetches = 0;
const taskDocs = new Map<string, TaskDoc>();
// Holds the list fetch open until the test releases it.
let taskListGate: Promise<void> | null = null;

// The project config, for the tests that need its status model; rejects until set.
let configFixture: object | null = null;
let configFetches = 0;

// The daemon's cached readiness readings (`/api/tasks/readiness`).
let readinessFixture: Record<string, dispatchClient.ReadinessReading> = {};
// What the judging route (`/api/tasks/ready`) answers, and how often it was asked.
let judgedFixture: {
  meta: { id: string };
  readiness?: dispatchClient.ReadinessReading;
}[] = [];
let judgeCalls = 0;

// Every `updateTask` the hook sent, by task id and patch.
const taskUpdates: [string, object][] = [];

// What `createRun` answers; a test swaps in a held or refused promise.
let createRunResult: () => Promise<RunMeta> = () =>
  Promise.reject(new Error('no runs in this test'));

// Only `createApiClient` is replaced — the rest of the module (ApiError, which
// useOverseerSession's 404 veto instanceof-checks) has to stay real.
// Lets a test hold the first presence fetch open, so a `hello` can land while
// it is still in flight — the interleaving a real browser hits.
let presenceGate: Promise<void> | null = null;
let presenceFetches = 0;

void mock.module('@dispatch/client', () => ({
  ...dispatchClient,
  createApiClient: () => ({
    baseUrl: `http://127.0.0.1:${PORT}`,
    fetchRuns: () => Promise.resolve(runsFixture),
    fetchConfig: () => {
      configFetches += 1;
      return configFixture === null
        ? Promise.reject(new Error('no config in this test'))
        : Promise.resolve(configFixture);
    },
    fetchReadiness: () => Promise.resolve(readinessFixture),
    createRun: () => createRunResult(),
    updateTask: (id: string, patch: object) => {
      taskUpdates.push([id, patch]);
      const doc = taskDocs.get(id);
      return doc === undefined
        ? Promise.reject(new Error(`no doc for ${id}`))
        : Promise.resolve({ ...doc, meta: { ...doc.meta, ...patch } });
    },
    fetchReadyTasks: () => {
      judgeCalls += 1;
      return Promise.resolve(judgedFixture);
    },
    fetchTaskList: async () => {
      taskListFetches += 1;
      if (taskListGate !== null) await taskListGate;
      if (taskListFixture === null)
        throw new Error('no task list in this test');
      return taskListFixture;
    },
    fetchTask: (id: string) => {
      const doc = taskDocs.get(id);
      return doc === undefined
        ? Promise.reject(
            new dispatchClient.ApiError(`task not found: ${id}`, 404)
          )
        : Promise.resolve(doc);
    },
    fetchExecutors: () =>
      Promise.resolve({
        executors: [
          {
            name: 'claude',
            reportsCost: true,
            reportsTurns: true,
            enforcesCaps: true,
          },
        ],
        default: 'claude',
      }),
    listScopeRequests: (runId: string) => {
      scopeRequestListings.push(runId);
      return Promise.resolve(openScopeRequests.get(runId) ?? []);
    },
    fetchAllEpicProgress: () => {
      epicProgressFetches += 1;
      return Promise.resolve(epicProgressFixture);
    },
    startEpic: (epicId: string, opts?: EpicSessionOptions) => {
      epicStarts.push([epicId, opts]);
      return Promise.resolve({
        epicId,
        concurrency: opts?.concurrency ?? 1,
        executor: 'claude',
        state: 'active',
        maxSpendUsd: opts?.maxSpendUsd ?? null,
        maxRuns: opts?.maxRuns ?? null,
        startedAt: '2026-09-20T00:00:00Z',
        updatedAt: '2026-09-20T00:00:00Z',
        active: true,
      });
    },
    startPlan: () => Promise.resolve({ planId: 'p-1' }),
    fetchPlan: (planId: string) =>
      Promise.resolve({
        id: planId,
        prompt: 'split the auth rewrite',
        plannerName: 'fake',
        role: 'plan',
        state: 'ready',
        messages: [],
        questions: [],
        createdAt: '2026-09-20T00:00:00Z',
        updatedAt: '2026-09-20T00:00:00Z',
      }),
    confirmPlan: () => Promise.resolve({ epicId: 'e-1', taskIds: ['t-1'] }),
    fetchPresence: async () => {
      presenceFetches += 1;
      const gate = presenceGate;
      presenceGate = null;
      if (gate !== null) await gate;
      return [];
    },
    connectEvents: (
      onChange: () => void,
      options: ConnectEventsOptions = {}
    ) => {
      sink = { onChange, onEvent: options.onEvent ?? (() => {}) };
      return () => {
        sink = null;
      };
    },
  }),
}));

// Imported after the mocks above so the hook closes over them.
const { useDispatchProject } = await import('./useDispatchProject');
const { overseerKey } = await import('./useOverseerSession');

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// Mounts the hook and waits until it has opened its WS connection, returning
// the query client the test seeds a ghost overseer record into.
async function mountConnected() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHook(() => useDispatchProject('/repo', { selectedRunId: null }), {
    wrapper: wrapper(queryClient),
  });
  await waitFor(() => {
    expect(sink).not.toBeNull();
  });
  return queryClient;
}

// A record the daemon no longer has, cached exactly as a live conversation
// leaves it: one pending action, which is what the rail's waiting row, its
// amber badge and both disabled "New conversation" controls read.
function seedGhostRecord(queryClient: QueryClient) {
  queryClient.setQueryData(overseerKey(PORT, 'w-1'), {
    id: 'w-1',
    prompt: 'what is going on?',
    backendName: 'fake',
    state: 'ready',
    messages: [],
    pendingActions: [
      {
        id: 'act-1',
        tool: 'cancel_run',
        input: { runId: 'r-1' },
        summary: 'Cancel run r-1',
        createdAt: '2026-08-10T00:00:02Z',
        status: 'pending',
      },
    ],
    pendingApprovals: [],
    undeliveredDecisions: [],
    createdAt: '2026-08-10T00:00:00Z',
    updatedAt: '2026-08-10T00:00:05Z',
  });
  return queryClient.getQueryState(overseerKey(PORT, 'w-1'));
}

// The daemon's `hello` is sent from its websocket `open` handler, so it is the
// one frame that marks a *connection* — including the reconnect after a
// restart, which drops every in-memory overseer record at once. Nothing else
// reports that: `overseer.changed` can never arrive for a conversation the
// daemon no longer has. This asserts the wiring, not the response to it —
// useOverseerSession.test.tsx covers the far end.
test('hello invalidates every cached overseer record for this daemon', async () => {
  const queryClient = await mountConnected();
  seedGhostRecord(queryClient);
  expect(
    queryClient.getQueryState(overseerKey(PORT, 'w-1'))?.isInvalidated
  ).toBe(false);

  act(() => {
    sink?.onEvent({ type: 'hello', version: '0.0.1' });
  });

  expect(
    queryClient.getQueryState(overseerKey(PORT, 'w-1'))?.isInvalidated
  ).toBe(true);
});

// The daemon announces a socket's arrival before that socket joins the event
// bus, so the newcomer never hears about itself. If its first presence fetch
// raced ahead of the upgrade, `hello` is the only thing left to correct it —
// without this a teammate could sit looking at a room that did not include
// them, the stack hidden, until someone else came or went.
test('hello refetches presence, since a socket never hears its own arrival', async () => {
  const queryClient = await mountConnected();
  queryClient.setQueryData(['dispatch-presence', PORT], []);
  expect(
    queryClient.getQueryState(['dispatch-presence', PORT])?.isInvalidated
  ).toBe(false);

  act(() => {
    sink?.onEvent({ type: 'hello', version: '0.0.1' });
  });

  expect(
    queryClient.getQueryState(['dispatch-presence', PORT])?.isInvalidated
  ).toBe(true);
});

// The race itself, as a real browser hit it: the first presence fetch leaves
// before the daemon has registered this socket, and `hello` arrives while it is
// still in flight. react-query folds an invalidation during a query's first
// fetch into that fetch rather than restarting it (query.js: it only cancels
// when there is data), so the stale answer would land and stick.
test('a hello during the first presence fetch still gets a fresh one', async () => {
  let open!: () => void;
  presenceGate = new Promise<void>((resolve) => {
    open = resolve;
  });
  presenceFetches = 0;
  await mountConnected();
  await waitFor(() => {
    expect(presenceFetches).toBe(1);
  });

  act(() => {
    sink?.onEvent({ type: 'hello', version: '0.0.1' });
  });
  open();

  await waitFor(() => {
    expect(presenceFetches).toBe(2);
  });
});

// The regression this pairs with: the invalidation used to sit in the first
// positional argument of `connectEvents`, which is `onChange` and fires only
// for `task.changed`. That is a task-file write, not a connection — so a
// dispatchd restart on a project whose tasks are not changing left the ghost
// record in place, while every ordinary task edit refetched the overseer for no
// reason. Pinning both directions keeps the callback from drifting back.
test('a task change does not invalidate overseer records', async () => {
  const queryClient = await mountConnected();
  seedGhostRecord(queryClient);

  act(() => {
    sink?.onChange();
  });

  expect(
    queryClient.getQueryState(overseerKey(PORT, 'w-1'))?.isInvalidated
  ).toBe(false);
});

function taskDoc(id: string, title: string, updated: string): TaskDoc {
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
      created: '2026-01-01T00:00:00.000Z',
      updated,
      external: null,
      selfReview: false,
      writes: [],
      risk: 'routine',
      model: null,
      exercised: false,
      ...defaultTaskFields(),
    },
    body: `${title} body`,
  };
}

// Mounts with a one-task list loaded, counting list fetches from there.
async function mountWithTaskList() {
  taskListFixture = [
    { meta: taskDoc('t-1', 'Before', '2026-01-01T00:00:00.000Z').meta },
  ];
  taskDocs.clear();
  const queryClient = await mountConnected();
  await waitFor(() => {
    expect(
      queryClient.getQueryData<TaskListItem[]>(['dispatch-tasks', PORT])
    ).toHaveLength(1);
  });
  taskListFetches = 0;
  const titles = () =>
    queryClient
      .getQueryData<TaskListItem[]>(['dispatch-tasks', PORT])
      ?.map((t) => t.meta.title);
  return { queryClient, titles };
}

test('task.changed with ids patches just those tasks into the cached list', async () => {
  const { titles } = await mountWithTaskList();
  taskDocs.set('t-1', taskDoc('t-1', 'After', '2026-01-02T00:00:00.000Z'));
  taskDocs.set('t-2', taskDoc('t-2', 'New', '2026-01-02T00:00:00.000Z'));

  act(() => {
    sink?.onEvent({ type: 'task.changed', ids: ['t-1', 't-2'] });
  });
  await waitFor(() => {
    expect(titles()).toEqual(['After', 'New']);
  });

  // A named task that now 404s was deleted.
  taskDocs.delete('t-2');
  act(() => {
    sink?.onEvent({ type: 'task.changed', ids: ['t-2'] });
  });
  await waitFor(() => {
    expect(titles()).toEqual(['After']);
  });
  expect(taskListFetches).toBe(0);
  taskListFixture = null;
});

// A single task's change used to refetch every ready task's body, the config and all
// fan-out progress. The ready set now follows the patched list; a loose task moves no
// fan-out, and config has its own event.
test('a loose task changing refetches only that task', async () => {
  configFixture = {
    statuses: ['draft', 'ready', 'working', 'review', 'landed', 'dropped'],
    notifications: { kinds: null },
  };
  taskListFixture = [
    { meta: taskDoc('t-1', 'Before', '2026-01-01T00:00:00.000Z').meta },
  ];
  taskDocs.clear();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () => useDispatchProject('/repo', { selectedRunId: null }),
    { wrapper: wrapper(queryClient) }
  );
  await waitFor(() => {
    expect(sink).not.toBeNull();
    expect([...result.current.readyIds]).toEqual(['t-1']);
  });
  taskListFetches = 0;
  configFetches = 0;
  epicProgressFetches = 0;
  taskDocs.set('t-1', {
    ...taskDoc('t-1', 'Started', '2026-01-02T00:00:00.000Z'),
    meta: {
      ...taskDoc('t-1', 'Started', '2026-01-02T00:00:00.000Z').meta,
      status: 'working',
    },
  });

  act(() => {
    sink?.onEvent({ type: 'task.changed', ids: ['t-1'] });
  });
  await waitFor(() => {
    expect(result.current.readyIds.size).toBe(0);
  });
  await new Promise((r) => setTimeout(r, 400));
  expect(taskListFetches).toBe(0);
  expect(configFetches).toBe(0);
  expect(epicProgressFetches).toBe(0);
  expect(
    queryClient.getQueryCache().find({ queryKey: ['dispatch-ready-tasks'] })
  ).toBeUndefined();
  taskListFixture = null;
  configFixture = null;
});

// A pull through the Git page rewrites config.yml without a `config.changed`, and a
// reconnect may follow a daemon restart that read a new one; the ready set is computed
// from the cached config, so both refetch it.
test('a git change or a reconnect refetches config', async () => {
  const statuses = ['draft', 'ready', 'working', 'review', 'landed', 'dropped'];
  configFixture = { statuses, notifications: { kinds: null } };
  taskListFixture = [
    { meta: taskDoc('t-1', 'Ready one', '2026-01-01T00:00:00.000Z').meta },
  ];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () => useDispatchProject('/repo', { selectedRunId: null }),
    { wrapper: wrapper(queryClient) }
  );
  await waitFor(() => {
    expect(sink).not.toBeNull();
    expect([...result.current.readyIds]).toEqual(['t-1']);
  });
  configFetches = 0;
  // The pulled config.yml no longer counts `ready` as waiting to start.
  configFixture = {
    statusDefinitions: statuses.map((name) => ({
      name,
      type: name === 'ready' ? 'backlog' : 'started',
      color: null,
    })),
    notifications: { kinds: null },
  };

  act(() => {
    sink?.onEvent({ type: 'git.changed' });
  });
  await waitFor(() => {
    expect(result.current.readyIds.size).toBe(0);
  });
  expect(configFetches).toBe(1);

  act(() => {
    sink?.onEvent({ type: 'hello', version: '0.0.1' });
  });
  await waitFor(() => {
    expect(configFetches).toBe(2);
  });
  taskListFixture = null;
  configFixture = null;
});

// A reading was judged against the text it describes. A draft edited and then moved to
// ready must not bring its old reading along (a level-0 one would file it under Needs you
// as an unclear spec until the next judge).
test('a task edited while not ready drops its reading before it turns ready', async () => {
  const draft = (title: string, status: string, updated: string): TaskDoc => {
    const doc = taskDoc('t-2', title, updated);
    return { ...doc, meta: { ...doc.meta, status } };
  };
  configFixture = {
    statuses: ['draft', 'ready', 'working', 'review', 'landed', 'dropped'],
    notifications: { kinds: null },
  };
  taskListFixture = [
    { meta: taskDoc('t-1', 'Ready one', '2026-01-01T00:00:00.000Z').meta },
    { meta: draft('Vague', 'draft', '2026-01-01T00:00:00.000Z').meta },
  ];
  readinessFixture = {
    't-2': {
      level: 0,
      label: 'title only',
      confidence: 1,
      splitProbability: 0,
    },
  };
  taskDocs.clear();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () => useDispatchProject('/repo', { selectedRunId: null }),
    { wrapper: wrapper(queryClient) }
  );
  await waitFor(() => {
    expect(sink).not.toBeNull();
    expect([...result.current.readyIds]).toEqual(['t-1']);
    expect(
      queryClient.getQueryData(['dispatch-readiness', PORT])
    ).toBeDefined();
  });

  taskDocs.set('t-2', draft('Clear now', 'draft', '2026-01-02T00:00:00.000Z'));
  act(() => {
    sink?.onEvent({ type: 'task.changed', ids: ['t-2'] });
  });
  await waitFor(() => {
    expect(
      result.current.tasks.find((t) => t.meta.id === 't-2')?.meta.title
    ).toBe('Clear now');
  });
  taskDocs.set('t-2', draft('Clear now', 'ready', '2026-01-03T00:00:00.000Z'));
  act(() => {
    sink?.onEvent({ type: 'task.changed', ids: ['t-2'] });
  });
  await waitFor(() => {
    expect(result.current.readyIds.has('t-2')).toBe(true);
  });
  expect(result.current.readinessById.get('t-2')).toBeUndefined();
  taskListFixture = null;
  configFixture = null;
  readinessFixture = {};
});

// Mounts with a one-ready-task list and a config, returning the hook's result.
async function mountReadyTask(onRunDispatched?: (runId: string) => void) {
  configFixture = {
    statuses: ['draft', 'ready', 'working', 'review', 'landed', 'dropped'],
    notifications: { kinds: null },
  };
  taskListFixture = [
    { meta: taskDoc('t-1', 'Ready one', '2026-01-01T00:00:00.000Z').meta },
  ];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () => useDispatchProject('/repo', { selectedRunId: null, onRunDispatched }),
    { wrapper: wrapper(queryClient) }
  );
  await waitFor(() => {
    expect([...result.current.readyIds]).toEqual(['t-1']);
  });
  return result;
}

const statusOf = (tasks: TaskListItem[]) => tasks[0]?.meta.status;

test('an optimistic dispatch shows the task started before the daemon answers', async () => {
  const followed: string[] = [];
  const result = await mountReadyTask((runId) => followed.push(runId));
  let answer: (run: RunMeta) => void = () => {};
  createRunResult = () => new Promise((resolve) => (answer = resolve));

  let sent: Promise<void> = Promise.resolve();
  act(() => {
    sent = result.current.handleDispatch('t-1', undefined, undefined, {
      optimistic: true,
    });
  });
  expect(statusOf(result.current.tasks)).toBe('working');
  expect(result.current.readyIds.has('t-1')).toBe(false);

  await act(async () => {
    answer(runFixture('r-1', 'running'));
    await sent;
  });
  expect(followed).toEqual([]);
  taskListFixture = null;
  configFixture = null;
});

test('a refused optimistic dispatch puts the task back and rejects', async () => {
  const result = await mountReadyTask();
  createRunResult = () => Promise.reject(new Error('task is blocked'));

  let error: unknown = null;
  await act(async () => {
    await result.current
      .handleDispatch('t-1', undefined, undefined, { optimistic: true })
      .catch((err: unknown) => {
        error = err;
      });
  });
  expect((error as Error | null)?.message).toBe('task is blocked');
  expect(statusOf(result.current.tasks)).toBe('ready');
  expect(result.current.readyIds.has('t-1')).toBe(true);
  taskListFixture = null;
  configFixture = null;
});

// A reconnect is likely a restarted daemon, which may have a judgment client now, so the
// back-off an unjudged answer set must not hold the next judge for minutes.
test('a reconnect judges readiness again after an unjudged answer', async () => {
  judgedFixture = [{ meta: { id: 't-1' } }];
  judgeCalls = 0;
  const result = await mountReadyTask();
  await waitFor(
    () => {
      expect(judgeCalls).toBe(1);
    },
    { timeout: 4000 }
  );
  judgedFixture = [
    {
      meta: { id: 't-1' },
      readiness: { level: 2, label: 'ok', confidence: 1, splitProbability: 0 },
    },
  ];

  act(() => {
    sink?.onEvent({ type: 'hello', version: '0.0.1' });
  });
  await waitFor(
    () => {
      expect(result.current.readinessById.get('t-1')?.level).toBe(2);
    },
    { timeout: 4000 }
  );
  expect(judgeCalls).toBe(2);
  judgedFixture = [];
  taskListFixture = null;
  configFixture = null;
});

// Every board card takes moveTaskStatus. It used to hang off the archived ids, rebuilt on
// each task change, so a dispatch handed every card a new callback and redrew them all.
test('moveTaskStatus keeps its identity through a dispatch', async () => {
  const result = await mountReadyTask();
  const move = result.current.moveTaskStatus;
  createRunResult = () => new Promise(() => {});
  act(() => {
    void result.current.handleDispatch('t-1', undefined, undefined, {
      optimistic: true,
    });
  });
  expect(statusOf(result.current.tasks)).toBe('working');
  expect(result.current.moveTaskStatus).toBe(move);
  taskListFixture = null;
  configFixture = null;
});

test('moveTaskStatus leaves an archived task alone', async () => {
  configFixture = {
    statuses: ['draft', 'ready', 'working', 'review', 'landed', 'dropped'],
    notifications: { kinds: null },
  };
  const live = taskDoc('t-1', 'Live', '2026-01-01T00:00:00.000Z');
  const shelved = taskDoc('t-2', 'Shelved', '2026-01-01T00:00:00.000Z');
  shelved.meta.archivedAt = '2026-01-02T00:00:00.000Z';
  taskListFixture = [{ meta: live.meta }, { meta: shelved.meta }];
  taskDocs.set('t-1', live);
  taskDocs.set('t-2', shelved);
  taskUpdates.length = 0;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () => useDispatchProject('/repo', { selectedRunId: null }),
    { wrapper: wrapper(queryClient) }
  );
  await waitFor(() => {
    expect(result.current.archivedTasks.map((t) => t.meta.id)).toEqual(['t-2']);
  });

  await act(async () => {
    await result.current.moveTaskStatus('t-2', 'working');
    await result.current.moveTaskStatus('t-1', 'review');
  });
  expect(taskUpdates).toEqual([['t-1', { status: 'review' }]]);
  expect(result.current.archivedTasks[0]?.meta.status).toBe('ready');
  taskDocs.clear();
  taskListFixture = null;
  configFixture = null;
});

// The list, config, identity, runs and people start as the connection resolves; the rest
// wait for the list, so the first paint's requests and renders go first. The prefetch and
// the hook's own query are one fetch.
test('first-paint reads go first; the rest wait for the list', async () => {
  taskListFixture = [
    { meta: taskDoc('t-1', 'Only', '2026-01-01T00:00:00.000Z').meta },
  ];
  let release: () => void = () => {};
  taskListGate = new Promise((resolve) => (release = resolve));
  taskListFetches = 0;
  presenceFetches = 0;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () => useDispatchProject('/repo', { selectedRunId: null }),
    { wrapper: wrapper(queryClient) }
  );
  await waitFor(() => {
    expect(taskListFetches).toBe(1);
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(presenceFetches).toBe(0);

  await act(async () => {
    release();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(result.current.tasks).toHaveLength(1);
    expect(presenceFetches).toBe(1);
  });
  expect(taskListFetches).toBe(1);
  taskListGate = null;
  taskListFixture = null;
});

test('an unscoped task.changed burst refetches the list once', async () => {
  const { titles } = await mountWithTaskList();
  taskListFixture = [
    { meta: taskDoc('t-1', 'Refetched', '2026-01-02T00:00:00.000Z').meta },
  ];

  act(() => {
    for (let i = 0; i < 3; i++) sink?.onEvent({ type: 'task.changed' });
  });
  await waitFor(() => {
    expect(titles()).toEqual(['Refetched']);
  });
  expect(taskListFetches).toBe(1);
  taskListFixture = null;
});

function runFixture(id: string, state: RunMeta['state']): RunMeta {
  return {
    id,
    taskId: 't-1',
    taskTitle: 'Needs a shared export',
    executor: 'claude',
    state,
    branch: `dispatch/${id}`,
    baseBranch: 'main',
    worktreePath: `/tmp/${id}`,
    createdAt: '2026-08-23T00:00:00Z',
    updatedAt: '2026-08-23T00:00:00Z',
  };
}

function scopeRequestFixture(id: string, runId: string): RunScopeRequest {
  return {
    id,
    runId,
    paths: ['packages/core/src/browser.ts'],
    reason: 'the type my scoped code needs is not re-exported',
    requestedAt: '2026-08-23T00:00:01Z',
    granted: null,
    decisionReason: null,
    decidedAt: null,
    decidedBy: null,
  };
}

// Incident 2026-08-23: the only way this hook learned of a scope request was
// the live `scope.requested` frame. An app relaunched after a dispatchd
// restart never received it, so the card the human had not decided vanished
// for good. The daemon now persists the request and carries it onto the
// resumed run; this pins the app's half — the open requests of every live run
// are read back without any event having arrived.
test("a live run's open scope request is surfaced from the listing, without a scope.requested event", async () => {
  runsFixture = [
    runFixture('r-resumed', 'running'),
    runFixture('r-dead', 'failed'),
  ];
  openScopeRequests = new Map([
    ['r-resumed', [scopeRequestFixture('sr-abc123', 'r-resumed')]],
  ]);
  scopeRequestListings.length = 0;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () => useDispatchProject('/repo', { selectedRunId: null }),
    { wrapper: wrapper(queryClient) }
  );

  await waitFor(() => {
    expect(result.current.pendingScopeRequests.get('r-resumed')).toEqual({
      requestId: 'sr-abc123',
    });
  });
  // Only live runs are asked: the force-failed predecessor has no agent
  // listening, and its card (if any) belongs to the decision feed.
  expect(scopeRequestListings).toEqual(['r-resumed']);
  expect(result.current.pendingScopeRequests.has('r-dead')).toBe(false);

  runsFixture = [];
  openScopeRequests = new Map();
});

function epicProgressFixtureFor(epicId: string): EpicProgress {
  return {
    epicId,
    active: false,
    session: null,
    spend: {
      settledUsd: 0,
      liveCount: 0,
      estimatedLiveUsd: 0,
      runsStarted: 0,
      maxSpendUsd: null,
      maxRuns: null,
    },
    children: [],
    waves: [],
    liveRuns: [],
  };
}

// Mounts the hook against `epics` worth of progress and waits for the bulk
// listing to land, returning the query client and the hook's live result.
async function mountWithEpics(epics: string[]) {
  epicProgressFixture = epics.map(epicProgressFixtureFor);
  epicProgressFetches = 0;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = renderHook(
    () => useDispatchProject('/repo', { selectedRunId: null }),
    { wrapper: wrapper(queryClient) }
  );
  await waitFor(() => {
    expect(rendered.result.current.epicProgressById.size).toBe(epics.length);
  });
  return { queryClient, result: rendered.result };
}

// A fan-out of dozens of milestones used to be a burst of dozens of progress
// GETs on every run change; the hook now asks once for all of them.
test('three epics are filled from a single bulk progress fetch', async () => {
  const { result } = await mountWithEpics(['e-1', 'e-2', 'e-3']);

  expect(epicProgressFetches).toBe(1);
  expect([...result.current.epicProgressById.keys()].sort()).toEqual([
    'e-1',
    'e-2',
    'e-3',
  ]);
  expect(result.current.epicProgressById.get('e-2')?.epicId).toBe('e-2');
  epicProgressFixture = [];
});

test('a burst of epic and run events refetches progress once', async () => {
  await mountWithEpics(['e-1']);
  epicProgressFetches = 0;

  act(() => {
    sink?.onEvent({ type: 'epic.changed', epicId: 'e-1' });
    sink?.onEvent({ type: 'run.changed' });
    sink?.onEvent({ type: 'epic.changed', epicId: 'e-1' });
  });

  await waitFor(() => {
    expect(epicProgressFetches).toBe(1);
  });
  await new Promise((r) => setTimeout(r, 400));
  expect(epicProgressFetches).toBe(1);
  epicProgressFixture = [];
});

// The paused row is worded from the event's own numbers and the cached task
// title, so it lands before (and regardless of) the progress refetch the same
// frame triggers.
test('epic.paused records a durable inbox row from the event alone', async () => {
  const { queryClient, result } = await mountWithEpics(['e-1']);
  queryClient.setQueryData(
    ['dispatch-tasks', PORT],
    [
      {
        meta: {
          id: 'e-1',
          title: 'Auth rewrite',
          kind: 'epic',
          blockedBy: [],
        },
      } as unknown as TaskListItem,
    ]
  );
  expect(result.current.notificationInbox.entries).toEqual([]);

  act(() => {
    sink?.onEvent({
      type: 'epic.paused',
      epicId: 'e-1',
      reason: 'budget',
      settledUsd: 41.2,
      estimatedLiveUsd: 30,
      maxSpendUsd: 60,
      runsStarted: 7,
      maxRuns: 20,
    });
  });

  const [row] = result.current.notificationInbox.entries;
  expect(row?.title).toBe('Auth rewrite paused — spend ceiling');
  expect(row?.body).toBe(
    '$41.20 settled + ~$30.00 in flight of $60.00. Resume or raise the ceiling to continue.'
  );
  expect(row?.target).toEqual({ kind: 'task', taskId: 'e-1' });
  expect(row?.read).toBe(false);
  epicProgressFixture = [];
});

// Both the pre-fan-out number form and the options form reach `startEpic`;
// the number is `{ concurrency }` with no ceilings, the options pass through.
test('handleWorkEpic forwards a bare concurrency and a full options body', async () => {
  const { result } = await mountWithEpics(['e-1']);
  epicStarts.length = 0;

  await act(async () => {
    await result.current.handleWorkEpic('e-1', 3);
  });
  await act(async () => {
    await result.current.handleWorkEpic('e-1', {
      concurrency: 3,
      maxSpendUsd: 60,
    });
  });

  expect(epicStarts).toEqual([
    ['e-1', { concurrency: 3, maxSpendUsd: undefined, maxRuns: undefined }],
    ['e-1', { concurrency: 3, maxSpendUsd: 60, maxRuns: undefined }],
  ]);
  epicProgressFixture = [];
});

test('handleConfirmPlan returns the confirm result, and throws with no plan open', async () => {
  const { result } = await mountWithEpics([]);
  const proposal = { tasks: [] };

  // Settled by hand: bun's `rejects` matcher is not awaitable under the
  // repo's `await-thenable` rule.
  const refused = await result.current.handleConfirmPlan(proposal).then(
    () => 'resolved',
    (err: unknown) => (err instanceof Error ? err.message : 'not an Error')
  );
  expect(refused).toBe('no plan open to confirm');

  await act(async () => {
    await result.current.handleSubmitPrompt('split the auth rewrite');
  });
  await waitFor(() => {
    expect(result.current.planRecord?.id).toBe('p-1');
  });
  const confirmed = await result.current.handleConfirmPlan(proposal);
  expect(confirmed).toEqual({ epicId: 'e-1', taskIds: ['t-1'] });
});

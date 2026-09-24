import type { EpicProgress, RunMeta } from '@dispatch/client';
import type { TaskListItem } from '@dispatch/core/browser';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ReactNode } from 'react';

import type { DispatchProjectData } from '../../hooks/useDispatchProject';

// The split pane mounts the task page, whose Review mode pulls in the Pierre diff; its
// worker import only Vite resolves.
void mock.module('@/components/runs/PierreWorkerPool', () => ({
  PierreWorkerPool: ({ children }: { children: ReactNode }) => children,
}));

const { ContainerFlightPlanSection, FlightPlanHostContext } =
  await import('./ContainerFlightPlanSection');
const { FlightPlan } = await import('./FlightPlanView');

beforeEach(() => window.localStorage.clear());

function task(
  id: string,
  overrides: Partial<TaskListItem['meta']> = {}
): TaskListItem {
  return {
    meta: {
      id,
      title: `Title ${id}`,
      status: 'ready',
      kind: 'task',
      parent: 'e-1',
      milestone: null,
      blockedBy: [],
      labels: [],
      priority: 'medium',
      assignee: 'none',
      risk: 'routine',
      writes: ['src/x.ts'],
      external: null,
      created: `2026-09-01T00:00:0${id.slice(-1)}.000Z`,
      updated: '2026-09-10T00:00:00.000Z',
      dueDate: null,
      ...overrides,
    },
  } as TaskListItem;
}

const LIVE: RunMeta = {
  id: 'r-b',
  taskId: 't-b',
  taskTitle: 'Title t-b',
  executor: 'claude',
  state: 'running',
  branch: 'dispatch/t-b',
  baseBranch: 'epic/e-1',
  worktreePath: '/tmp',
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
  costUsd: 0.42,
};

// a (landed) and b (an agent on it) → c → d; e is free to go; f is Maya's, started.
function plan(
  overrides: Partial<Record<string, Partial<TaskListItem['meta']>>> = {}
) {
  const base = [
    task('e-1', { kind: 'milestone', parent: null, status: 'working' }),
    task('t-a', { status: 'landed' }),
    task('t-b', { status: 'working' }),
    task('t-c', { blockedBy: ['t-a', 't-b'] }),
    task('t-d', { blockedBy: ['t-c'] }),
    task('t-e'),
    task('t-f', { status: 'working', assignee: 'human:maya' }),
  ];
  return base.map((t) => ({
    ...t,
    meta: { ...t.meta, ...overrides[t.meta.id] },
  }));
}

function progress(state: 'active' | 'paused', concurrency = 2): EpicProgress {
  return {
    epicId: 'e-1',
    active: state === 'active',
    session: {
      epicId: 'e-1',
      concurrency,
      executor: 'fake',
      state,
      maxSpendUsd: null,
      maxRuns: null,
      startedAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z',
      active: state === 'active',
    },
    spend: {
      settledUsd: 0,
      liveCount: 1,
      estimatedLiveUsd: 0,
      runsStarted: 1,
      maxSpendUsd: null,
      maxRuns: null,
    },
    children: [],
    waves: [],
    liveRuns: [],
  };
}

function dataWith(
  tasks: TaskListItem[],
  runs: RunMeta[] = [LIVE],
  sessions: EpicProgress[] = []
): DispatchProjectData {
  const noop = () => Promise.resolve();
  return {
    client: {},
    port: 1,
    config: null,
    tasks,
    tasksIncludingArchived: tasks,
    tasksReady: true,
    runs,
    latestRunByTaskId: new Map(runs.map((r) => [r.taskId, r])),
    liveRunStateByTaskId: new Map(
      runs.filter((r) => r.state === 'running').map((r) => [r.taskId, r.state])
    ),
    epicProgressById: new Map(sessions.map((p) => [p.epicId, p])),
    linearLinks: {},
    branches: [],
    readyIds: new Set(),
    handlePauseEpic: noop,
    handleResumeEpic: noop,
    handleStopEpic: noop,
    handleLandEpic: noop,
    handleWorkEpic: noop,
  } as unknown as DispatchProjectData;
}

function mount(
  data: DispatchProjectData,
  dispatchTask: (taskId: string) => Promise<void> = () => Promise.resolve(),
  containerId = 'e-1'
) {
  const opened: string[] = [];
  const view = (d: DispatchProjectData) => (
    <FlightPlan
      containerId={containerId}
      data={d}
      dispatchTask={dispatchTask}
      onDispatchFailed={() => {}}
      onOpenTask={(id) => opened.push(id)}
      openIn="page"
    />
  );
  const result = render(view(data));
  return {
    ...result,
    opened,
    rerenderWith: (d: DispatchProjectData) => result.rerender(view(d)),
  };
}

const node = (id: string) =>
  document.querySelector<HTMLElement>(
    `[data-slot=flight-node][data-node-id="${id}"]`
  );
const stateOf = (id: string) => node(id)?.getAttribute('data-state');
const sentenceOf = (id: string) =>
  node(id)?.querySelector('[data-slot=flight-node-sentence]')?.textContent;
const canvas = () => screen.getByRole('group', { name: /Flight plan for/ });

describe('FlightPlan', () => {
  test('draws each child in its wave with its live state and reason', () => {
    mount(dataWith(plan()));
    expect(
      Array.from(document.querySelectorAll('[data-slot=flight-wave-head]')).map(
        (h) => h.textContent
      )
    ).toEqual(['Wave 11/4Now', 'Wave 20/1', 'Wave 30/1']);
    expect(['t-a', 't-b', 't-c', 't-d', 't-e', 't-f'].map(stateOf)).toEqual([
      'done',
      'running',
      'blocked',
      'blocked',
      'queued',
      'teammate',
    ]);
    expect(sentenceOf('t-a')).toBe('Landed');
    expect(sentenceOf('t-b')).toBe('Working');
    // t-a has landed, so only t-b still holds t-c.
    expect(sentenceOf('t-c')).toBe('Unblocks when t-b finishes');
    expect(sentenceOf('t-e')).toBe('Ready to dispatch');
    expect(node('t-b')?.textContent).toContain('$0.42');
    // The chain still ahead — b → c → d — is the critical path.
    expect(
      ['t-b', 't-c', 't-d', 't-e'].map((id) =>
        node(id)?.hasAttribute('data-critical')
      )
    ).toEqual([true, true, true, false]);
  });

  test('under an active session, blocked nodes auto-start and queued ones take a place', () => {
    mount(dataWith(plan({ 't-g': {} }), [LIVE], [progress('active', 2)]));
    expect(sentenceOf('t-c')).toBe('Auto-starts when t-b finishes');
    // Two slots, one running: the queued node is next.
    expect(sentenceOf('t-e')).toBe('Next up');
    expect(
      document
        .querySelector('[data-slot=flight-slots]')
        ?.getAttribute('aria-label')
    ).toBe('1 of 2 slots in use');
  });

  test('a blocker landing flips its dependent in place and lights the edge', () => {
    const view = mount(dataWith(plan()));
    const before = node('t-c')?.style.transform;
    expect(
      document.querySelectorAll('[data-slot=flight-edge][data-tone=flowing]')
        .length
    ).toBe(1);
    view.rerenderWith(dataWith(plan({ 't-b': { status: 'landed' } }), []));
    expect(stateOf('t-c')).toBe('queued');
    expect(node('t-c')?.style.transform).toBe(before);
    expect(
      document.querySelectorAll('[data-slot=flight-edge][data-tone=landed]')
        .length
    ).toBe(2);
  });

  test('arrows walk the grid, Enter opens, d dispatches optimistically', async () => {
    const sent: string[] = [];
    const view = mount(dataWith(plan()), (id) => {
      sent.push(id);
      return new Promise(() => {});
    });
    const press = (key: string) => fireEvent.keyDown(canvas(), { key });
    press('ArrowDown');
    expect(canvas().getAttribute('aria-activedescendant')).toBe(
      'flight-node-t-a'
    );
    press('ArrowDown');
    press('ArrowDown');
    expect(canvas().getAttribute('aria-activedescendant')).toBe(
      'flight-node-t-e'
    );
    press('Enter');
    expect(view.opened).toEqual(['t-e']);
    await act(async () => {
      press('d');
      await Promise.resolve();
    });
    expect(sent).toEqual(['t-e']);
    expect(stateOf('t-e')).toBe('running');
    expect(sentenceOf('t-e')).toBe('Starting');
    // A blocked node is not dispatchable.
    press('ArrowRight');
    expect(canvas().getAttribute('aria-activedescendant')).toBe(
      'flight-node-t-c'
    );
    press('d');
    expect(sent).toEqual(['t-e']);
  });

  test('a project bands its milestones', () => {
    const tasks = [
      task('e-p', { kind: 'project', parent: null }),
      task('e-1', { kind: 'milestone', parent: 'e-p', title: 'Alpha' }),
      task('e-2', { kind: 'milestone', parent: 'e-p', title: 'Beta' }),
      task('t-1', { parent: 'e-1' }),
      task('t-2', { parent: 'e-2', blockedBy: ['t-1'] }),
    ];
    mount(dataWith(tasks, []), undefined, 'e-p');
    expect(
      Array.from(document.querySelectorAll('[data-slot=flight-band-head]')).map(
        (b) => b.getAttribute('data-band')
      )
    ).toEqual(['e-1', 'e-2']);
    expect(sentenceOf('t-2')).toBe('Unblocks when t-1 finishes');
  });

  test('an empty container says what will appear', () => {
    mount(dataWith([task('e-1', { kind: 'milestone', parent: null })], []));
    expect(screen.getByText('Nothing to plan yet')).toBeTruthy();
  });

  test('the section draws from the app’s host, and nothing without one', () => {
    const { container, unmount } = render(
      <ContainerFlightPlanSection containerId="e-1" />
    );
    expect(container.innerHTML).toBe('');
    unmount();
    render(
      <FlightPlanHostContext.Provider
        value={{
          data: dataWith(plan()),
          dispatchTask: () => Promise.resolve(),
          onDispatchFailed: () => {},
          onOpenTask: () => {},
          onPeekTask: () => {},
        }}
      >
        <ContainerFlightPlanSection containerId="e-1" />
      </FlightPlanHostContext.Provider>
    );
    expect(document.querySelectorAll('[data-slot=flight-node]')).toHaveLength(
      6
    );
  });
});

import type { RunMeta } from '@dispatch/client';
import type { TaskDoc } from '@dispatch/core/browser';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'bun:test';
import type { ReactNode } from 'react';

import { testConfig } from '../components/settings/fixtures.test-helper';
import {
  type CreateTaskPreset,
  type ShellActions,
  ShellActionsProvider,
} from '../components/shell/ShellActionsContext';
import type { DispatchProjectData } from '../hooks/useDispatchProject';
import { MilestonesView } from './MilestonesView';

// Collapse state is session-scoped; start every test with nothing folded.
beforeEach(() => window.sessionStorage.clear());

function task(
  id: string,
  title: string,
  overrides: Partial<TaskDoc['meta']> = {}
): TaskDoc {
  return {
    meta: {
      id,
      title,
      status: 'ready',
      kind: 'task',
      priority: 'medium',
      parent: null,
      milestone: null,
      labels: [],
      assignee: 'none',
      blockedBy: [],
      created: '2026-08-10T12:00:00.000Z',
      updated: '2026-09-13T12:00:00.000Z',
      ...overrides,
    },
    body: '',
  } as unknown as TaskDoc;
}

function run(taskId: string, state: RunMeta['state'] = 'running'): RunMeta {
  return {
    id: `r-${taskId}`,
    taskId,
    taskTitle: taskId,
    executor: 'claude',
    state,
    branch: 'b',
    baseBranch: 'main',
    worktreePath: '/tmp',
    createdAt: '2026-09-13T12:00:00.000Z',
    updatedAt: '2026-09-13T12:00:00.000Z',
  } as RunMeta;
}

function dataWith(
  tasks: TaskDoc[],
  epics: TaskDoc[],
  runs: RunMeta[] = []
): DispatchProjectData {
  return {
    client: {},
    portLoading: false,
    portError: false,
    config: testConfig,
    tasks,
    tasksIncludingArchived: tasks,
    archivedTasks: [],
    showArchived: false,
    epics,
    readyIds: new Set(tasks.map((t) => t.meta.id)),
    latestRunByTaskId: new Map(runs.map((r) => [r.taskId, r])),
    liveRunStateByTaskId: new Map(
      runs.filter((r) => r.state === 'running').map((r) => [r.taskId, r.state])
    ),
    attentionByTaskId: new Map(),
    moveTaskStatus: async () => {},
    handleUpdate: async () => {},
    handleDispatch: async () => {},
  } as unknown as DispatchProjectData;
}

function shellWith(log: { presets: CreateTaskPreset[]; views: string[] }) {
  const noop = () => {};
  const actions = {
    openTask: noop,
    peekTask: noop,
    openCreateTask: (preset?: CreateTaskPreset) =>
      log.presets.push(preset ?? {}),
    createPreset: null,
    closeCreateTask: noop,
    openPalette: noop,
    toggleSidebar: noop,
    sidebarHidden: false,
    openOverseer: noop,
    setProjectView: (view: string) => log.views.push(view),
    setGlobalView: noop,
    openShortcuts: noop,
    copyTaskId: noop,
  } as unknown as ShellActions;
  return function Shell({ children }: { children: ReactNode }) {
    return (
      <ShellActionsProvider value={actions}>{children}</ShellActionsProvider>
    );
  };
}

function renderMilestones(
  data: DispatchProjectData,
  onOpenTask: (id: string) => void = () => {}
) {
  const log = { presets: [] as CreateTaskPreset[], views: [] as string[] };
  const Shell = shellWith(log);
  const result = render(
    <Shell>
      <MilestonesView data={data} onOpenTask={onOpenTask} />
    </Shell>
  );
  return { ...result, log };
}

const payments = task('e-1', 'Payments', { kind: 'epic' });
const shipped = task('e-2', 'Shipped', { kind: 'epic' });

test('each milestone is a status-tinted GroupHeader with a ◔ n/m progress glyph over ListRows', () => {
  const { container } = renderMilestones(
    dataWith(
      [
        payments,
        task('t-1', 'Charge card', { parent: 'e-1', status: 'working' }),
        task('t-2', 'Refund flow', { parent: 'e-1', status: 'landed' }),
      ],
      [payments]
    )
  );

  const header = container.querySelector<HTMLElement>(
    '[data-slot="group-header"]'
  );
  if (header === null) throw new Error('no milestone header');
  expect(header.className.split(/\s+/)).toContain('h-9');
  expect(header.style.getPropertyValue('--tint')).toBe(
    'var(--status-progress)'
  );
  expect(
    header.querySelector('[data-slot="group-header-name"]')?.textContent
  ).toBe('Payments');
  expect(header.querySelector('[aria-label="Status: working"]')).not.toBeNull();
  expect(
    header.querySelector('[data-slot="milestone-progress"]')?.textContent
  ).toBe('1/2');
  // No progress bar, no card, no dimming.
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  expect(container.querySelector('.saturate-50')).toBeNull();
  expect(
    container.querySelector('[data-slot="pill"][class*="dense"]')
  ).toBeNull();

  const rows = Array.from(
    container.querySelectorAll<HTMLElement>('[data-slot="list-row"]')
  );
  expect(rows.map((r) => r.dataset.rowId)).toEqual(['t-1', 't-2']);
  expect(rows[0]?.className.split(/\s+/)).toContain('h-9');
});

test('rows are editable through the same pickers as the list, without the epic chip', () => {
  renderMilestones(
    dataWith(
      [payments, task('t-1', 'Charge card', { parent: 'e-1' })],
      [payments]
    )
  );

  expect(screen.getByRole('button', { name: 'Change status' })).not.toBeNull();
  expect(
    screen.getByRole('button', { name: 'Change priority' })
  ).not.toBeNull();
  expect(
    screen.getByRole('button', { name: 'Change assignee' })
  ).not.toBeNull();
  expect(screen.queryByTitle('Payments')).toBeNull();
});

test('health reads as one pill: N running on the working yellow, At risk on amber', () => {
  const { unmount } = renderMilestones(
    dataWith(
      [payments, task('t-1', 'Charge card', { parent: 'e-1' })],
      [payments],
      [run('t-1')]
    )
  );
  expect(screen.getByText('1 running')).not.toBeNull();
  unmount();

  renderMilestones(
    dataWith(
      [payments, task('t-1', 'Charge card', { parent: 'e-1' })],
      [payments],
      [run('t-1', 'failed')]
    )
  );
  const pill = screen.getByText('At risk').closest('[data-slot="label-pill"]');
  expect(pill?.getAttribute('title')).toBe('1 has failed.');
});

test('a finished milestone sinks to the bottom, starts collapsed, and reopens on its chevron', () => {
  const { container } = renderMilestones(
    dataWith(
      [
        shipped,
        task('t-9', 'Old work', { parent: 'e-2', status: 'landed' }),
        payments,
        task('t-1', 'Charge card', { parent: 'e-1' }),
      ],
      [shipped, payments]
    )
  );

  const names = Array.from(
    container.querySelectorAll<HTMLElement>('[data-slot="group-header-name"]')
  ).map((n) => n.innerText);
  expect(names).toEqual(['Payments', 'Shipped']);
  expect(screen.queryByText('Old work')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Expand group' }));
  expect(screen.getByText('Old work')).not.toBeNull();
});

test('j/k and Enter walk and open the rows; + presets the milestone', () => {
  const opened: string[] = [];
  const { log } = renderMilestones(
    dataWith(
      [
        payments,
        task('t-1', 'Charge card', { parent: 'e-1' }),
        task('t-2', 'Refund flow', { parent: 'e-1' }),
      ],
      [payments]
    ),
    (id) => opened.push(id)
  );
  const grid = screen.getByRole('grid', { name: 'Milestones' });

  fireEvent.keyDown(grid, { key: 'j' });
  fireEvent.keyDown(grid, { key: 'Enter' });
  expect(opened).toEqual(['t-2']);

  fireEvent.keyDown(grid, { key: 'p' });
  expect(
    document
      .querySelector('[data-row-id="t-2"] [aria-label="Change priority"]')
      ?.getAttribute('aria-expanded')
  ).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: 'New task in Payments' }));
  expect(log.presets).toEqual([{ milestone: 'e-1' }]);
});

test('with no milestones the empty state offers Plan work…', () => {
  const { log } = renderMilestones(dataWith([task('t-1', 'Loose task')], []));

  expect(screen.getByText('No milestones yet')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Plan work…' }));
  expect(log.views).toEqual(['plans']);
});

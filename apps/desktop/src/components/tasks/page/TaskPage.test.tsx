import type { TaskComment } from '@dispatch/core/browser';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, mock, test } from 'bun:test';
import type { ReactNode } from 'react';

import type { TaskTab } from '../../../lib/appNav';
import {
  fakeHost,
  newLog,
  PageProviders,
  run,
  task,
} from './pageHost.test-helper';
import type { TaskPageHost } from './TaskPageHost';

// The Review mode pulls in the Pierre diff, whose worker import only Vite resolves.
void mock.module('@/components/runs/PierreWorkerPool', () => ({
  PierreWorkerPool: ({ children }: { children: ReactNode }) => children,
}));

const { TaskPage } = await import('./TaskPage');

const BODY = `## Description

Apply the **Burgess** rule everywhere.

## Acceptance Criteria

- tests pass
- docs updated

## Activity

- 2026-09-13T10:00:00.000Z dispatched (claude, branch dispatch/t-1)
`;

function mount(
  host: TaskPageHost,
  props: Partial<Parameters<typeof TaskPage>[0]> = {}
) {
  return render(
    <PageProviders host={host}>
      <TaskPage taskId="t-1" layout="peek" {...props} />
    </PageProviders>
  );
}

function modeOf(): string | null {
  return (
    document
      .querySelector('[data-slot=task-page]')
      ?.getAttribute('data-mode') ?? null
  );
}

function comment(
  id: string,
  author: string,
  body: string,
  parentId: string | null = null
): TaskComment {
  return {
    id,
    taskId: 't-1',
    author,
    body,
    created: '2026-09-23T10:00:00.000Z',
    updated: '2026-09-23T10:00:00.000Z',
    parentId,
    external: null,
  };
}

function press(key: string) {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true })
    );
  });
}

// Opens the header's More actions menu and lets its popup settle inside act.
async function openMoreActions() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('opening a task', () => {
  test('metadata renders at once; the body streams in behind skeletons', () => {
    mount(fakeHost(newLog(), { tasks: [task('t-1')] }));
    // Title and the lifecycle track straight from the cached list.
    expect(screen.getByLabelText('Task title')).toHaveProperty(
      'value',
      'Title of t-1'
    );
    expect(screen.getByRole('tablist', { name: 'Task stages' })).not.toBeNull();
    expect(modeOf()).toBe('spec');
    // The body has not arrived: its sections hold skeletons, not a blank page.
    expect(screen.getAllByLabelText('Loading').length).toBeGreaterThan(0);
  });

  test('the body fills the spec when it lands', async () => {
    mount(fakeHost(newLog(), { tasks: [task('t-1')], body: BODY }));
    await waitFor(() => expect(screen.getByText('tests pass')).not.toBeNull());
    expect(screen.getByText('docs updated')).not.toBeNull();
    expect(screen.getByText('Burgess')).not.toBeNull();
  });

  test('a task that left the list reads as gone', () => {
    mount(fakeHost(newLog(), { tasks: [] }));
    expect(
      screen.getByText('That task is no longer available.')
    ).not.toBeNull();
  });
});

describe('the mode follows the task', () => {
  test('a live run opens on the run', () => {
    mount(
      fakeHost(newLog(), {
        tasks: [task('t-1', { status: 'working' })],
        runs: [run()],
      })
    );
    expect(modeOf()).toBe('run');
    expect(document.querySelector('[data-slot=run-strip]')).not.toBeNull();
  });

  test('a finished run opens on its review', () => {
    mount(
      fakeHost(newLog(), {
        tasks: [task('t-1', { status: 'review' })],
        runs: [run({ state: 'finished', costUsd: 0.42 })],
      })
    );
    expect(modeOf()).toBe('review');
    expect(screen.getByRole('button', { name: /^Land/ })).not.toBeNull();
  });

  test('a live run’s review offers no verdict until it finishes', () => {
    mount(
      fakeHost(newLog(), {
        tasks: [task('t-1', { status: 'working' })],
        runs: [run()],
      })
    );
    fireEvent.click(screen.getByRole('tab', { name: /Review/ }));
    expect(modeOf()).toBe('review');
    expect(screen.queryByRole('button', { name: /^Land/ })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'More ways to land' })
    ).toBeNull();
    expect(screen.getByText('Lands once it finishes')).not.toBeNull();
  });

  test('landed work opens on its summary', () => {
    mount(
      fakeHost(newLog(), {
        tasks: [task('t-1', { status: 'landed' })],
        runs: [
          run({
            state: 'finished',
            reviewedAt: '2026-09-23T11:00:00.000Z',
            reviewAction: 'merge',
            mergeCommit: 'abc1234def',
          }),
        ],
      })
    );
    expect(modeOf()).toBe('summary');
    expect(screen.getByText('Merged into main')).not.toBeNull();
    expect(screen.getByText('abc1234')).not.toBeNull();
  });

  test('a task reopened after it landed opens on its spec, with Dispatch', () => {
    mount(
      fakeHost(newLog(), {
        tasks: [task('t-1', { status: 'ready' })],
        runs: [
          run({
            state: 'finished',
            reviewedAt: '2026-09-23T11:00:00.000Z',
            reviewAction: 'merge',
            mergeCommit: 'abc1234def',
          }),
        ],
      })
    );
    expect(modeOf()).toBe('spec');
    expect(document.querySelector('[data-slot=dispatch-card]')).not.toBeNull();
  });

  test('a container opens on its plan, where the Flight Plan draws every sub-issue', () => {
    mount(
      fakeHost(newLog(), {
        tasks: [
          task('t-1', { kind: 'milestone', status: 'working' }),
          task('t-2', { parent: 't-1' }),
        ],
      })
    );
    expect(modeOf()).toBe('plan');
    expect(document.querySelector('[data-slot=plan-mode]')).not.toBeNull();
    // The plan is the list, so the rail leaves its sub-issue excerpt out.
    expect(screen.queryByText('Sub-issues')).toBeNull();
  });

  test('a container’s spec lists its sub-issues once, with a way to add one', () => {
    mount(
      fakeHost(newLog(), {
        tasks: [
          task('t-1', { kind: 'milestone', status: 'working' }),
          task('t-2', { parent: 't-1' }),
        ],
      })
    );
    fireEvent.click(screen.getByRole('tab', { name: /Spec/ }));
    expect(modeOf()).toBe('spec');
    expect(screen.getAllByText('Sub-issues')).toHaveLength(1);
    expect(screen.getByText('Title of t-2')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Add sub-task to Title of t-1' })
    ).not.toBeNull();
    // A container fans out from its plan, never as one run of its own.
    expect(document.querySelector('[data-slot=dispatch-card]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open plan' }));
    expect(modeOf()).toBe('plan');
  });

  test('a stage picked by hand holds; picking the state’s own follows again', () => {
    mount(fakeHost(newLog(), { tasks: [task('t-1')] }));
    fireEvent.click(screen.getByRole('tab', { name: /Summary/ }));
    expect(modeOf()).toBe('summary');
    fireEvent.click(screen.getByRole('tab', { name: /Spec/ }));
    expect(modeOf()).toBe('spec');
  });

  test('the full page keeps its mode in the caller, as auto when it follows state', () => {
    const changes: TaskTab[] = [];
    mount(fakeHost(newLog(), { tasks: [task('t-1')] }), {
      layout: 'full',
      mode: 'auto',
      onModeChange: (tab) => changes.push(tab),
    });
    fireEvent.click(screen.getByRole('tab', { name: /Review/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Spec/ }));
    expect(changes).toEqual(['review', 'auto']);
  });
});

describe('opening a run by id', () => {
  // An execute run that finished, and the review agent that is checking it.
  const runs = [
    run({ id: 'r-exec', state: 'finished' }),
    run({
      id: 'r-review',
      kind: 'review',
      branch: 'dispatch/review-t-1-review',
      baseBranch: 'dispatch/t-1',
      createdAt: '2026-09-23T11:00:00.000Z',
    }),
  ];
  function hostFetching(fetched: string[]) {
    return fakeHost(newLog(), {
      tasks: [task('t-1', { status: 'review' })],
      runs,
      client: {
        fetchRun: (id: string) => {
          fetched.push(id);
          return new Promise(() => {});
        },
      },
    });
  }

  test('a review agent’s run shows its own transcript, named by kind', async () => {
    const fetched: string[] = [];
    mount(hostFetching(fetched), {
      layout: 'full',
      mode: 'run',
      runId: 'r-review',
    });
    await waitFor(() => expect(fetched).toEqual(['r-review']));
    const strip = document.querySelector('[data-slot=run-strip]');
    expect(strip?.textContent).toContain('r-review');
    expect(strip?.textContent).toContain('Review');
  });

  test('Review mode judges the work a picked review run checked', async () => {
    const fetched: string[] = [];
    mount(hostFetching(fetched), {
      layout: 'full',
      mode: 'review',
      runId: 'r-review',
    });
    await waitFor(() => expect(fetched).toEqual(['r-exec']));
    expect(
      document.querySelector('[data-slot=run-strip]')?.textContent
    ).toContain('r-exec');
  });
});

describe('dispatching from the spec', () => {
  test('Dispatch sends the task and keeps a split pane where it is', async () => {
    const log = newLog();
    mount(fakeHost(log, { tasks: [task('t-1', { writes: ['src/**'] })] }), {
      layout: 'split',
    });
    fireEvent.click(screen.getByRole('button', { name: /^Dispatch/ }));
    await waitFor(() =>
      expect(log.dispatches).toEqual([{ taskId: 't-1', stayInPlace: true }])
    );
    expect(screen.getByText('Starting an agent…')).not.toBeNull();
  });

  test('unmet blockers are named and the button asks to go anyway', () => {
    mount(
      fakeHost(newLog(), {
        tasks: [task('t-1', { blockedBy: ['t-2'] }), task('t-2')],
      })
    );
    expect(
      document.querySelector('[data-check=blockers]')?.textContent
    ).toContain('Waits on 1 task');
    expect(
      screen.getByRole('button', { name: /Dispatch anyway/ })
    ).not.toBeNull();
  });

  test('a blocker id naming no task does not hold the task back', () => {
    mount(
      fakeHost(newLog(), {
        tasks: [task('t-1', { blockedBy: ['t-gone'], writes: ['src/**'] })],
        body: BODY,
      })
    );
    expect(
      document.querySelector('[data-check=blockers]')?.getAttribute('data-tone')
    ).toBe('warn');
    expect(screen.queryByText('Waiting on its blockers')).toBeNull();
    expect(screen.getByRole('button', { name: /^Dispatch/ }).textContent).toBe(
      'DispatchD'
    );
  });

  test('a landed task says to reopen it, and nothing dispatches it', () => {
    const log = newLog();
    mount(fakeHost(log, { tasks: [task('t-1', { status: 'landed' })] }), {
      layout: 'full',
    });
    fireEvent.click(screen.getByRole('tab', { name: /Spec/ }));
    expect(screen.getByText('Closed: reopen it to dispatch')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Dispatch/ })).toHaveProperty(
      'disabled',
      true
    );
    // A dispatch reaches the host synchronously, so none by now means none at all.
    press('d');
    expect(log.dispatches).toEqual([]);
  });

  test('a dropped task’s menu offers no dispatch', async () => {
    mount(fakeHost(newLog(), { tasks: [task('t-1', { status: 'dropped' })] }));
    await openMoreActions();
    const item = screen.getByRole('menuitem', { name: /Dispatch/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
  });

  test('d goes whenever the card offers D: a blocker in review is met', async () => {
    const log = newLog();
    mount(
      fakeHost(log, {
        tasks: [
          task('t-1', { blockedBy: ['t-2'] }),
          task('t-2', { status: 'review' }),
        ],
      }),
      { layout: 'full' }
    );
    expect(
      document.querySelector('[data-check=blockers]')?.textContent
    ).toContain('Blockers done');
    expect(screen.getByRole('button', { name: /^Dispatch/ }).textContent).toBe(
      'DispatchD'
    );
    press('d');
    await waitFor(() => expect(log.dispatches).toHaveLength(1));
  });

  test('d never goes ahead of blockers, and the card shows no D for it', async () => {
    const log = newLog();
    mount(
      fakeHost(log, {
        tasks: [task('t-1', { blockedBy: ['t-2'] }), task('t-2')],
      }),
      { layout: 'full' }
    );
    expect(screen.getByRole('button', { name: /^Dispatch/ }).textContent).toBe(
      'Dispatch anyway'
    );
    press('d');
    expect(log.dispatches).toEqual([]);
    // The header menu offers the same deliberate go-ahead as the card.
    await openMoreActions();
    const item = screen.getByRole('menuitem', { name: /Dispatch anyway/ });
    expect(item.getAttribute('aria-disabled')).toBeNull();
  });

  test('d dispatches a ready task from anywhere on the page', async () => {
    const log = newLog();
    mount(fakeHost(log, { tasks: [task('t-1')] }), { layout: 'full' });
    press('d');
    await waitFor(() => expect(log.dispatches).toHaveLength(1));
    expect(log.dispatches[0]?.stayInPlace).toBe(false);
  });
});

describe('the rail', () => {
  test('property edits go through the project’s update', async () => {
    const log = newLog();
    mount(fakeHost(log, { tasks: [task('t-1')] }));
    fireEvent.click(screen.getByRole('button', { name: 'Change estimate' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '3 points' }));
    expect(log.updates).toEqual([{ id: 't-1', patch: { estimate: 3 } }]);
  });

  test('a new comment shows at once, and only its author gets a comment’s menu', async () => {
    const log = newLog();
    mount(
      fakeHost(log, {
        tasks: [task('t-1')],
        comments: [
          comment('c-1', 'human:wyat', 'mine'),
          comment('c-2', 'human:maya', 'theirs'),
          comment('c-3', 'human:maya', 'a reply', 'c-1'),
        ],
      })
    );
    await waitFor(() => expect(screen.getByText('theirs')).not.toBeNull());
    expect(
      screen.getAllByRole('button', { name: 'Comment actions' })
    ).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Leave a comment'), {
      target: { value: 'ship it' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send comment' }));
    await waitFor(() => expect(screen.getByText('ship it')).not.toBeNull());
    expect(screen.getByText('Sending…')).not.toBeNull();
    expect(log.comments).toEqual(['ship it']);
  });

  test('s opens the status picker', async () => {
    mount(fakeHost(newLog(), { tasks: [task('t-1')] }), { layout: 'full' });
    press('s');
    expect(await screen.findByRole('menu')).not.toBeNull();
  });
});

describe('keyboard', () => {
  const opened = () => document.querySelector('[data-popup-open]') !== null;

  test('a property key opens its picker in the rail', async () => {
    mount(fakeHost(newLog(), { tasks: [task('t-1')] }));
    const main = document.querySelector('[data-slot=task-main]');
    if (main === null) throw new Error('no main pane');
    fireEvent.keyDown(main, { key: 's' });
    await waitFor(() => expect(opened()).toBe(true));
  });

  test('a key already handled, or meant for a page nested inside, is left alone', () => {
    mount(fakeHost(newLog(), { tasks: [task('t-1')] }));
    const main = document.querySelector('[data-slot=task-main]');
    if (main === null) throw new Error('no main pane');
    // The Flight Plan's canvas takes h/j/k/l and `d` itself.
    const canvas = document.createElement('div');
    canvas.addEventListener('keydown', (e) => e.preventDefault());
    main.append(canvas);
    fireEvent.keyDown(canvas, { key: 'l' });
    // The Flight Plan's pane holds a task page of its own.
    const nested = document.createElement('div');
    nested.dataset.slot = 'task-page';
    const inner = document.createElement('button');
    nested.append(inner);
    main.append(nested);
    fireEvent.keyDown(inner, { key: 's' });
    expect(opened()).toBe(false);
  });
});

import type {
  EpicProgress,
  EpicProgressChild,
  EpicSession,
} from '@dispatch/client';
import type { TaskDoc } from '@dispatch/core/browser';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'bun:test';
import { type ReactNode, useState } from 'react';

import { toggleCollapsedGroup } from '../../lib/collapsedEpics';
import type { WorkEpicOptions } from '../../lib/epicSession';
import {
  type CreateTaskPreset,
  type ShellActions,
  ShellActionsProvider,
} from '../shell/ShellActionsContext';
import { TaskBoard } from './TaskBoard';
import { TooltipProvider } from '@/ui/tooltip';

function task(
  id: string,
  title: string,
  status: string,
  parent: string | null = null,
  kind = 'task'
): TaskDoc {
  return {
    meta: {
      id,
      title,
      status,
      kind,
      priority: 'medium',
      parent,
      milestone: null,
      labels: [],
      assignee: 'none',
      blockedBy: [],
      created: '2026-08-10T00:00:00.000Z',
      updated: '2026-08-10T00:00:00.000Z',
    },
    body: '',
  } as unknown as TaskDoc;
}

const STATUSES = ['todo', 'in-progress', 'done'];

// A progress row with the session/spend/wave halves defaulted, so a test states only the
// children it cares about.
function progressFor(
  epicId: string,
  children: Pick<EpicProgressChild, 'id' | 'title' | 'status'>[],
  overrides: Partial<EpicProgress> = {}
): EpicProgress {
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
    children: children.map((c) => ({
      ...c,
      phase: c.status === 'landed' ? 'landed' : 'queued',
      wave: 1,
      openFindings: 0,
    })),
    waves: [],
    liveRuns: [],
    ...overrides,
  };
}

function sessionWith(
  state: EpicSession['state'],
  overrides: Partial<EpicSession> = {}
): EpicSession {
  return {
    epicId: 'e-1',
    concurrency: 3,
    executor: 'claude',
    state,
    maxSpendUsd: 60,
    maxRuns: 20,
    startedAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    active: state === 'active',
    ...overrides,
  };
}

const EPICS = [
  task('e-1', 'Payments epic', 'todo', null, 'epic'),
  task('e-2', 'Search epic', 'todo', null, 'epic'),
  task('e-empty', 'Nothing here epic', 'todo', null, 'epic'),
];

const TASKS = [
  ...EPICS,
  task('t-1', 'Card one', 'todo', 'e-1'),
  task('t-2', 'Card two', 'todo', 'e-1'),
  task('t-3', 'Card three', 'done', 'e-1'),
  task('t-4', 'Card four', 'todo', 'e-2'),
  task('t-loose', 'Unparented card', 'done'),
];

/** The shell seam the board needs: `+` presets. Records what it was asked. */
function shellWith(presets: CreateTaskPreset[]) {
  const noop = () => {};
  const actions = {
    openTask: noop,
    peekTask: noop,
    openCreateTask: (preset?: CreateTaskPreset) => {
      presets.push(preset ?? {});
    },
    createPreset: null,
    closeCreateTask: noop,
    openPalette: noop,
    toggleSidebar: noop,
    sidebarHidden: false,
    openOverseer: noop,
    setProjectView: noop,
    setGlobalView: noop,
    openShortcuts: noop,
    copyTaskId: noop,
  } satisfies ShellActions;
  return function Shell({ children }: { children: ReactNode }) {
    return (
      <ShellActionsProvider value={actions}>{children}</ShellActionsProvider>
    );
  };
}

/** Owns the collapsed-lane state the same way `BoardView` does, so a click on a lane header
 * actually folds the lane in the test rather than being swallowed by a static prop. */
function Harness({
  presets = [],
  ...props
}: Partial<Parameters<typeof TaskBoard>[0]> & {
  presets?: CreateTaskPreset[];
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const Shell = shellWith(presets);
  return (
    <Shell>
      <TooltipProvider>
        <TaskBoard
          tasks={TASKS}
          statuses={STATUSES}
          epics={EPICS}
          readyIds={new Set()}
          blockedIds={new Set()}
          liveRunStateByTaskId={new Map()}
          latestRunByTaskId={new Map()}
          epicProgressById={new Map()}
          epicConcurrencyDefault={3}
          groupByEpic
          collapsedLaneKeys={collapsed}
          onToggleLane={(key) =>
            setCollapsed((prev) => toggleCollapsedGroup(prev, key))
          }
          onSelect={() => {}}
          onWorkEpic={async () => {}}
          onStopEpic={async () => {}}
          {...props}
        />
      </TooltipProvider>
    </Shell>
  );
}

// A menu positions itself a microtask after mount (floating-ui) and a header verb clears
// its busy flag after its handler resolves, so both run inside an async `act` that lets the
// queue drain before asserting.
async function settle(work: () => void) {
  await act(async () => {
    work();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Every card @dnd-kit has actually made draggable, by the title it renders. A card `useDraggable`
 * was told to disable keeps the draggable role description but reports `aria-disabled`, so the
 * selector has to exclude those or a disabled card reads as a live drag handle. */
function draggableTitles(): string[] {
  return screen
    .getAllByRole('button')
    .filter(
      (el) =>
        el.getAttribute('aria-roledescription') === 'draggable' &&
        el.getAttribute('aria-disabled') !== 'true'
    )
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' '));
}

/** The lane headers on screen, by title, in order. */
function laneTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-lane-key]')).map(
    (section) =>
      section.querySelector('[data-slot=group-header-name] button')
        ?.textContent ?? ''
  );
}

/** The lane's title button — an exact name, since the lane's `+` is named after it too. */
function laneToggle(name: string) {
  return screen.getByRole('button', { name });
}

function columnHeaders(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot=board-column-header]')
  );
}

test('every epic with children heads a lane, and the no-epic lane comes last', () => {
  render(<Harness />);
  expect(laneTitles()).toEqual(['Payments epic', 'Search epic', 'No epic']);
  for (const title of laneTitles()) {
    expect(laneToggle(title).getAttribute('aria-expanded')).toBe('true');
  }
});

// Twenty epics with three active ones must not render seventeen blank rows.
test('an epic with no children in the configured statuses is not rendered', () => {
  render(<Harness />);
  expect(screen.queryByText('Nothing here epic')).toBeNull();
});

test('clicking an epic header hides its cards, and clicking again brings them back', () => {
  render(<Harness />);
  expect(screen.queryByText('Card one')).not.toBeNull();

  fireEvent.click(laneToggle('Payments epic'));
  expect(screen.queryByText('Card one')).toBeNull();
  expect(screen.queryByText('Card three')).toBeNull();
  // A sibling lane is untouched — collapse is per epic, not a board-wide mode.
  expect(screen.queryByText('Card four')).not.toBeNull();

  fireEvent.click(laneToggle('Payments epic'));
  expect(screen.queryByText('Card one')).not.toBeNull();
});

// The column count is the one number that never moves: folding a lane hides cards, it does
// not remove work from the status.
test('a column header keeps its plain count when a lane collapses', () => {
  render(<Harness />);
  const todo = columnHeaders()[0];
  expect(todo.textContent).toContain('3');
  fireEvent.click(laneToggle('Payments epic'));
  expect(columnHeaders()[0].textContent).toContain('3');
  expect(screen.queryByText(/hidden/)).toBeNull();
});

test('the no-epic lane collapses like any other', () => {
  render(<Harness />);
  fireEvent.click(laneToggle('No epic'));
  expect(screen.queryByText('Unparented card')).toBeNull();
});

// Epics are containers, not objects on the board: they head a lane and are never dragged.
test('only plain task cards are draggable', () => {
  render(<Harness />);
  const titles = draggableTitles();
  expect(titles).toHaveLength(5);
  for (const epic of EPICS) {
    expect(titles.some((t) => t.includes(epic.meta.title))).toBe(false);
  }
  expect(titles.some((t) => t.includes('Card one'))).toBe(true);
});

test('an archived card is not draggable', () => {
  render(<Harness archivedTaskIds={new Set(['t-1'])} />);
  const titles = draggableTitles();
  expect(titles.some((t) => t.includes('Card one'))).toBe(false);
  expect(titles.some((t) => t.includes('Card two'))).toBe(true);
});

test('the epic header carries the epic dispatch and graph controls as pills', () => {
  render(<Harness />);
  // The id chip is the one open affordance; the shared controls' Open button stays off.
  expect(screen.queryByRole('button', { name: 'Open e-1' })).not.toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Open Payments epic' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'View dependency graph for e-1' })
  ).not.toBeNull();
  const concurrency = screen.getByLabelText(
    'Epic dispatch concurrency for e-1'
  );
  expect(concurrency.tagName).toBe('BUTTON');
  expect(concurrency.textContent).toBe('3×');
  expect(concurrency.className).toContain('rounded-pill');
  // The "No epic" lane has nothing to dispatch, so it gets none of them.
  const work = screen.getAllByRole('button', { name: 'Send agents…' });
  expect(work).toHaveLength(2);
  expect(work[0]?.className).toContain('rounded-pill');
});

test('the epic dispatch button routes through the confirmation preview', () => {
  const requested: string[] = [];
  render(<Harness onRequestWorkEpic={(id) => requested.push(id)} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Send agents…' })[0]);
  expect(requested).toEqual(['e-1']);
});

test('without a preview handler Send agents… starts a session at the picked concurrency', async () => {
  const worked: [string, WorkEpicOptions][] = [];
  render(
    <Harness
      onWorkEpic={(id, opts) => {
        worked.push([id, opts]);
        return Promise.resolve();
      }}
    />
  );
  await settle(() => {
    fireEvent.click(screen.getAllByRole('button', { name: 'Send agents…' })[0]);
  });
  expect(worked).toEqual([['e-1', { concurrency: 3 }]]);
});

test('an active session shows Pause and Stop, and a paused one Resume and Raise ceiling…', async () => {
  const paused: string[] = [];
  const resumed: string[] = [];
  const raised: string[] = [];
  const children = [
    { id: 't-1', title: 'Card one', status: 'working' },
    { id: 't-2', title: 'Card two', status: 'todo' },
    { id: 't-3', title: 'Card three', status: 'done' },
  ];
  const { unmount } = render(
    <Harness
      epicProgressById={
        new Map([
          [
            'e-1',
            progressFor('e-1', children, {
              active: true,
              session: sessionWith('active'),
            }),
          ],
        ])
      }
      onPauseEpic={(id) => {
        paused.push(id);
        return Promise.resolve();
      }}
      onResumeEpic={(id) => {
        resumed.push(id);
        return Promise.resolve();
      }}
      onRaiseCeilingEpic={(id) => raised.push(id)}
    />
  );
  // The concurrency picker belongs to a fresh session; a live one chose it already.
  expect(
    screen.queryByLabelText('Epic dispatch concurrency for e-1')
  ).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Send agents…' })).toHaveLength(
    1
  );
  await settle(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  });
  expect(paused).toEqual(['e-1']);
  expect(screen.getByRole('button', { name: 'Stop' })).not.toBeNull();
  unmount();

  render(
    <Harness
      epicProgressById={
        new Map([
          [
            'e-1',
            progressFor('e-1', children, {
              session: sessionWith('paused', { pausedReason: 'budget' }),
            }),
          ],
        ])
      }
      onResumeEpic={(id) => {
        resumed.push(id);
        return Promise.resolve();
      }}
      onRaiseCeilingEpic={(id) => raised.push(id)}
    />
  );
  expect(screen.getByText('Paused — budget ceiling')).not.toBeNull();
  await settle(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  });
  fireEvent.click(screen.getByRole('button', { name: 'Raise ceiling…' }));
  expect(resumed).toEqual(['e-1']);
  expect(raised).toEqual(['e-1']);
});

test('a header without pause wiring shows only Stop on an active session', () => {
  render(
    <Harness
      epicProgressById={
        new Map([
          [
            'e-1',
            progressFor(
              'e-1',
              [{ id: 't-1', title: 'Card one', status: 'working' }],
              {
                active: true,
                session: sessionWith('active'),
              }
            ),
          ],
        ])
      }
    />
  );
  expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Stop' })).not.toBeNull();
});

// The land affordance follows the server's own readiness rule (every child done or
// cancelled): a finished epic's header swaps the then-useless Work button for Land.
test('a finished epic swaps Work for a Land button that lands it', async () => {
  const landed: string[] = [];
  const progress = new Map([
    [
      'e-1',
      progressFor('e-1', [
        { id: 't-1', title: 'Card one', status: 'landed' },
        { id: 't-2', title: 'Card two', status: 'dropped' },
        { id: 't-3', title: 'Card three', status: 'landed' },
      ]),
    ],
  ]);
  render(
    <Harness
      epicProgressById={progress}
      onLandEpic={(id) => {
        landed.push(id);
        return Promise.resolve();
      }}
    />
  );
  // e-1 is finished, so its lane offers Land; e-2 (no progress yet) keeps Send agents….
  const land = screen.getAllByRole('button', { name: 'Land' });
  expect(land).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Send agents…' })).toHaveLength(
    1
  );
  // The `◔ 3/3` progress glyph sits beside it.
  expect(
    document.querySelector('[data-slot=milestone-progress]')?.textContent
  ).toBe('3/3');
  await settle(() => {
    fireEvent.click(land[0]);
  });
  expect(landed).toEqual(['e-1']);
});

// The regression this guards: a dash length computed from a wider circle than the pie is
// drawn on filled the disk at twice the real fraction (a full disk at 50%).
test('the ◔ progress pie exposes exactly the done fraction of its arc', () => {
  const progress = new Map([
    [
      'e-1',
      progressFor('e-1', [
        { id: 't-1', title: 'Card one', status: 'landed' },
        { id: 't-2', title: 'Card two', status: 'ready' },
      ]),
    ],
  ]);
  render(<Harness epicProgressById={progress} />);
  expect(
    document.querySelector('[data-slot=milestone-progress]')?.textContent
  ).toBe('1/2');
  const pie = document.querySelector(
    '[data-slot=milestone-progress] circle[r="2"]'
  );
  const [dash] = (pie?.getAttribute('stroke-dasharray') ?? '').split(' ');
  const offset = Number(pie?.getAttribute('stroke-dashoffset'));
  // The pie is `StatusIcon`'s: a 12.19 arc, half of it hidden by the offset at 1/2 done.
  expect(Number(dash)).toBeCloseTo(12.19, 2);
  expect(offset).toBeCloseTo(6.09, 2);
});

test('the concurrency pill opens a radio menu with the current choice checked', async () => {
  render(<Harness />);
  await settle(() => {
    fireEvent.click(
      screen.getAllByLabelText('Epic dispatch concurrency for e-1')[0]
    );
  });
  const items = screen.getAllByRole('menuitemradio');
  expect(items.map((item) => item.textContent)).toEqual([
    '1×',
    '2×',
    '3×',
    '4×',
  ]);
  expect(
    items.map((item) => item.getAttribute('aria-checked') === 'true')
  ).toEqual([false, false, true, false]);
  await settle(() => {
    fireEvent.click(items[0]);
  });
  expect(
    screen.getAllByLabelText('Epic dispatch concurrency for e-1')[0].textContent
  ).toBe('1×');
});

test('no Land button renders without land wiring or finished progress', () => {
  render(<Harness />);
  expect(screen.queryByRole('button', { name: 'Land' })).toBeNull();
});

test('columns are 348px with 12px side padding, headers 44px, cards 322px', () => {
  render(<Harness />);
  const headers = columnHeaders();
  expect(headers).toHaveLength(3);
  for (const header of headers) {
    expect(header.className).toContain('w-[348px]');
    expect(header.className).toContain('px-3');
    expect(header.className).toContain('h-11');
  }
  // Glyph, 12px muted name, plain count — nothing mono, no pill around the name.
  const todo = headers[0];
  expect(todo.querySelector('svg[aria-label="Status: todo"]')).not.toBeNull();
  expect(todo.querySelector('.text-\\[12px\\]')?.textContent).toBe('Todo');
  expect(todo.className).not.toContain('font-mono');
  const card = screen.getByText('Card one').closest('[data-slot=task-card]');
  expect(card?.className).toContain('w-[322px]');
  expect(card?.className).toContain('bg-surface-quaternary');
  expect(card?.className).toContain('shadow-card');
  // Column stacks carry no background of their own — cards sit on the panel.
  const column = document.querySelector('[data-slot=board-column]');
  expect(column?.className).not.toMatch(/\bbg-(?!surface-hover)/);
});

test('the column ··· menu offers collapse, hide and dispatch-all', async () => {
  const collapsed: string[] = [];
  const hidden: string[] = [];
  render(
    <Harness
      onToggleColumnCollapsed={(s) => collapsed.push(s)}
      onHideColumn={(s) => hidden.push(s)}
    />
  );
  await settle(() => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Todo column options' })
    );
  });
  const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
  expect(items).toEqual([
    'Collapse column',
    'Hide column',
    'Dispatch all ready',
  ]);
  await settle(() => {
    fireEvent.click(screen.getByRole('menuitem', { name: 'Collapse column' }));
  });
  expect(collapsed).toEqual(['todo']);
  await settle(() => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Done column options' })
    );
  });
  await settle(() => {
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide column' }));
  });
  expect(hidden).toEqual(['done']);
});

test('Dispatch all ready dispatches every ready card in the column', async () => {
  const dispatched: string[] = [];
  render(
    <Harness
      readyIds={new Set(['t-1', 't-4', 't-loose'])}
      onDispatch={(id) => {
        dispatched.push(id);
        return Promise.resolve();
      }}
    />
  );
  await settle(() => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Todo column options' })
    );
  });
  await settle(() => {
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Dispatch all ready (2)' })
    );
  });
  expect(dispatched.sort()).toEqual(['t-1', 't-4']);
});

test('a collapsed column folds to a strip that expands on click', () => {
  const toggled: string[] = [];
  render(
    <Harness
      collapsedColumns={new Set(['in-progress'])}
      onToggleColumnCollapsed={(s) => toggled.push(s)}
    />
  );
  const strip = columnHeaders()[1];
  expect(strip.dataset['collapsed']).toBe('true');
  expect(strip.className).toContain('w-11');
  fireEvent.click(
    screen.getByRole('button', { name: 'Expand In Progress column' })
  );
  expect(toggled).toEqual(['in-progress']);
});

test('a column header "+" opens the creator pre-set to that status', () => {
  const presets: CreateTaskPreset[] = [];
  render(<Harness presets={presets} />);
  fireEvent.click(screen.getByRole('button', { name: 'New task in done' }));
  expect(presets).toEqual([{ status: 'done' }]);
});

test('a lane header "+" presets the epic', () => {
  const presets: CreateTaskPreset[] = [];
  render(<Harness presets={presets} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'New task in Payments epic' })
  );
  expect(presets).toEqual([{ epic: 'e-1' }]);
});

test('the flat board has no lane headers and crumbs each card with its epic', () => {
  render(<Harness groupByEpic={false} />);
  expect(document.querySelector('[data-slot=group-header]')).toBeNull();
  const card = screen.getByText('Card one').closest('[data-slot=task-card]');
  const meta = card?.querySelector('[data-slot=task-card-meta]');
  expect(meta?.textContent).toContain('t-1');
  expect(meta?.querySelector('[data-slot=task-card-crumb]')?.textContent).toBe(
    'Payments epic'
  );
});

import type { TaskDoc } from '@dispatch/core/browser';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'bun:test';
import type { ReactNode } from 'react';

import { testConfig } from '../components/settings/fixtures.test-helper';
import {
  type ShellActions,
  ShellActionsProvider,
} from '../components/shell/ShellActionsContext';
import type { DispatchProjectData } from '../hooks/useDispatchProject';
import { TASK_FILTERS_V2_STORAGE_KEY } from '../lib/taskFilters';
import {
  TASK_FILTERS_STORAGE_KEY,
  TASKS_DISPLAY_STORAGE_KEY,
} from '../lib/tasksPrefs';
import {
  type TasksViewMode,
  VIEW_MODE_STORAGE_KEY,
} from '../lib/tasksViewMode';
import { BoardView } from './BoardView';
import { TooltipProvider } from '@/ui/tooltip';

function task(
  id: string,
  title: string,
  status: string,
  parent: string | null = null,
  kind = 'task',
  priority = 'medium'
): TaskDoc {
  return {
    meta: {
      id,
      title,
      status,
      kind,
      priority,
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

const EPICS = [
  task('e-1', 'Payments epic', 'todo', null, 'epic'),
  task('e-2', 'Search epic', 'todo', null, 'epic'),
];

const TASKS = [
  ...EPICS,
  task('t-1', 'Card one', 'todo', 'e-1'),
  task('t-2', 'Card two', 'done', 'e-1'),
  task('t-3', 'Card three', 'todo', 'e-2'),
  task('t-loose', 'Unparented card', 'todo'),
];

/** A `DispatchProjectData` stub carrying only what BoardView and its layouts read. */
function boardData(tasks: TaskDoc[] = TASKS): DispatchProjectData {
  return {
    config: testConfig,
    client: {},
    portLoading: false,
    portError: false,
    tasksLoading: false,
    tasks,
    tasksIncludingArchived: tasks,
    archivedTasks: [],
    showArchived: false,
    setShowArchived: () => {},
    epics: EPICS,
    epicProgressById: new Map(),
    readyIds: new Set<string>(),
    blockedIds: new Set<string>(),
    runs: [],
    latestRunByTaskId: new Map(),
    liveRunStateByTaskId: new Map(),
    attentionByTaskId: new Map(),
    mergeQueue: null,
    handleMergeAllReady: async () => {},
    moveTaskStatus: async () => {},
    handleUpdate: async () => {},
    handleDispatch: async () => {},
    handleWorkEpic: async () => {},
    handleStopEpic: async () => {},
  } as unknown as DispatchProjectData;
}

const noop = () => {};
const shellActions = {
  openTask: noop,
  peekTask: noop,
  openCreateTask: noop,
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

function Shell({ children }: { children: ReactNode }) {
  return (
    <ShellActionsProvider value={shellActions}>
      <TooltipProvider>{children}</TooltipProvider>
    </ShellActionsProvider>
  );
}

function view(
  mode: TasksViewMode = 'board',
  options: {
    data?: DispatchProjectData;
    onSelectTask?: (taskId: string) => void;
    onNewTask?: () => void;
  } = {}
) {
  return (
    <Shell>
      <BoardView
        data={options.data ?? boardData()}
        mode={mode}
        projectName="Dispatch"
        onSelectTask={options.onSelectTask ?? noop}
        onNewTask={options.onNewTask ?? noop}
        onPlanWork={noop}
      />
    </Shell>
  );
}

function mount(onSelectTask: (taskId: string) => void = noop) {
  return render(view('board', { onSelectTask }));
}

// A popover/menu positions itself a microtask after mount (floating-ui), so anything that
// opens one is fired — and its contents clicked — inside an async `act` that lets it settle.
async function settle(work: () => void) {
  await act(async () => {
    work();
    await Promise.resolve();
  });
}

/** A card's own root element — the keydown target a real keypress has. */
function cardRoot(title: string): HTMLElement {
  const root = screen
    .getByText(title)
    .closest<HTMLElement>('[aria-roledescription="draggable"]');
  if (root === null) throw new Error(`no card rendered for ${title}`);
  return root;
}

function pressNav(key: 'j' | 'k' | 'Enter', on: HTMLElement) {
  fireEvent.keyDown(on, { key });
}

/** The card the roving cursor is on, by the text it renders. */
function focusedCardText(): string {
  const card = screen
    .getAllByRole('button')
    .find((el) => el.getAttribute('data-focused') === 'true');
  return (card?.textContent ?? '').replace(/\s+/g, ' ');
}

/** The one element matching `selector`, or a thrown error naming it. */
function el(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
}

function header(): HTMLElement {
  return el('[data-slot=page-header]');
}

function storedDisplay(): Record<string, unknown> {
  return JSON.parse(
    window.localStorage.getItem(TASKS_DISPLAY_STORAGE_KEY) ?? '{}'
  ) as Record<string, unknown>;
}

beforeEach(() => {
  // Collapse state is session-scoped, and `cleanup()` does not clear storage — without this a
  // lane collapsed by one test would start the next one folded up.
  window.sessionStorage.clear();
  window.localStorage.clear();
});

// The lane-behavior tests below exercise the epic-grouped board; the default is the flat
// kanban, so they seed the display pref the Display popover would write.
function enableEpicLanes() {
  window.localStorage.setItem(
    TASKS_DISPLAY_STORAGE_KEY,
    JSON.stringify({ grouping: 'epic' })
  );
}

test('the header is two rows: Project › Tasks with ghost actions, then view tabs and the triad', () => {
  mount();
  const rows = header().querySelectorAll('[data-slot=page-header-row]');
  expect(rows).toHaveLength(2);
  expect(
    header().querySelector('[data-slot=page-header-crumb]')?.textContent
  ).toBe('Dispatch›Tasks');
  const plan = screen.getByRole('button', { name: 'Plan work…' });
  expect(plan.dataset['variant']).toBe('ghost');
  expect(
    screen.getByRole('button', { name: 'Merge all ready (0)' }).dataset[
      'variant'
    ]
  ).toBe('ghost');
  // New task left the header — it lives on the sidebar pencil and `c`.
  expect(screen.queryByRole('button', { name: 'New task' })).toBeNull();
  const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
  expect(tabs).toEqual(['Board', 'List', 'Milestones']);
  expect(screen.getByRole('tab', { name: 'Board' }).dataset['active']).toBe(
    'true'
  );
  const triad = el('[data-slot=header-icon-triad]');
  expect(within(triad).getByLabelText('Filter')).not.toBeNull();
  expect(within(triad).getByLabelText('Display')).not.toBeNull();
  expect(within(triad).getByLabelText('Group by epic')).not.toBeNull();
});

test('the view tabs switch the layout and remember it; the mode prop is only the opening one', () => {
  render(view('board'));
  expect(screen.queryByText('Card one')).not.toBeNull();
  expect(document.querySelector('[data-slot=list-row]')).toBeNull();

  fireEvent.click(screen.getByRole('tab', { name: 'List' }));
  expect(document.querySelector('[data-slot=list-row]')).not.toBeNull();
  expect(document.querySelector('[data-slot=task-card]')).toBeNull();
  expect(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe('list');
  expect(storedDisplay()['layout']).toBe('list');

  fireEvent.click(screen.getByRole('tab', { name: 'Milestones' }));
  expect(screen.getByRole('grid', { name: 'Milestones' })).not.toBeNull();
  // Milestones always groups by milestone, so the lane toggle has nothing to do there.
  expect(screen.getByLabelText('Group by epic').hasAttribute('disabled')).toBe(
    true
  );
  // The triad is still present.
  expect(screen.getByLabelText('Filter')).not.toBeNull();
  expect(screen.getByLabelText('Display')).not.toBeNull();
});

// The regression this guards: the cursor's order was built from the unsorted task list while
// the columns rendered `sortTasks` order, so j jumped around a column instead of walking it.
test('j walks a column in its displayed (priority) order, not data order', () => {
  const opened: string[] = [];
  const tasks = [
    task('t-low', 'Low card', 'todo', null, 'task', 'low'),
    task('t-urgent', 'Urgent card', 'todo', null, 'task', 'urgent'),
    task('t-high', 'High card', 'todo', null, 'task', 'high'),
  ];
  render(
    view('board', {
      data: boardData(tasks),
      onSelectTask: (taskId) => opened.push(taskId),
    })
  );
  const column = el('[data-slot=board-column]');
  expect(
    Array.from(column.querySelectorAll('[data-slot=task-card]')).map((card) =>
      card.textContent?.replace(/\s+/g, ' ')
    )
  ).toEqual([
    expect.stringContaining('Urgent card'),
    expect.stringContaining('High card'),
    expect.stringContaining('Low card'),
  ]);
  const anchor = cardRoot('Low card');
  pressNav('j', anchor);
  expect(focusedCardText()).toContain('Urgent card');
  pressNav('j', anchor);
  expect(focusedCardText()).toContain('High card');
  pressNav('Enter', cardRoot('High card'));
  expect(new Set(opened)).toEqual(new Set(['t-high']));
});

// The regression this guards: `initial` used to win over storage, so App's never-updated
// `mode` prop put the board back on Board every time the view remounted (a trip to Git and
// back) after the user had chosen List.
test('a remembered layout wins over the opening mode prop', () => {
  window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, 'list');
  render(view('board'));
  expect(document.querySelector('[data-slot=list-row]')).not.toBeNull();
  expect(document.querySelector('[data-slot=task-card]')).toBeNull();
  expect(screen.getByRole('tab', { name: 'List' }).dataset['active']).toBe(
    'true'
  );
});

test('the board opens on the flat kanban with every task in a status column', () => {
  mount();
  expect(screen.queryByText('Card one')).not.toBeNull();
  expect(screen.queryByText('Card three')).not.toBeNull();
  expect(screen.queryByText('Unparented card')).not.toBeNull();
  // Empty columns stay hidden until Display › Show empty groups.
  const columns = Array.from(
    document.querySelectorAll('[data-slot=board-column-header]')
  ).map((el) => el.textContent);
  expect(columns).toEqual(['Todo3', 'Done1']);
});

test('the Display popover writes the display prefs and the board follows', async () => {
  mount();
  await settle(() => {
    fireEvent.click(screen.getByLabelText('Display'));
  });
  const popover = el('[data-slot=display-popover]');
  expect(popover.className).toContain('w-[260px]');
  expect(
    within(popover).getByRole('radiogroup', { name: 'Layout' })
  ).not.toBeNull();
  expect(
    within(popover).getByRole('button', { name: 'Grouping' }).textContent
  ).toContain('Status');
  await settle(() => {
    fireEvent.click(
      within(popover).getByRole('switch', {
        name: 'Show empty groups',
      })
    );
  });
  expect(storedDisplay()['showEmptyGroups']).toBe(true);
  const columns = Array.from(
    document.querySelectorAll('[data-slot=board-column-header]')
  ).map((el) => el.textContent);
  expect(columns).toHaveLength(testConfig.statuses.length);
  // The property chips toggle the card anatomy.
  const chips = el('[data-slot=display-properties]');
  await settle(() => {
    fireEvent.click(within(chips).getByRole('button', { name: 'ID' }));
  });
  expect((storedDisplay()['properties'] as string[]).includes('id')).toBe(
    false
  );
  expect(
    document.querySelector('[data-slot=task-card-meta]')?.textContent
  ).not.toContain('t-1');
});

test('the Filter menu lists facets and applies a Status chip under the header', async () => {
  mount();
  expect(
    screen
      .getByLabelText('Filter')
      .querySelector('[data-slot=filter-active-dot]')
  ).toBeNull();
  await settle(() => {
    fireEvent.click(screen.getByLabelText('Filter'));
  });
  const menu = el('[data-slot=filter-menu]');
  expect(menu.className).toContain('w-[180px]');
  expect(screen.getByPlaceholderText('Add filter…')).not.toBeNull();
  const facets = within(menu)
    .getAllByRole('menuitem')
    .map((el) => el.textContent);
  expect(facets).toEqual([
    'Status',
    'Priority',
    'Assignee',
    'Labels',
    'Epic',
    'Milestone',
    'Run state',
    'Created',
    'Updated',
  ]);
  await settle(() => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Status' }));
  });
  await settle(() => {
    fireEvent.click(
      within(menu).getByRole('menuitemcheckbox', {
        name: /Done/,
      })
    );
  });
  const chip = document.querySelector('[data-slot=filter-chip]');
  expect(chip?.textContent).toBe('StatusisDone');
  expect(
    screen
      .getByLabelText('Filter')
      .querySelector('[data-slot=filter-active-dot]')
  ).not.toBeNull();
  // The board narrows to the matching cards; the column set does not.
  expect(screen.queryByText('Card one')).toBeNull();
  expect(screen.queryByText('Card two')).not.toBeNull();
  expect(
    JSON.parse(window.localStorage.getItem(TASK_FILTERS_V2_STORAGE_KEY) ?? '')
  ).toEqual({
    join: 'and',
    clauses: [{ facet: 'status', op: 'is', values: ['done'] }],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Remove Status filter' }));
  expect(document.querySelector('[data-slot=filter-chip]')).toBeNull();
  expect(screen.queryByText('Card one')).not.toBeNull();
});

test('the Filter menu walks with arrow keys, and Escape in a facet steps back', async () => {
  mount();
  await settle(() => {
    fireEvent.click(screen.getByLabelText('Filter'));
  });
  const menu = el('[data-slot=filter-menu]');
  const facets = within(menu).getAllByRole('menuitem');
  facets[0].focus();
  fireEvent.keyDown(within(menu).getByRole('menu'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(facets[1]);
  fireEvent.keyDown(within(menu).getByRole('menu'), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(facets[0]);
  fireEvent.keyDown(within(menu).getByRole('menu'), { key: 'End' });
  expect(document.activeElement).toBe(facets[facets.length - 1]);

  await settle(() => {
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Created' }));
  });
  const picks = within(menu).getAllByRole('menuitemcheckbox');
  expect(picks.map((p) => p.getAttribute('aria-checked'))).not.toContain(
    'true'
  );
  await settle(() => {
    fireEvent.click(
      within(menu).getByRole('menuitemcheckbox', { name: 'In the last week' })
    );
  });
  // A date pick stores a resolved bound, yet its own row reads as the checked one.
  expect(
    within(menu)
      .getAllByRole('menuitemcheckbox')
      .map((p) => [p.textContent, p.getAttribute('aria-checked')])
  ).toEqual([
    ['In the last day', 'false'],
    ['In the last week', 'true'],
    ['In the last month', 'false'],
    ['More than a week ago', 'false'],
    ['More than a month ago', 'false'],
  ]);
  await settle(() => {
    fireEvent.keyDown(within(menu).getByRole('menu'), { key: 'Escape' });
  });
  expect(document.querySelector('[data-slot=filter-menu]')).not.toBeNull();
  expect(within(menu).getByRole('menuitem', { name: 'Status' })).not.toBeNull();
});

test('a v1 chip filter migrates into an applied clause', () => {
  window.localStorage.setItem(
    TASK_FILTERS_STORAGE_KEY,
    JSON.stringify({ statuses: ['todo'], priorities: [] })
  );
  mount();
  expect(document.querySelector('[data-slot=filter-chip]')?.textContent).toBe(
    'StatusisTodo'
  );
  expect(screen.queryByText('Card two')).toBeNull();
});

test('the filter applies to the list too', () => {
  window.localStorage.setItem(
    TASK_FILTERS_V2_STORAGE_KEY,
    JSON.stringify({
      join: 'and',
      clauses: [{ facet: 'status', op: 'is', values: ['done'] }],
    })
  );
  render(view('list'));
  const rows = Array.from(
    document.querySelectorAll('[data-slot=list-row]')
  ).map((r) => r.textContent);
  expect(rows.some((r) => r?.includes('Card two'))).toBe(true);
  expect(rows.some((r) => r?.includes('Card one'))).toBe(false);
});

test('the side-panel toggle groups the board into epic lanes', () => {
  mount();
  expect(document.querySelector('[data-slot=group-header]')).toBeNull();
  fireEvent.click(screen.getByLabelText('Group by epic'));
  expect(
    Array.from(document.querySelectorAll('[data-slot=group-header-name]')).map(
      (el) => el.textContent
    )
  ).toEqual(['Payments epic', 'Search epic', 'No epic']);
  expect(storedDisplay()['grouping']).toBe('epic');
  expect(screen.getByLabelText('Ungroup epics').dataset['active']).toBe('true');
});

test('j walks the cards lane by lane, and Enter opens the one it stopped on', () => {
  enableEpicLanes();
  const opened: string[] = [];
  mount((taskId) => opened.push(taskId));
  const anchor = cardRoot('Card one');

  pressNav('j', anchor);
  expect(focusedCardText()).toContain('Card one');
  pressNav('j', anchor);
  expect(focusedCardText()).toContain('Card two');
  pressNav('j', anchor);
  expect(focusedCardText()).toContain('Card three');
  pressNav('k', anchor);
  expect(focusedCardText()).toContain('Card two');

  pressNav('Enter', cardRoot('Card two'));
  expect(opened.length).toBeGreaterThan(0);
  expect(new Set(opened)).toEqual(new Set(['t-2']));
});

// The regression this guards: an order built from all the project's tasks would walk the cursor
// into a folded-up lane, moving real DOM focus to a card nobody can see.
test('j/k skip the cards a collapsed epic is hiding', () => {
  enableEpicLanes();
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Payments epic' }));
  const anchor = cardRoot('Card three');

  pressNav('j', anchor);
  expect(focusedCardText()).toContain('Card three');
  pressNav('j', anchor);
  expect(focusedCardText()).toContain('Unparented card');
});

test('a collapsed lane stays collapsed after switching to the list and back', () => {
  enableEpicLanes();
  render(view('board'));
  fireEvent.click(screen.getByRole('button', { name: 'Payments epic' }));
  expect(screen.queryByText('Card one')).toBeNull();

  fireEvent.click(screen.getByRole('tab', { name: 'List' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
  expect(screen.queryByText('Card one')).toBeNull();
  expect(screen.queryByText('Card three')).not.toBeNull();
});

test('`f` on the board opens the filter menu', async () => {
  mount();
  await settle(() => {
    fireEvent.keyDown(cardRoot('Card one'), { key: 'f' });
  });
  expect(document.querySelector('[data-slot=filter-menu]')).not.toBeNull();
});

test('an empty project shows the Linear empty state with New task and Plan work', () => {
  let created = 0;
  render(
    view('board', { data: boardData([]), onNewTask: () => (created += 1) })
  );
  const empty = document.querySelector('[data-slot=empty-state]');
  expect(empty?.textContent).toContain('No tasks yet');
  const newTask = screen.getByRole('button', { name: /New task/ });
  expect(newTask.querySelector('kbd')?.textContent).toBe('C');
  fireEvent.click(newTask);
  expect(created).toBe(1);
  expect(screen.getAllByRole('button', { name: 'Plan work…' })).toHaveLength(2);
});

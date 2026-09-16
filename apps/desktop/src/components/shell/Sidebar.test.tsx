import type { DraftRecord } from '@dispatch/client';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'bun:test';

import type { GlobalView, ProjectView } from '../../lib/appNav';
import {
  PROJECT_NAV_VIEWS,
  PROJECT_VIEW_ORDER,
  Sidebar,
  useSidebarCollapsed,
} from './Sidebar';
import { SidebarProvider } from '@/ui/sidebar';

const props = {
  hasActiveProject: true,
  section: 'project' as const,
  projectView: 'inbox' as ProjectView,
  globalView: 'all-agents' as GlobalView,
  switcher: <span>dispatch</span>,
  trafficLightInset: false,
  onOpenPalette: () => {},
  onNewTask: () => {},
  inboxCount: 2,
  overseerPendingCount: 0,
  liveAgentCount: 3,
  drafts: [] as DraftRecord[],
  onOpenDraft: () => {},
  onDismissDraft: () => {},
  onSetProjectView: (_view: ProjectView): void => {},
  onSetGlobalView: (_view: GlobalView): void => {},
  liveRail: <div>live-rail-body</div>,
  onQuickCapture: () => {},
};

// The rail reads its hidden state from `SidebarProvider`, so every case mounts through one.
function mount(open: boolean, overrides: Partial<typeof props> = {}) {
  return render(
    <SidebarProvider open={open} onOpenChange={() => {}}>
      <Sidebar {...props} {...overrides} />
    </SidebarProvider>
  );
}

// Section state persists; every test starts from a fresh rail.
beforeEach(() => {
  window.localStorage.removeItem('dispatch:sidebar-sections');
  window.localStorage.removeItem('dispatch:sidebar-collapsed');
});

function navRows(): string[] {
  return screen
    .getAllByRole('button')
    .filter((b) => b.hasAttribute('data-nav-item'))
    .map((b) => b.getAttribute('data-nav-item') ?? '');
}

test('the exported view order is the ⌘N order App.tsx indexes into', () => {
  expect(PROJECT_VIEW_ORDER).toEqual([
    'inbox',
    'overview',
    'brain-dump',
    'plans',
    'board',
    'impact',
    'branches',
    'landing',
  ]);
  expect(PROJECT_NAV_VIEWS.map((v) => v.label)).toEqual([
    'Inbox',
    'Control room',
    'Brain dump',
    'Plans',
    'Tasks',
    'Impact',
    'Git',
    'Landing',
  ]);
});

test('sections come in Linear order: fixed top group, then Workspace, Fleet, Live agents, Try', () => {
  mount(true);
  expect(navRows()).toEqual([
    'inbox',
    'drafts',
    'overseer',
    'overview',
    'brain-dump',
    'plans',
    'board',
    'impact',
    'branches',
    'landing',
    'all-agents',
    'sessions',
    'try-plan',
    'try-capture',
    'try-linear',
  ]);
  // The headings are sentence-case buttons with a chevron — collapsible.
  for (const heading of ['Workspace', 'Fleet', 'Live agents', 'Try']) {
    const button = screen.getByRole('button', { name: heading });
    expect(button.getAttribute('aria-expanded')).toBe('true');
  }
  // The live-agents body is App's `LiveRail`, given a home under its heading.
  expect(screen.getByText('live-rail-body')).toBeTruthy();
  // No Settings row: it lives in the switcher menu and on G S.
  expect(screen.queryByRole('button', { name: /^Settings/ })).toBeNull();
});

test('the top strip holds the switcher plus search and new-task icon buttons', () => {
  mount(true);
  expect(screen.getByText('dispatch')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
  const newTask = screen.getByRole('button', { name: 'New task' });
  expect(newTask.getAttribute('data-filled')).toBe('true');
  // The strip is the window's drag region and clears the traffic lights when asked.
  const strip = document.querySelector('[data-tauri-drag-region]');
  expect(strip).toBeTruthy();
  expect(strip?.className).not.toContain('pl-[76px]');
});

test('the traffic-light inset steps the top strip right', () => {
  mount(true, { trafficLightInset: true });
  const strip = document.querySelector('[data-tauri-drag-region]');
  expect(strip?.className).toContain('pl-[76px]');
});

test('counts are plain text with no keycap hints, no ⌘K footer, no sync text', () => {
  mount(true, { overseerPendingCount: 5 });
  const inbox = screen.getByRole('button', { name: /^Inbox/ });
  expect(inbox.getAttribute('aria-current')).toBe('page');
  expect(within(inbox).getByText('2').tagName).toBe('SPAN');
  expect(within(inbox).getByText('2').className).not.toContain('font-mono');
  expect(
    within(screen.getByRole('button', { name: /^Overseer/ })).getByText('5')
  ).toBeTruthy();
  expect(
    within(screen.getByRole('button', { name: /^All agents/ })).getByText('3')
  ).toBeTruthy();
  expect(screen.queryByText(/⌘/)).toBeNull();
  expect(document.querySelector('kbd')).toBeNull();
  expect(screen.queryByText(/jump anywhere/)).toBeNull();
  expect(screen.queryByText(/today/)).toBeNull();
  expect(screen.queryByText(/Synced|sync/)).toBeNull();
  expect(screen.queryByRole('button', { name: /sidebar/i })).toBeNull();
});

test('rows are 28px and the active one sits on the selected surface', () => {
  mount(true);
  const inbox = screen.getByRole('button', { name: /^Inbox/ });
  expect(inbox.className).toContain('h-7');
  expect(inbox.className).toContain('bg-surface-selected');
  const tasks = screen.getByRole('button', { name: 'Tasks' });
  expect(tasks.className).not.toContain('bg-surface-selected');
});

test('Tasks has no nested Board/List/Milestones rows', () => {
  mount(true, { projectView: 'board' });
  expect(screen.queryByRole('button', { name: 'Board' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'List' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Milestones' })).toBeNull();
});

test('a section heading collapses its rows and the choice persists', () => {
  const first = mount(true);
  fireEvent.click(screen.getByRole('button', { name: 'Fleet' }));
  expect(screen.queryByRole('button', { name: /^All agents/ })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Fleet' }).getAttribute('aria-expanded')
  ).toBe('false');
  expect(
    JSON.parse(window.localStorage.getItem('dispatch:sidebar-sections') ?? '{}')
  ).toEqual({ fleet: true });
  first.unmount();

  mount(true);
  expect(screen.queryByRole('button', { name: /^All agents/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Fleet' }));
  expect(screen.getByRole('button', { name: /^All agents/ })).toBeTruthy();
});

test('using a Try row does its job and folds the block for next time', () => {
  const views: string[] = [];
  let captures = 0;
  mount(true, {
    onSetProjectView: (v) => {
      views.push(v);
    },
    onQuickCapture: () => {
      captures++;
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Plan work…' }));
  expect(views).toEqual(['plans']);
  expect(screen.queryByRole('button', { name: 'Drop a thought' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Try' }).getAttribute('aria-expanded')
  ).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Try' }));
  fireEvent.click(screen.getByRole('button', { name: 'Drop a thought' }));
  expect(captures).toBe(1);
});

test('project rows and Connect Linear route to the right view', () => {
  const project: string[] = [];
  const global: string[] = [];
  mount(true, {
    onSetProjectView: (v) => {
      project.push(v);
    },
    onSetGlobalView: (v) => {
      global.push(v);
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Git' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Connect Linear' }));
  expect(project).toEqual(['branches']);
  expect(global).toEqual(['sessions', 'settings']);
});

test('the Drafts row counts live drafts and opens the tray', () => {
  const drafts = [
    {
      id: 'd-1',
      state: 'ready',
      prompt: 'add caching',
      questions: [],
      proposal: { tasks: [{ title: 'Cache the index' }] },
      error: null,
      createdAt: '2026-08-04T00:00:00.000Z',
    },
  ] as unknown as DraftRecord[];
  mount(true, { drafts });
  const row = screen.getByRole('button', { name: /^Drafts/ });
  expect(within(row).getByText('1')).toBeTruthy();
  expect(screen.queryByText('Cache the index')).toBeNull();
  fireEvent.click(row);
  expect(screen.getByText('Cache the index')).toBeTruthy();
});

test('the hidden rail collapses to zero width and takes nothing with it', () => {
  mount(false);
  const rail = document.getElementById('dispatch-sidebar');
  expect(rail?.getAttribute('data-state')).toBe('collapsed');
  expect(rail?.className).toContain('w-0');
  expect(rail?.hasAttribute('inert')).toBe(true);
  // No icon strip: the rows are still in the tree (for the width transition) but inert.
  expect(
    screen.getByRole('button', { name: /^Inbox/, hidden: true })
  ).toBeTruthy();
});

// The key and its '1'/'0' encoding are a stored-state contract with every install that already
// has a preference written — a rename or a re-encoding silently expands everyone's rail once.
test('the hidden preference round-trips through its long-standing key', () => {
  function Probe() {
    const [collapsed, setCollapsed] = useSidebarCollapsed();
    return (
      <button type="button" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? 'collapsed' : 'expanded'}
      </button>
    );
  }

  const first = render(<Probe />);
  expect(window.localStorage.getItem('dispatch:sidebar-collapsed')).toBe('0');
  fireEvent.click(screen.getByRole('button'));
  expect(window.localStorage.getItem('dispatch:sidebar-collapsed')).toBe('1');
  first.unmount();

  render(<Probe />);
  expect(screen.getByRole('button').textContent).toBe('collapsed');
});

test('project rows are disabled until a project resolves; fleet rows are not', () => {
  mount(true, { hasActiveProject: false });
  expect(
    (screen.getByRole('button', { name: /^Control room/ }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'New task' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Sessions' }) as HTMLButtonElement)
      .disabled
  ).toBe(false);
});

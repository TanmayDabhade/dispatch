import type { ApiClient } from '@dispatch/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, mock, test } from 'bun:test';
import type { ReactNode } from 'react';

import {
  dataWith,
  testProject,
} from '../components/settings/fixtures.test-helper';

// The Diffs tab's preview renders through `PierreWorkerPool`, which imports
// `@pierre/diffs/worker/worker.js?worker&url` — a Vite-only specifier `bun test`
// cannot resolve. Stubbed to a passthrough, the way DiffSurface.test.tsx does,
// and the view imported afterwards so the stub is what it sees.
void mock.module('@/components/runs/PierreWorkerPool', () => ({
  PierreWorkerPool: ({ children }: { children: ReactNode }) => children,
}));
const { SettingsView } = await import('./SettingsView');

const project = testProject;
const data = dataWith();

// The settings nav: a 28px row per page inside the `Settings` navigation landmark.
function navRows() {
  return within(
    screen.getByRole('navigation', { name: 'Settings' })
  ).getAllByRole('button');
}

function selectPage(name: string) {
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Settings' })).getByRole(
      'button',
      { name }
    )
  );
}

test('with no project selected it explains what to do', () => {
  render(<SettingsView activeProject={null} data={data} />);
  expect(screen.getByText(/Pick a project/)).toBeDefined();
});

test('it opens on General and switches to Integrations', () => {
  render(<SettingsView activeProject={project} data={data} />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('General');
  expect(
    within(screen.getByRole('navigation', { name: 'Settings' }))
      .getByRole('button', { name: 'General' })
      .getAttribute('aria-current')
  ).toBe('page');
  selectPage('Integrations');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
    'Integrations'
  );
  expect(screen.getByRole('heading', { name: 'Linear' })).toBeDefined();
});

// Pages that read through react-query (the Daemon page's board sync line)
// need the provider the app mounts at its root in main.tsx.
// One client per call, so a rerender keeps the same cache.
function withQueryClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// `initialPage` is how the rail's Connect Linear and the strip's gear land on Integrations.
test('initialPage opens on that page, and a new value while mounted switches to it', () => {
  const { rerender } = render(
    <SettingsView
      activeProject={project}
      data={data}
      initialPage="integrations"
    />,
    { wrapper: withQueryClient() }
  );
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
    'Integrations'
  );
  expect(
    within(screen.getByRole('navigation', { name: 'Settings' }))
      .getByRole('button', { name: 'Integrations' })
      .getAttribute('aria-current')
  ).toBe('page');
  rerender(
    <SettingsView activeProject={project} data={data} initialPage="daemon" />
  );
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Daemon');
  expect(
    within(screen.getByRole('navigation', { name: 'Settings' }))
      .getByRole('button', { name: 'Daemon' })
      .getAttribute('aria-current')
  ).toBe('page');
});

// The settings shell: a `Settings` page header, one sentence-case `Project` group
// heading over the nav rows, and the page title as the column's H1.
test('the nav lists every page under a Project heading, and the page title is the H1', () => {
  const ledgerData = dataWith({
    client: { fetchLedger: () => Promise.resolve([]) } as unknown as ApiClient,
  });
  render(<SettingsView activeProject={project} data={ledgerData} />);
  expect(screen.getByText('Project')).toBeDefined();
  expect(navRows().map((row) => row.textContent)).toEqual([
    'General',
    'Team',
    'License',
    'Autonomy',
    'Agents',
    'Previews',
    'Remotes',
    'Integrations',
    'Notifications',
    'Daemon',
    'Diffs',
  ]);
  selectPage('Autonomy');
  expect(screen.getByRole('slider', { name: 'Autonomy' })).toBeDefined();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
    'Autonomy'
  );
  selectPage('Notifications');
  expect(screen.getByLabelText('Webhook URL')).toBeDefined();
});

// Each page is a stack of 15px section headings over grouped cards.
test('a page renders its sections as level-2 headings', () => {
  render(<SettingsView activeProject={project} data={data} />);
  expect(
    screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
  ).toEqual([
    'Before anything lands',
    'How to run this project',
    'Statuses',
    'Verify steps',
    'Pull requests',
  ]);
});

// The nav search narrows the rows to the pages whose name matches.
test('the nav search filters the page rows', () => {
  render(<SettingsView activeProject={project} data={data} />);
  fireEvent.change(screen.getByLabelText('Search settings'), {
    target: { value: 'dae' },
  });
  expect(navRows().map((row) => row.textContent)).toEqual(['Daemon']);
});

// AgentsSection no longer tracks its own saving/saved state, so this now only
// passes because the shell's own indicator span rendered the text.
test('a save reports through the shared indicator', async () => {
  render(<SettingsView activeProject={project} data={data} />);
  selectPage('Agents');
  fireEvent.click(
    screen.getByLabelText('Let it edit files, ask before anything else')
  );
  expect(await screen.findByText(/Saved/)).toBeDefined();
});

// Diffs is a browser preference with no config write behind it, so the
// indicator has nothing to say there.
test('the Diffs page shows no save state', async () => {
  render(<SettingsView activeProject={project} data={data} />);
  const input = screen.getByLabelText('Verify command');
  fireEvent.change(input, { target: { value: 'bun run verify' } });
  fireEvent.blur(input);
  expect(await screen.findByText(/Saved/)).toBeDefined();
  selectPage('Diffs');
  expect(screen.queryByText(/Saved/)).toBeNull();
});

// GeneralSection has no local indicator either, for the same reason.
test('a General save reports through the shared indicator', async () => {
  render(<SettingsView activeProject={project} data={data} />);
  const input = screen.getByLabelText('Verify command');
  fireEvent.change(input, { target: { value: 'bun run verify' } });
  fireEvent.blur(input);
  expect(await screen.findByText(/Saved/)).toBeDefined();
});

// LinearPanel never had a local "Saved" text of its own, so this only passes
// if the shell's shared wrapper is actually wired in.
test('an Integrations config save reports through the shared indicator too', async () => {
  const connectedData = dataWith({ connected: true });
  render(<SettingsView activeProject={project} data={connectedData} />);
  selectPage('Integrations');
  const interval = screen.getByLabelText('Poll interval');
  fireEvent.change(interval, { target: { value: '120' } });
  fireEvent.blur(interval);
  expect(await screen.findByText(/Saved/)).toBeDefined();
});

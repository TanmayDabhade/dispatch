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

test('it opens on General and switches to Linear', () => {
  render(<SettingsView activeProject={project} data={data} />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('General');
  expect(
    within(screen.getByRole('navigation', { name: 'Settings' }))
      .getByRole('button', { name: 'General' })
      .getAttribute('aria-current')
  ).toBe('page');
  selectPage('Linear');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Linear');
  expect(screen.getByRole('heading', { name: 'Connection' })).toBeDefined();
});

// Pages that read through react-query (Board sync's status line) need the
// provider the app mounts at its root in main.tsx.
// One client per call, so a rerender keeps the same cache.
function withQueryClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// `initialPage` is how the rail's Connect Linear and the strip's gear land on
// the Linear page, whose id stays `integrations`.
test('initialPage opens on that page, and a new value while mounted switches to it', () => {
  const { rerender } = render(
    <SettingsView
      activeProject={project}
      data={data}
      initialPage="integrations"
    />,
    { wrapper: withQueryClient() }
  );
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Linear');
  expect(
    within(screen.getByRole('navigation', { name: 'Settings' }))
      .getByRole('button', { name: 'Linear' })
      .getAttribute('aria-current')
  ).toBe('page');
  rerender(
    <SettingsView activeProject={project} data={data} initialPage="daemon" />
  );
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
    'Background'
  );
});

// The rail groups pages by what you are doing, under three headings, and the
// selected page's title is the column's H1 with a one-line intro under it.
test('the rail groups every page, and the page title is the H1', () => {
  const ledgerData = dataWith({
    client: { fetchLedger: () => Promise.resolve([]) } as unknown as ApiClient,
  });
  render(<SettingsView activeProject={project} data={ledgerData} />);
  for (const heading of ['Project', 'Team', 'This machine']) {
    expect(screen.getByText(heading)).toBeDefined();
  }
  expect(navRows().map((row) => row.textContent)).toEqual([
    'General',
    'Agents',
    'Checks',
    'Autonomy',
    'Previews',
    'Notifications',
    'Members',
    'Board sync',
    'Linear',
    'License',
    'Remotes',
    'Background',
    'Diff display',
  ]);
  expect(screen.getByText(/The board's columns/)).toBeDefined();
  selectPage('Autonomy');
  expect(screen.getByRole('slider', { name: 'Autonomy' })).toBeDefined();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
    'Autonomy'
  );
  selectPage('Notifications');
  expect(screen.getByLabelText('Webhook URL')).toBeDefined();
});

// Each page is a stack of section headings over grouped cards.
test('a page renders its sections as level-2 headings', () => {
  render(<SettingsView activeProject={project} data={data} />);
  expect(
    screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
  ).toEqual(['Board columns', 'Pull requests']);
});

// Search renders every page, so the client needs what the Autonomy page reads.
const searchData = dataWith({
  client: { fetchLedger: () => Promise.resolve([]) } as unknown as ApiClient,
});

function search(value: string) {
  fireEvent.change(screen.getByLabelText('Search settings'), {
    target: { value },
  });
}

// Search swaps the page for the matching settings from every page, grouped
// under the page they live on, and each is still the real, editable control.
test('search shows matching settings from every page, editable in place', async () => {
  const ledgerData = dataWith({
    client: { fetchLedger: () => Promise.resolve([]) } as unknown as ApiClient,
  });
  render(<SettingsView activeProject={project} data={ledgerData} />, {
    wrapper: withQueryClient(),
  });
  search('budget');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
    'Results for “budget”'
  );
  // The spend limit matches on a keyword, the hard stop on its own words.
  expect(screen.getByLabelText('Spend per run')).toBeDefined();
  expect(screen.getByText('Spending past the per-run limit')).toBeDefined();
  // Rows that don't match are gone, even in a group that has a match.
  expect(screen.queryByText('Runs at once')).toBeNull();
  // Editing a result saves like it does on its page.
  const spend = screen.getByLabelText('Spend per run');
  fireEvent.change(spend, { target: { value: '7' } });
  fireEvent.blur(spend);
  expect(await screen.findByText('Saved')).toBeDefined();
});

// A page or group that matches by name shows everything in it.
test('a search that names a group shows the whole group', () => {
  render(<SettingsView activeProject={project} data={searchData} />, {
    wrapper: withQueryClient(),
  });
  search('limits');
  for (const label of [
    'Runs at once',
    'Runs at once per epic',
    'Turns per run',
    'Spend per run',
    'Expected cost per run',
  ]) {
    expect(screen.getByLabelText(label)).toBeDefined();
  }
});

test('a search with no match says so, and clearing it returns to the page', () => {
  render(<SettingsView activeProject={project} data={searchData} />, {
    wrapper: withQueryClient(),
  });
  search('zebra');
  expect(screen.getByText('No settings match')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('General');
});

test('picking a page from the rail ends the search', () => {
  render(<SettingsView activeProject={project} data={searchData} />, {
    wrapper: withQueryClient(),
  });
  search('webhook');
  selectPage('Agents');
  expect(screen.getByLabelText<HTMLInputElement>('Search settings').value).toBe(
    ''
  );
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Agents');
});

// AgentsSection has no saving/saved state of its own, so this passes only
// because the shell's shared indicator rendered the text.
test('a save reports through the shared indicator', async () => {
  render(<SettingsView activeProject={project} data={data} />);
  selectPage('Agents');
  fireEvent.click(screen.getByLabelText('Ask me every time'));
  expect(await screen.findByText('Saved')).toBeDefined();
});

// Diff display is a browser preference with no config write behind it, so
// the indicator has nothing to say there.
test('the Diff display page shows no save state', async () => {
  render(<SettingsView activeProject={project} data={data} />);
  selectPage('Agents');
  fireEvent.click(screen.getByLabelText('Ask me every time'));
  expect(await screen.findByText('Saved')).toBeDefined();
  selectPage('Diff display');
  expect(screen.queryByText('Saved')).toBeNull();
});

// Owner-only settings show read-only behind a lock below that tier, and are
// editable at it.
test('owner-only settings lock below the operator tier', () => {
  const { unmount } = render(
    <SettingsView activeProject={project} data={data} />
  );
  selectPage('Checks');
  expect(
    screen.getByLabelText<HTMLInputElement>('Single check command').disabled
  ).toBe(true);
  unmount();
  render(
    <SettingsView
      activeProject={project}
      data={dataWith({ myTier: 'operator' })}
    />
  );
  selectPage('Checks');
  expect(
    screen.getByLabelText<HTMLInputElement>('Single check command').disabled
  ).toBe(false);
});

// LinearPanel never had a local "Saved" text of its own, so this only passes
// if the shell's shared save is actually wired in.
test('a Linear config save reports through the shared indicator too', async () => {
  const connectedData = dataWith({ connected: true });
  render(<SettingsView activeProject={project} data={connectedData} />);
  selectPage('Linear');
  const interval = screen.getByLabelText('Check for changes every');
  fireEvent.change(interval, { target: { value: '120' } });
  fireEvent.blur(interval);
  expect(await screen.findByText('Saved')).toBeDefined();
});

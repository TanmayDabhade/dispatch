import type { ApiClient } from '@dispatch/client';
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
    'Autonomy',
    'Agents',
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
  ).toEqual(['Before anything lands', 'How to run this project']);
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

import type { BoardSyncStatus } from '@dispatch/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, mock, test } from 'bun:test';

import { BoardSyncGroup, syncedWhen } from './BoardSyncGroup';
import { dataWith } from './fixtures.test-helper';

function mount(status: BoardSyncStatus) {
  const client = {
    baseUrl: 'http://127.0.0.1:1',
    fetchBoardSyncStatus: mock(() => Promise.resolve(status)),
    syncBoardNow: mock(() => Promise.resolve(status)),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <BoardSyncGroup data={dataWith({ client: client as never })} />
    </QueryClientProvider>
  );
  return client;
}

const on: BoardSyncStatus = {
  enabled: true,
  replica: 'ada-1a2b3c4d',
  remote: 'git@example.com:team/repo.git',
  branch: 'dispatch-sync',
  lastSyncAt: '2026-09-23T10:00:00.000Z',
  lastError: null,
  pending: 0,
  applied: 3,
  problems: [],
  people: 2,
  seats: 3,
  paused: null,
};

test('off, it says how to turn it on', async () => {
  mount({ enabled: false });
  expect(await screen.findByText('Not sharing')).toBeTruthy();
  expect(screen.getByText(/Turn on sharing below/)).toBeTruthy();
});

test('on, it names the branch and remote and offers to sync now', async () => {
  mount(on);
  expect(
    await screen.findByText('dispatch-sync on git@example.com:team/repo.git')
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: /Sync now/ })).toBeTruthy();
});

test('an unreachable remote and waiting changes are said plainly', async () => {
  mount({ ...on, lastError: 'Could not resolve host', pending: 2 });
  expect(await screen.findByText(/Could not resolve host/)).toBeTruthy();
  expect(screen.getByText(/2 changes waiting/)).toBeTruthy();
});

test('a clash is shown as something that needs a person', async () => {
  mount({
    ...on,
    problems: [
      {
        task: 't-abc12345',
        message: 'created separately on two machines',
        at: 'x',
      },
    ],
  });
  expect(
    await screen.findByText('Needs your attention: t-abc12345')
  ).toBeTruthy();
});

test('syncedWhen reads the states a person sees', () => {
  expect(syncedWhen({ enabled: false })).toBe('Off');
  expect(syncedWhen({ ...on, lastSyncAt: null })).toBe('Not synced yet');
  expect(syncedWhen(on)).toMatch(/^Synced /);
});

test('past the seats it says it is paused, not that the remote is down', async () => {
  mount({
    ...on,
    paused:
      'Board sync is paused on this machine: more people share this board than the license covers (the free plan covers 3).',
  });
  expect(
    await screen.findByText(/Board sync is paused on this machine/)
  ).toBeTruthy();
  expect(screen.queryByText(/reach the remote/)).toBeNull();
});

import type { LandingRow, LandingSnapshot, RepoPr } from '@dispatch/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test } from 'bun:test';

import { ToastProvider } from '../components/shell/Toasts';
import type { DispatchProjectData } from '../hooks/useDispatchProject';
import { LandingTableView } from './LandingTableView';

const pr = (number: number, over: Partial<RepoPr> = {}): RepoPr => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  headRefName: `feat/${number}`,
  baseRefName: 'main',
  author: 'Ada Lovelace',
  isDraft: false,
  updatedAt: '2026-09-15T00:00:00.000Z',
  headRefOid: 'abc',
  state: 'OPEN',
  isCrossRepository: false,
  headRepositoryOwner: 'o',
  reviewDecision: null,
  mergeable: 'MERGEABLE',
  checks: { passed: 0, failed: 0, pending: 0, total: 0, runs: [] },
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  ...over,
});

const rows: LandingRow[] = [
  {
    id: 'pr-1',
    kind: 'pr',
    title: 'Ready one',
    pr: pr(1),
    gate: { status: 'ready', detail: 'Ready to land' },
  },
  {
    id: 'pr-2',
    kind: 'pr',
    title: 'Conflicted one',
    pr: pr(2),
    gate: { status: 'conflicts', detail: 'Has conflicts' },
  },
];

const snapshot: LandingSnapshot = {
  rows,
  landed: [],
  generatedAt: '2026-09-15T00:00:00.000Z',
};

function dataWith(
  overrides: Partial<DispatchProjectData> = {}
): DispatchProjectData {
  return {
    portLoading: false,
    portError: false,
    portErrorDetail: null,
    client: {},
    retryEnsureDispatchd: () => {},
    runs: [],
    tasks: [],
    tasksIncludingArchived: [],
    mergeQueue: null,
    landing: snapshot,
    landingIsError: false,
    landingRefetch: () => {},
    lastPushError: null,
    handleMergeAllReady: async () => {},
    handleEnqueueMerge: async () => {},
    handleRecheckMergeQueue: async () => {},
    ...overrides,
  } as unknown as DispatchProjectData;
}

function renderLanding(data = dataWith()) {
  window.localStorage.clear();
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <LandingTableView
          data={data}
          projectName="dispatch"
          onOpenRun={() => undefined}
          onOpenPr={() => undefined}
        />
      </ToastProvider>
    </QueryClientProvider>
  );
}

test('the header reads Project › Merge queue with Queue / Landed view tabs', () => {
  const { container } = renderLanding();
  const crumb = container.querySelector('[data-slot="page-header-crumb"]');
  expect(crumb?.textContent).toBe('dispatch›Merge queue');

  const tabs = screen.getByRole('tablist');
  const names = within(tabs)
    .getAllByRole('tab')
    .map((tab) => tab.textContent);
  expect(names).toEqual(['Queue', 'Landed']);
});

test('rows group under a GroupHeader per gate inside a named list', () => {
  const { container } = renderLanding();
  const list = screen.getByRole('list', { name: 'Pull requests' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);

  const groups = Array.from(
    list.querySelectorAll('[data-slot="group-header"]'),
    (g) => g.textContent
  );
  expect(groups).toEqual(['Needs you1', 'Open1']);
  expect(container.querySelectorAll('[data-slot="list-row"]')).toHaveLength(2);
});

test('the Landed tab swaps the list for what already landed', () => {
  renderLanding();
  fireEvent.click(screen.getByRole('tab', { name: 'Landed' }));
  expect(screen.getByText('Nothing has landed yet.')).toBeDefined();
  expect(screen.queryByRole('list', { name: 'Pull requests' })).toBeNull();
});

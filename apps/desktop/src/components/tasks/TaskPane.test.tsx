import type { ApiClient } from '@dispatch/client';
import type { TaskDoc, TaskListItem } from '@dispatch/core/browser';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'bun:test';

import type { TaskDetailPanelProps } from './detail';
import { TaskPane, type TaskPaneHost, TaskPaneHostContext } from './TaskPane';

const LISTED: TaskListItem = {
  meta: { id: 't-1', title: 'Listed title', status: 'ready' },
} as TaskListItem;

function mount(host: TaskPaneHost | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskPaneHostContext.Provider value={host}>
        <TaskPane taskId="t-1" onClose={() => {}} onExpand={() => {}} />
      </TaskPaneHostContext.Provider>
    </QueryClientProvider>
  );
}

// The seam P5 swaps: callers name a task; the pane fetches its body and draws it with
// the host's page props, from the cached list's metadata.
test('draws the listed task with its fetched body through the host', async () => {
  const drawn: TaskDoc[] = [];
  const host: TaskPaneHost = {
    projectName: 'demo',
    client: {
      fetchTask: () =>
        Promise.resolve({
          meta: { ...LISTED.meta, title: 'stale' },
          body: 'the body',
        }),
    } as unknown as ApiClient,
    port: 1,
    tasks: [LISTED],
    panelProps: (doc) => {
      drawn.push(doc);
      // Enough for the page to fail into its boundary; the seam is what is under test.
      return {} as TaskDetailPanelProps;
    },
  };
  mount(host);
  await waitFor(() => expect(drawn.length).toBeGreaterThan(0));
  // List metadata (what optimistic edits patch) with the fetched body.
  expect(drawn[0]).toEqual({ meta: LISTED.meta, body: 'the body' });
});

test('a task that left the list reads as gone', () => {
  mount({
    projectName: null,
    client: { fetchTask: () => new Promise(() => {}) } as unknown as ApiClient,
    port: 1,
    tasks: [],
    panelProps: () => ({}) as TaskDetailPanelProps,
  });
  expect(screen.getByText('That task is no longer available.')).not.toBeNull();
});

test('without a host it draws nothing', () => {
  const { container } = mount(null);
  expect(container.textContent).toBe('');
});

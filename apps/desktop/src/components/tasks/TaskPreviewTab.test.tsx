import type { RunMeta, RunPreview, RunPreviewResult } from '@dispatch/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { expect, mock, test } from 'bun:test';
import type { ReactNode } from 'react';

import type { DispatchProjectData } from '../../hooks/useDispatchProject';
import { TaskPreviewTab } from './TaskPreviewTab';

const run = { id: 'r-1', taskId: 't-1' } as RunMeta;

const preview = (over: Partial<RunPreview> = {}): RunPreview => ({
  runId: 'r-1',
  status: 'ready',
  port: 4411,
  url: '/preview/r-1/',
  command: 'pnpm run dev -- --port 4411 --strictPort',
  startedAt: '2026-09-22T12:00:00.000Z',
  lastRequestedAt: '2026-09-22T12:00:00.000Z',
  ...over,
});

function data(result: RunPreviewResult): DispatchProjectData {
  return {
    port: 4771,
    daemonBaseUrl: 'http://127.0.0.1:4771',
    client: {
      fetchRunPreview: mock(() => Promise.resolve(result)),
      startRunPreview: mock(() => Promise.resolve(result)),
      stopRunPreview: mock(() => Promise.resolve()),
    },
  } as unknown as DispatchProjectData;
}

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
}

test('a ready preview is framed without allow-same-origin', async () => {
  // The whole security posture of previews rests on this attribute: the frame
  // is served from the daemon's origin, and the daemon injects its agent
  // token into the HTML at `/`. With allow-same-origin the preview's own
  // script could fetch `/`, scrape that token and drive the API.
  wrap(
    <TaskPreviewTab data={data({ preview: preview() })} selectedRun={run} />
  );

  const frame = await screen.findByTitle('Run preview');
  const sandbox = frame.getAttribute('sandbox') ?? '';
  expect(sandbox).not.toContain('allow-same-origin');
  expect(sandbox).toContain('allow-scripts');
});

test('the frame points at the daemon, never the dev server port', async () => {
  wrap(
    <TaskPreviewTab data={data({ preview: preview() })} selectedRun={run} />
  );

  const frame = await screen.findByTitle('Run preview');
  expect(frame.getAttribute('src')).toBe('http://127.0.0.1:4771/preview/r-1/');
  // 4411 is the dev server's own port and must not be addressed directly.
  expect(frame.getAttribute('src')).not.toContain('4411');
});

test('a repo with no dev script reads as an empty state, not a failure', async () => {
  wrap(
    <TaskPreviewTab
      data={data({ preview: null, reason: 'no-command' })}
      selectedRun={run}
    />
  );

  await screen.findByText('Nothing to preview');
  // Pressing start again cannot help — the config has to change first.
  expect(screen.queryByText('Start preview')).toBeNull();
});

test('offers to start when there is no preview and no refusal', async () => {
  wrap(<TaskPreviewTab data={data({ preview: null })} selectedRun={run} />);

  // Nothing is started by opening the tab: a dev server costs an install and
  // a boot, and a reviewer who wanted the diff should not pay for one.
  await screen.findByText('Start preview');
});

test('a failed preview shows why and offers a retry', async () => {
  wrap(
    <TaskPreviewTab
      data={data({
        preview: preview({
          status: 'failed',
          error: 'preview did not answer on port 4411 within 180s',
        }),
      })}
      selectedRun={run}
    />
  );

  await screen.findByText('Preview failed to start');
  await screen.findByText('preview did not answer on port 4411 within 180s');
  await screen.findByText('Try again');
});

test('a run that never started has nothing to preview', async () => {
  wrap(
    <TaskPreviewTab data={data({ preview: null })} selectedRun={undefined} />
  );

  await waitFor(() => screen.getByText('No session yet'));
});

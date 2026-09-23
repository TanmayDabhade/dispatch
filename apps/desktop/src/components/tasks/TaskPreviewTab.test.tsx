import type { RunMeta, RunPreview, RunPreviewResult } from '@dispatch/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, mock, test } from 'bun:test';
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

describe('on a team-local page', () => {
  function teamLocal() {
    (globalThis as { __DISPATCH_SHARED__?: unknown }).__DISPATCH_SHARED__ = {
      root: '/repo',
      baseUrl: '',
    };
  }
  afterEach(() => {
    delete (globalThis as { __DISPATCH_SHARED__?: unknown })
      .__DISPATCH_SHARED__;
  });

  test('frames the gateway link, on its own origin, allowed its own cookie', async () => {
    teamLocal();
    const remoteUrl = 'http://192.168.1.5:51234/?dispatch_preview=1.sig';
    wrap(
      <TaskPreviewTab
        data={data({ preview: preview({ remoteUrl }) })}
        selectedRun={run}
      />
    );
    const frame = await screen.findByTitle('Run preview');
    expect(frame.getAttribute('src')).toBe(remoteUrl);
    expect(frame.getAttribute('sandbox')).toContain('allow-same-origin');
  });

  test('a refetch with a fresh grant does not reload the app under review', async () => {
    teamLocal();
    let n = 0;
    const d = data({ preview: preview() });
    (
      d.client as unknown as {
        fetchRunPreview: () => Promise<RunPreviewResult>;
      }
    ).fetchRunPreview = () => {
      n += 1;
      return Promise.resolve({
        preview: preview({
          remoteUrl: `http://h:1/?dispatch_preview=${n}.sig`,
        }),
      });
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <TaskPreviewTab data={d} selectedRun={run} />
      </QueryClientProvider>
    );
    const frame = await screen.findByTitle('Run preview');
    const first = frame.getAttribute('src');

    await act(async () => {
      await queryClient.refetchQueries();
      // react-query hands results to React on a timer, not synchronously, so
      // give it that tick — otherwise this would pass whatever the tab did.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(n).toBeGreaterThan(1);
    expect(screen.getByTitle('Run preview').getAttribute('src')).toBe(first);
  });

  test('without a link a teammate can reach, it says so instead of framing a 403', async () => {
    teamLocal();
    wrap(
      <TaskPreviewTab data={data({ preview: preview() })} selectedRun={run} />
    );
    expect(
      await screen.findByText("This preview is only on the host's machine")
    ).toBeTruthy();
    expect(screen.queryByTitle('Run preview')).toBeNull();
  });
});

test('outside team-local mode a remote link is ignored and the frame stays opaque', async () => {
  wrap(
    <TaskPreviewTab
      data={data({
        preview: preview({ remoteUrl: 'http://h:1/?dispatch_preview=x' }),
      })}
      selectedRun={run}
    />
  );
  const frame = await screen.findByTitle('Run preview');
  expect(frame.getAttribute('src')).toBe('http://127.0.0.1:4771/preview/r-1/');
  expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
});

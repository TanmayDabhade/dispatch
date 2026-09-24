import type { ApiClient, ReadinessReading } from '@dispatch/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';

import { readinessFor, readingsOf, useReadiness } from './useReadiness';

const reading = (level: ReadinessReading['level']): ReadinessReading => ({
  level,
  label: `level ${level}`,
  confidence: 0.9,
  splitProbability: 0.1,
});

describe('readingsOf', () => {
  test('reads full docs and meta-only items alike', () => {
    expect(
      readingsOf([
        { meta: { id: 't-1' }, readiness: reading(0) },
        { meta: { id: 't-2' } },
      ])
    ).toEqual({ 't-1': reading(0) });
  });
});

describe('readinessFor', () => {
  test('keeps only readings for tasks still in the ready set', () => {
    const map = readinessFor(
      { 't-1': reading(0), 't-2': reading(3) },
      new Set(['t-2'])
    );
    expect([...map.keys()]).toEqual(['t-2']);
  });
});

// A client that answers the two readiness routes and counts the judging one.
function fakeClient(judged: boolean) {
  const calls = { judge: 0, cached: 0 };
  const client = {
    fetchReadiness: () => {
      calls.cached += 1;
      return Promise.resolve({ 't-1': reading(1) });
    },
    fetchReadyTasks: () => {
      calls.judge += 1;
      return Promise.resolve([
        {
          meta: { id: 't-1' },
          ...(judged ? { readiness: reading(3) } : {}),
        },
      ]);
    },
  } as unknown as ApiClient;
  return { client, calls };
}

function mount(client: ApiClient, readyIds: ReadonlySet<string>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderHook(
    () => useReadiness(client, 1, true, readyIds, { first: 5, debounce: 20 }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    }
  );
}

describe('useReadiness', () => {
  test('paints the cached reading, then the judged one', async () => {
    const { client, calls } = fakeClient(true);
    const { result } = mount(client, new Set(['t-1']));
    await waitFor(() => {
      expect(result.current.readinessById.get('t-1')?.level).toBe(3);
    });
    expect(calls).toEqual({ judge: 1, cached: 1 });
  });

  test('a burst of changes costs one judge', async () => {
    const { client, calls } = fakeClient(true);
    const { result } = mount(client, new Set(['t-1']));
    await waitFor(() => {
      expect(calls.judge).toBe(1);
    });
    act(() => {
      for (let i = 0; i < 5; i++) result.current.scheduleJudge();
    });
    await waitFor(() => {
      expect(calls.judge).toBe(2);
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(calls.judge).toBe(2);
  });

  test('stops judging once the daemon shows it judges nothing', async () => {
    const { client, calls } = fakeClient(false);
    const { result } = mount(client, new Set(['t-1']));
    await waitFor(() => {
      expect(calls.judge).toBe(1);
    });
    act(() => {
      result.current.scheduleJudge();
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(calls.judge).toBe(1);
    expect(result.current.readinessById.get('t-1')?.level).toBe(1);
  });
});

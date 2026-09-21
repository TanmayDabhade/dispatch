import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';

import {
  type DeepLinkRouterDeps,
  useDeepLinkRouter,
} from './useDeepLinkRouter';

// Under happy-dom `useDeepLinks` takes the browser-harness branch, so a link
// is "received" by putting `?root=&task=` on the URL before the hook mounts
// (see useDeepLinks.test.ts for why `setURL` and not `replaceState`).
function setLink(root: string, task: string) {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(
    `http://localhost:5173/?root=${encodeURIComponent(root)}&task=${task}`
  );
}

afterEach(() => {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL('http://localhost:5173/');
});

type Toast = Parameters<DeepLinkRouterDeps['notify']>[0];

interface Harness {
  deps: DeepLinkRouterDeps;
  opened: string[];
  toasts: Toast[];
  switched: string[];
  checked: string[];
}

function harness(
  overrides: Partial<DeepLinkRouterDeps> & { tasks?: string[] } = {}
): Harness {
  const opened: string[] = [];
  const toasts: Toast[] = [];
  const switched: string[] = [];
  const checked: string[] = [];
  const tasks = overrides.tasks ?? ['t-1a2b3c'];
  const deps: DeepLinkRouterDeps = {
    activeProjectPath: '/repo/a',
    tasksLoading: false,
    hasTask: (id) => tasks.includes(id),
    hasDispatch: (path) => {
      checked.push(path);
      return Promise.resolve(true);
    },
    switchProject: (path) => switched.push(path),
    openTask: (id) => opened.push(id),
    notify: (toast) => toasts.push(toast),
    ...overrides,
  };
  return { deps, opened, toasts, switched, checked };
}

describe('useDeepLinkRouter', () => {
  test('a same-project link opens once tasks have loaded', async () => {
    setLink('/repo/a', 't-1a2b3c');
    const h = harness({ tasksLoading: true });
    const { rerender } = renderHook(
      (deps: DeepLinkRouterDeps) => useDeepLinkRouter(deps),
      { initialProps: h.deps }
    );
    expect(h.opened).toEqual([]);
    rerender({ ...h.deps, tasksLoading: false });
    await waitFor(() => expect(h.opened).toEqual(['t-1a2b3c']));
    expect(h.checked).toEqual([]);
    expect(h.switched).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  test('a link is consumed once: later loads do not reopen it', async () => {
    setLink('/repo/a', 't-1a2b3c');
    const h = harness();
    const { rerender } = renderHook(
      (deps: DeepLinkRouterDeps) => useDeepLinkRouter(deps),
      { initialProps: h.deps }
    );
    await waitFor(() => expect(h.opened).toEqual(['t-1a2b3c']));
    rerender({ ...h.deps, tasksLoading: true });
    rerender({ ...h.deps, tasksLoading: false });
    expect(h.opened).toEqual(['t-1a2b3c']);
  });

  test('another project is checked, switched to, and opened once active', async () => {
    setLink('/repo/b', 't-1a2b3c');
    const h = harness();
    const { rerender } = renderHook(
      (deps: DeepLinkRouterDeps) => useDeepLinkRouter(deps),
      { initialProps: h.deps }
    );
    await waitFor(() => expect(h.switched).toEqual(['/repo/b']));
    expect(h.checked).toEqual(['/repo/b']);
    expect(h.opened).toEqual([]);
    // The switch resets nav and loads the new project's tasks.
    rerender({ ...h.deps, activeProjectPath: '/repo/b', tasksLoading: true });
    expect(h.opened).toEqual([]);
    rerender({ ...h.deps, activeProjectPath: '/repo/b', tasksLoading: false });
    await waitFor(() => expect(h.opened).toEqual(['t-1a2b3c']));
    expect(h.toasts).toEqual([]);
  });

  test('a project without .dispatch toasts Project not found', async () => {
    setLink('/repo/nowhere', 't-1a2b3c');
    const h = harness({ hasDispatch: () => Promise.resolve(false) });
    renderHook((deps: DeepLinkRouterDeps) => useDeepLinkRouter(deps), {
      initialProps: h.deps,
    });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0]).toEqual({
      title: 'Project not found',
      description: '/repo/nowhere',
      tone: 'error',
    });
    expect(h.switched).toEqual([]);
    expect(h.opened).toEqual([]);
  });

  test('a check that throws also reads as Project not found', async () => {
    setLink('/repo/b', 't-1a2b3c');
    const h = harness({ hasDispatch: () => Promise.reject(new Error('no')) });
    renderHook((deps: DeepLinkRouterDeps) => useDeepLinkRouter(deps), {
      initialProps: h.deps,
    });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0]?.title).toBe('Project not found');
  });

  test('an unknown id toasts Task not found', async () => {
    setLink('/repo/a', 't-ffffff');
    const h = harness();
    renderHook((deps: DeepLinkRouterDeps) => useDeepLinkRouter(deps), {
      initialProps: h.deps,
    });
    await waitFor(() => expect(h.toasts).toHaveLength(1));
    expect(h.toasts[0]).toEqual({
      title: 'Task not found',
      description: 't-ffffff',
      tone: 'error',
    });
    expect(h.opened).toEqual([]);
  });

  test('garbage toasts Bad link with the url', async () => {
    setLink('/repo/a', 'not-an-id');
    const h = harness();
    renderHook((deps: DeepLinkRouterDeps) => useDeepLinkRouter(deps), {
      initialProps: h.deps,
    });
    await act(async () => {});
    expect(h.toasts).toEqual([
      {
        title: 'Bad link',
        description: `dispatch://task/not-an-id?project=${encodeURIComponent('/repo/a')}`,
        tone: 'error',
      },
    ]);
    expect(h.checked).toEqual([]);
  });
});

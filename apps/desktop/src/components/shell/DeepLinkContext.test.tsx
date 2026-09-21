import { act, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';

import {
  DeepLinkProvider,
  useCopyTaskLink,
  useDeepLinkActions,
} from './DeepLinkContext';
import { ToastProvider } from './Toasts';

// The harness URL a copied link is derived from: `token` must not survive.
function setHarnessUrl(search: string) {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(`http://localhost:5173/${search}`);
}

function stubClipboard(written: string[], fail?: Error) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        if (fail) return Promise.reject(fail);
        written.push(text);
        return Promise.resolve();
      },
    },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

afterEach(() => setHarnessUrl(''));

describe('useDeepLinkActions', () => {
  test('is null outside the provider', () => {
    const { result } = renderHook(() => useDeepLinkActions());
    expect(result.current).toBeNull();
  });

  test('hands back the provided actions', () => {
    const actions = { copyTaskLink: () => {} };
    const { result } = renderHook(() => useDeepLinkActions(), {
      wrapper: ({ children }) => (
        <DeepLinkProvider value={actions}>{children}</DeepLinkProvider>
      ),
    });
    expect(result.current).toBe(actions);
  });
});

describe('useCopyTaskLink (browser harness)', () => {
  test('writes the ?task= form without the token and toasts Copied link', async () => {
    setHarnessUrl(
      `?root=${encodeURIComponent('/repo/a')}&port=4100&token=secret`
    );
    const written: string[] = [];
    stubClipboard(written);
    const { result } = renderHook(() => useCopyTaskLink('/repo/a'), {
      wrapper,
    });
    act(() => {
      result.current('t-1a2b3c');
    });
    expect(written).toHaveLength(1);
    const url = new URL(written[0] ?? '');
    expect(url.searchParams.get('task')).toBe('t-1a2b3c');
    expect(url.searchParams.get('root')).toBe('/repo/a');
    expect(url.searchParams.get('port')).toBe('4100');
    expect(url.searchParams.has('token')).toBe(false);
    expect(await screen.findByText('Copied link')).toBeTruthy();
  });

  test('a denied clipboard toasts Copy failed with the reason', async () => {
    setHarnessUrl(`?root=${encodeURIComponent('/repo/a')}`);
    stubClipboard([], new Error('denied'));
    const { result } = renderHook(() => useCopyTaskLink('/repo/a'), {
      wrapper,
    });
    act(() => {
      result.current('t-1a2b3c');
    });
    expect(await screen.findByText('Copy failed')).toBeTruthy();
    expect(await screen.findByText('denied')).toBeTruthy();
  });

  test('no active project toasts Copy failed and writes nothing', async () => {
    const written: string[] = [];
    stubClipboard(written);
    const { result } = renderHook(() => useCopyTaskLink(null), { wrapper });
    act(() => {
      result.current('t-1a2b3c');
    });
    expect(written).toEqual([]);
    expect(await screen.findByText('Copy failed')).toBeTruthy();
    expect(await screen.findByText('No project is open')).toBeTruthy();
  });
});

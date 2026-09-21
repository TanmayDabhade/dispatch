import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';

import { useDeepLinks } from './useDeepLinks';

// happy-dom has no `__TAURI_INTERNALS__`, so every test here exercises the
// browser-harness branch: the `?task=&root=` query on `window.location`.
// The registrator's document starts at `about:blank`, where `replaceState`
// refuses a URL, so happy-dom's own `setURL` gives it an origin first.
function setSearch(search: string) {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(`http://localhost:5173/${search}`);
}

afterEach(() => setSearch(''));

describe('useDeepLinks (browser harness)', () => {
  test('a ?task= beside ?root= yields exactly one link in the app form', () => {
    setSearch(
      `?root=${encodeURIComponent('/Users/me/repo')}&port=4100&token=secret&task=t-1a2b3c`
    );
    const seen: string[] = [];
    const { rerender } = renderHook(() =>
      useDeepLinks((url) => seen.push(url))
    );
    rerender();
    expect(seen).toEqual([
      `dispatch://task/t-1a2b3c?project=${encodeURIComponent('/Users/me/repo')}`,
    ]);
  });

  test('no params yields nothing', () => {
    const seen: string[] = [];
    renderHook(() => useDeepLinks((url) => seen.push(url)));
    expect(seen).toEqual([]);
  });

  test('a task without a root yields nothing', () => {
    setSearch('?task=t-1a2b3c');
    const seen: string[] = [];
    renderHook(() => useDeepLinks((url) => seen.push(url)));
    expect(seen).toEqual([]);
  });

  test('the latest handler is the one called, without resubscribing', () => {
    setSearch(`?root=${encodeURIComponent('/repo')}&task=t-1a2b3c`);
    const first: string[] = [];
    const second: string[] = [];
    const { rerender } = renderHook(
      ({ sink }: { sink: string[] }) => useDeepLinks((url) => sink.push(url)),
      { initialProps: { sink: first } }
    );
    rerender({ sink: second });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});

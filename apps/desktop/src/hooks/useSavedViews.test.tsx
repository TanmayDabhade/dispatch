import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'bun:test';

import { loadFavorites, loadSavedViews } from '../lib/savedViews';
import { EMPTY_TASK_FILTER_SET, type TaskFilterSet } from '../lib/taskFilters';
import { DEFAULT_TASKS_DISPLAY } from '../lib/tasksPrefs';
import { useSavedViews } from './useSavedViews';

const FILTERS: TaskFilterSet = {
  clauses: [{ facet: 'priority', op: 'is', values: ['urgent'] }],
  join: 'and',
};

function mount(initial: string | null = '/a') {
  return renderHook(({ root }) => useSavedViews(root), {
    initialProps: { root: initial },
  });
}

function save(
  api: ReturnType<typeof useSavedViews>,
  name: string,
  favorite = false
) {
  return api.saveView({
    name,
    filters: FILTERS,
    display: DEFAULT_TASKS_DISPLAY,
    favorite,
  });
}

describe('useSavedViews', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('saveView persists, returns the view and stars it when asked', () => {
    const { result } = mount();
    let saved!: ReturnType<typeof save>;
    act(() => {
      saved = save(result.current, 'Urgent', true);
    });
    expect(saved.id).toMatch(/^v-[0-9a-f]{6}$/);
    expect(saved.name).toBe('Urgent');
    expect(saved.filters).toEqual(FILTERS);
    expect(Date.parse(saved.createdAt)).not.toBeNaN();
    expect(result.current.views).toEqual([saved]);
    expect(result.current.isFavorite({ kind: 'view', id: saved.id })).toBe(
      true
    );
    expect(loadSavedViews('/a', window.localStorage)).toEqual([saved]);
    expect(loadFavorites('/a', window.localStorage)).toEqual([
      { kind: 'view', id: saved.id },
    ]);
  });

  test('switching projectPath reloads the other root and clears the active view', () => {
    const { result, rerender } = mount();
    let id = '';
    act(() => {
      id = save(result.current, 'A only').id;
      result.current.selectView(id);
    });
    expect(result.current.activeView?.name).toBe('A only');

    rerender({ root: '/b' });
    expect(result.current.views).toEqual([]);
    expect(result.current.activeViewId).toBeNull();
    expect(result.current.activeView).toBeNull();

    act(() => {
      save(result.current, 'B only');
    });
    rerender({ root: '/a' });
    expect(result.current.views.map((v) => v.name)).toEqual(['A only']);
    expect(
      loadSavedViews('/b', window.localStorage).map((v) => v.name)
    ).toEqual(['B only']);
  });

  test('deleteView on the active view clears it and drops its favourite', () => {
    const { result } = mount();
    let id = '';
    act(() => {
      id = save(result.current, 'Doomed', true).id;
      result.current.selectView(id);
    });
    act(() => {
      result.current.toggleFavorite({ kind: 'task', id: 't-1' });
    });
    act(() => {
      result.current.deleteView(id);
    });
    expect(result.current.views).toEqual([]);
    expect(result.current.activeViewId).toBeNull();
    expect(result.current.favorites).toEqual([{ kind: 'task', id: 't-1' }]);
    expect(loadFavorites('/a', window.localStorage)).toEqual([
      { kind: 'task', id: 't-1' },
    ]);
  });

  test('rename, update and clearActiveView persist and keep the selection', () => {
    const { result } = mount();
    let id = '';
    act(() => {
      id = save(result.current, 'Old').id;
      result.current.selectView(id);
    });
    act(() => {
      result.current.renameView(id, 'New');
    });
    act(() => {
      result.current.updateView(id, {
        filters: EMPTY_TASK_FILTER_SET,
        display: { ...DEFAULT_TASKS_DISPLAY, layout: 'list' },
      });
    });
    expect(result.current.activeView?.name).toBe('New');
    expect(result.current.activeView?.filters).toEqual(EMPTY_TASK_FILTER_SET);
    expect(result.current.activeView?.display.layout).toBe('list');
    expect(loadSavedViews('/a', window.localStorage)[0]?.display.layout).toBe(
      'list'
    );
    act(() => {
      result.current.clearActiveView();
    });
    expect(result.current.activeViewId).toBeNull();
    expect(result.current.views).toHaveLength(1);
  });

  test('is inert without a root', () => {
    const { result } = mount(null);
    act(() => {
      save(result.current, 'Nowhere');
      result.current.toggleFavorite({ kind: 'task', id: 't-1' });
    });
    expect(result.current.views).toHaveLength(1);
    expect(window.localStorage.length).toBe(0);
  });

  test('the api object is stable across renders that change nothing', () => {
    const { result, rerender } = mount();
    const first = result.current;
    rerender({ root: '/a' });
    expect(result.current).toBe(first);
  });
});

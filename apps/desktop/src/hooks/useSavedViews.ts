import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  addSavedView,
  type FavoriteRef,
  isFavorite,
  loadFavorites,
  loadSavedViews,
  newViewId,
  removeSavedView,
  renameSavedView,
  type SavedView,
  saveFavorites,
  saveSavedViews,
  toggleFavorite,
} from '../lib/savedViews';
import type { TaskFilterSet } from '../lib/taskFilters';
import type { TasksDisplayPrefs } from '../lib/tasksPrefs';

export interface SavedViewsApi {
  views: SavedView[];
  favorites: FavoriteRef[];
  /** The view the Tasks page is showing, or null for the built-in tabs. */
  activeViewId: string | null;
  activeView: SavedView | null;
  selectView(id: string): void;
  clearActiveView(): void;
  /** Persists a new view (starring it when asked) and returns it — the caller selects it. */
  saveView(input: {
    name: string;
    filters: TaskFilterSet;
    display: TasksDisplayPrefs;
    favorite: boolean;
  }): SavedView;
  /** Overwrites a view's snapshot — "Update view" after its filters drifted. */
  updateView(
    id: string,
    patch: { filters: TaskFilterSet; display: TasksDisplayPrefs }
  ): void;
  renameView(id: string, name: string): void;
  deleteView(id: string): void;
  toggleFavorite(ref: FavoriteRef): void;
  isFavorite(ref: FavoriteRef): boolean;
}

function loadViews(projectPath: string | null): SavedView[] {
  return projectPath === null
    ? []
    : loadSavedViews(projectPath, window.localStorage);
}

function readFavorites(projectPath: string | null): FavoriteRef[] {
  return projectPath === null
    ? []
    : loadFavorites(projectPath, window.localStorage);
}

/**
 * The saved views and favorites for one project root, every mutation persisted. The hook
 * swaps roots in place (App keeps one instance and changes `projectPath`), so the state seeds
 * from storage on mount and reloads in an effect when the root changes; `activeViewId` resets
 * with the root and when its view is deleted. The returned object is memoised so it can sit
 * in effect deps without firing on every render.
 */
export function useSavedViews(projectPath: string | null): SavedViewsApi {
  const [views, setViews] = useState<SavedView[]>(() => loadViews(projectPath));
  const [favorites, setFavorites] = useState<FavoriteRef[]>(() =>
    readFavorites(projectPath)
  );
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  useEffect(() => {
    setViews(loadViews(projectPath));
    setFavorites(readFavorites(projectPath));
    setActiveViewId(null);
  }, [projectPath]);

  // Every mutation goes through a functional updater so two calls in one tick compose
  // instead of the second clobbering the first with a stale snapshot. Persisting inside the
  // updater is safe: `setItem` is idempotent under StrictMode's double invoke. Both writers
  // no-op without a root — the get-started state has nowhere to persist to.
  const commitViews = useCallback(
    (update: (prev: SavedView[]) => SavedView[]) => {
      setViews((prev) => {
        const next = update(prev);
        if (next !== prev && projectPath !== null) {
          saveSavedViews(projectPath, next, window.localStorage);
        }
        return next;
      });
    },
    [projectPath]
  );
  const commitFavorites = useCallback(
    (update: (prev: FavoriteRef[]) => FavoriteRef[]) => {
      setFavorites((prev) => {
        const next = update(prev);
        if (next !== prev && projectPath !== null) {
          saveFavorites(projectPath, next, window.localStorage);
        }
        return next;
      });
    },
    [projectPath]
  );

  return useMemo<SavedViewsApi>(() => {
    const activeView = views.find((v) => v.id === activeViewId) ?? null;
    return {
      views,
      favorites,
      activeViewId,
      activeView,
      selectView: (id) => {
        setActiveViewId(id);
      },
      clearActiveView: () => {
        setActiveViewId(null);
      },
      saveView: ({ name, filters, display, favorite }) => {
        const view: SavedView = {
          id: newViewId(),
          name,
          filters,
          display,
          createdAt: new Date().toISOString(),
        };
        commitViews((prev) => addSavedView(prev, view));
        if (favorite) {
          commitFavorites((prev) =>
            toggleFavorite(prev, { kind: 'view', id: view.id })
          );
        }
        return view;
      },
      updateView: (id, patch) => {
        commitViews((prev) =>
          prev.map((v) => (v.id === id ? { ...v, ...patch } : v))
        );
      },
      renameView: (id, name) => {
        commitViews((prev) => renameSavedView(prev, id, name));
      },
      deleteView: (id) => {
        commitViews((prev) => removeSavedView(prev, [], id).views);
        // Only a view that was starred changes the favorites list; returning `prev`
        // otherwise skips the write and the re-render.
        commitFavorites((prev) => {
          const next = removeSavedView([], prev, id).favorites;
          return next.length === prev.length ? prev : next;
        });
        if (activeViewId === id) setActiveViewId(null);
      },
      toggleFavorite: (ref) => {
        commitFavorites((prev) => toggleFavorite(prev, ref));
      },
      isFavorite: (ref) => isFavorite(favorites, ref),
    };
  }, [views, favorites, activeViewId, commitViews, commitFavorites]);
}

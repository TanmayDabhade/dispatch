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

function loadFavs(projectPath: string | null): FavoriteRef[] {
  return projectPath === null
    ? []
    : loadFavorites(projectPath, window.localStorage);
}

/**
 * The saved views and favourites for one project root, every mutation persisted. The hook
 * swaps roots in place (App keeps one instance and changes `projectPath`), so the state seeds
 * from storage on mount and reloads in an effect when the root changes; `activeViewId` resets
 * with the root and when its view is deleted. The returned object is memoised so it can sit
 * in effect deps without firing on every render.
 */
export function useSavedViews(projectPath: string | null): SavedViewsApi {
  const [views, setViews] = useState<SavedView[]>(() => loadViews(projectPath));
  const [favorites, setFavorites] = useState<FavoriteRef[]>(() =>
    loadFavs(projectPath)
  );
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  useEffect(() => {
    setViews(loadViews(projectPath));
    setFavorites(loadFavs(projectPath));
    setActiveViewId(null);
  }, [projectPath]);

  // Both writers no-op without a root: the get-started state has nowhere to persist to.
  const commitViews = useCallback(
    (next: SavedView[]) => {
      setViews(next);
      if (projectPath !== null) {
        saveSavedViews(projectPath, next, window.localStorage);
      }
    },
    [projectPath]
  );
  const commitFavorites = useCallback(
    (next: FavoriteRef[]) => {
      setFavorites(next);
      if (projectPath !== null) {
        saveFavorites(projectPath, next, window.localStorage);
      }
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
        commitViews(addSavedView(views, view));
        if (favorite) {
          commitFavorites(
            toggleFavorite(favorites, { kind: 'view', id: view.id })
          );
        }
        return view;
      },
      updateView: (id, patch) => {
        commitViews(views.map((v) => (v.id === id ? { ...v, ...patch } : v)));
      },
      renameView: (id, name) => {
        commitViews(renameSavedView(views, id, name));
      },
      deleteView: (id) => {
        const next = removeSavedView(views, favorites, id);
        commitViews(next.views);
        if (next.favorites.length !== favorites.length) {
          commitFavorites(next.favorites);
        }
        if (activeViewId === id) setActiveViewId(null);
      },
      toggleFavorite: (ref) => {
        commitFavorites(toggleFavorite(favorites, ref));
      },
      isFavorite: (ref) => isFavorite(favorites, ref),
    };
  }, [views, favorites, activeViewId, commitViews, commitFavorites]);
}

import {
  EMPTY_TASK_FILTER_SET,
  type TaskFilterSet,
  taskFilterSetFromValue,
} from './taskFilters';
import {
  DEFAULT_TASKS_DISPLAY,
  serializeTasksDisplay,
  tasksDisplayFromValue,
  type TasksDisplayPrefs,
} from './tasksPrefs';

/**
 * Saved views and favorites (Linear's Views and the header star): a view is a named
 * snapshot of the Tasks page's filter set and display model, a favourite points at a view or
 * a task. Both live per project root in localStorage, the `lib/inbox.ts` shape — `Pick<Storage>`
 * parameters so tests pass stubs, a swallowed `setItem` throw — and parse defensively so a
 * stale or hand-edited payload degrades to defaults rather than breaking the page.
 */

export interface SavedView {
  id: string;
  name: string;
  filters: TaskFilterSet;
  display: TasksDisplayPrefs;
  /** ISO timestamp; `''` when a stored entry lacks one. */
  createdAt: string;
}

export interface FavoriteRef {
  kind: 'view' | 'task';
  id: string;
}

const FAVORITE_KINDS: readonly FavoriteRef['kind'][] = ['view', 'task'];

function viewsKey(root: string): string {
  return `dispatch:saved-views:${root}`;
}

function favoritesKey(root: string): string {
  return `dispatch:favorites:${root}`;
}

// One stored entry as a view, or null when it lacks the string id/name every view needs.
// `filters` and `display` go through the same parsers the Tasks page uses, so a view saved
// by an older build reads back with defaults for whatever it no longer carries.
function savedViewFromValue(value: unknown): SavedView | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.name !== 'string') {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    filters: taskFilterSetFromValue(record.filters) ?? EMPTY_TASK_FILTER_SET,
    display: tasksDisplayFromValue(record.display) ?? DEFAULT_TASKS_DISPLAY,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
  };
}

function favoriteFromValue(value: unknown): FavoriteRef | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.kind !== 'string' ||
    !(FAVORITE_KINDS as readonly string[]).includes(record.kind) ||
    typeof record.id !== 'string'
  ) {
    return null;
  }
  return { kind: record.kind as FavoriteRef['kind'], id: record.id };
}

// The stored JSON array under `key`, with each entry mapped through `parse`; anything that
// is not a JSON array (missing, malformed, a foreign shape) is an empty list.
function loadList<T>(
  key: string,
  storage: Pick<Storage, 'getItem'>,
  parse: (value: unknown) => T | null
): T[] {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parse).filter((entry): entry is T => entry !== null);
  } catch {
    return [];
  }
}

// `setItem` can throw (quota, Safari private browsing); a failed persist is a warning, not a
// crash, since this runs from inside React state updates.
function saveList(
  key: string,
  payload: unknown,
  storage: Pick<Storage, 'setItem'>,
  what: string
): void {
  try {
    storage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    console.warn(`dispatch: failed to persist ${what}`, err);
  }
}

export function loadSavedViews(
  root: string,
  storage: Pick<Storage, 'getItem'>
): SavedView[] {
  return loadList(viewsKey(root), storage, savedViewFromValue);
}

/** Writes `display` through `serializeTasksDisplay`'s object (properties as a sorted array)
 * so the stored payload is stable for a given view. */
export function saveSavedViews(
  root: string,
  views: readonly SavedView[],
  storage: Pick<Storage, 'setItem'>
): void {
  const payload = views.map((view) => ({
    ...view,
    display: JSON.parse(serializeTasksDisplay(view.display)) as unknown,
  }));
  saveList(viewsKey(root), payload, storage, 'saved views');
}

export function loadFavorites(
  root: string,
  storage: Pick<Storage, 'getItem'>
): FavoriteRef[] {
  return loadList(favoritesKey(root), storage, favoriteFromValue);
}

export function saveFavorites(
  root: string,
  favorites: readonly FavoriteRef[],
  storage: Pick<Storage, 'setItem'>
): void {
  saveList(favoritesKey(root), favorites, storage, 'favorites');
}

/** `v-` plus six hex characters — short enough to read in a URL, random enough that two
 * views saved in one session never collide. */
export function newViewId(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return (
    'v-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  );
}

export function addSavedView(
  views: readonly SavedView[],
  view: SavedView
): SavedView[] {
  return [...views, view];
}

export function renameSavedView(
  views: readonly SavedView[],
  id: string,
  name: string
): SavedView[] {
  return views.map((view) => (view.id === id ? { ...view, name } : view));
}

/** Drops the view and, with it, its favourite — a star on a view that no longer exists
 * would render as a dead link. */
export function removeSavedView(
  views: readonly SavedView[],
  favorites: readonly FavoriteRef[],
  id: string
): { views: SavedView[]; favorites: FavoriteRef[] } {
  return {
    views: views.filter((view) => view.id !== id),
    favorites: favorites.filter(
      (ref) => !(ref.kind === 'view' && ref.id === id)
    ),
  };
}

function sameRef(a: FavoriteRef, b: FavoriteRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function isFavorite(
  favorites: readonly FavoriteRef[],
  ref: FavoriteRef
): boolean {
  return favorites.some((f) => sameRef(f, ref));
}

/** Adds `ref` to the end of the list, or removes it when already starred. */
export function toggleFavorite(
  favorites: readonly FavoriteRef[],
  ref: FavoriteRef
): FavoriteRef[] {
  return isFavorite(favorites, ref)
    ? favorites.filter((f) => !sameRef(f, ref))
    : [...favorites, { kind: ref.kind, id: ref.id }];
}

// The filter set with clause order and each clause's value order fixed, for equality only —
// the stored payload keeps the user's order. Removing and re-adding a value in the Filter
// menu must not read as drift.
function normalizedFilterKey(filters: TaskFilterSet): string {
  const clauses = filters.clauses
    .map((c) => ({ facet: c.facet, op: c.op, values: [...c.values].sort() }))
    .sort((a, b) =>
      a.facet === b.facet
        ? a.op.localeCompare(b.op)
        : a.facet.localeCompare(b.facet)
    );
  return JSON.stringify({ clauses, join: filters.join });
}

/** Whether the page currently shows exactly this view — the header's "which tab is active"
 * and "has the active view drifted" question. Compares normalized forms: the display
 * serializer writes a fixed field order with `properties` sorted, and the filter set is
 * compared with clauses and values sorted so only a semantic change counts. */
export function viewMatches(
  view: SavedView,
  filters: TaskFilterSet,
  display: TasksDisplayPrefs
): boolean {
  return (
    normalizedFilterKey(view.filters) === normalizedFilterKey(filters) &&
    serializeTasksDisplay(view.display) === serializeTasksDisplay(display)
  );
}

import type { TaskListItem, TaskMeta } from '@dispatch/core/browser';

// The server's list order (packages/server/src/cache.ts): created, then id.
function before(a: TaskMeta, b: TaskMeta): boolean {
  if (a.created !== b.created) return a.created < b.created;
  return a.id < b.id;
}

/** The cached task list with `meta` in place of its old entry, or inserted where the
 * server would list it — so a single task's refetch never needs the whole list again.
 * An older `updated` than the cached one is a stale response and leaves the list as is. */
export function upsertTaskListItem(
  list: TaskListItem[],
  meta: TaskMeta
): TaskListItem[] {
  const index = list.findIndex((t) => t.meta.id === meta.id);
  if (index !== -1) {
    if (meta.updated < list[index].meta.updated) return list;
    const next = [...list];
    next[index] = { meta };
    return next;
  }
  let at = list.length;
  while (at > 0 && before(meta, list[at - 1].meta)) at--;
  return [...list.slice(0, at), { meta }, ...list.slice(at)];
}

/** The cached task list without `id` — the task was deleted. */
export function removeTaskListItem(
  list: TaskListItem[],
  id: string
): TaskListItem[] {
  return list.filter((t) => t.meta.id !== id);
}

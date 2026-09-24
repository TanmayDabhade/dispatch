import type { TaskStorePort } from '@dispatch/core';

import type { TaskCache } from '../cache.js';

/** Task writes per cache rebuild and `task.changed` broadcast. */
const FLUSH_EVERY = 250;

/**
 * Collects the ids of tasks a sync pass wrote and publishes them in chunks:
 * one cache rebuild and one `task.changed` naming the chunk per flush, never
 * one per task. A client patches a small chunk in place and refetches its
 * list once for a big one, so a 2000-issue import costs eight refreshes.
 */
export class TaskChangeBatch {
  private readonly pending = new Set<string>();
  private total = 0;

  constructor(
    private readonly store: TaskStorePort,
    private readonly cache: TaskCache,
    private readonly publish: (ids: string[]) => void
  ) {}

  add(id: string): void {
    this.pending.add(id);
    if (this.pending.size >= FLUSH_EVERY) this.flush();
  }

  /** Ids written so far, flushed or not. */
  count(): number {
    return this.total + this.pending.size;
  }

  flush(): void {
    if (this.pending.size === 0) return;
    const ids = [...this.pending];
    this.pending.clear();
    this.total += ids.length;
    this.cache.rebuild(this.store);
    this.publish(ids);
  }
}

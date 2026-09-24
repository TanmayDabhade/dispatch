import type { TaskDoc, TaskStorePort } from '@dispatch/core';

import type { TaskCache } from '../cache.js';

/** The longest a pass holds written ids before publishing them. */
const FLUSH_EVERY_MS = 1_500;

/**
 * Collects the ids of tasks a sync pass wrote and publishes them together:
 * one cache update and one `task.changed` naming them per flush, at most one
 * flush every 1.5s while a pass runs, plus one when it ends. The pass holds
 * every doc it wrote, so the cache takes just those rows without reading the
 * store back. A client patches a small set in place and refetches
 * its list once for a big one, so even a 2000-issue import costs a handful
 * of refreshes.
 */
export class TaskChangeBatch {
  private readonly pending = new Set<string>();
  private total = 0;
  private lastFlush = Date.now();

  constructor(
    private readonly store: TaskStorePort,
    private readonly cache: TaskCache,
    private readonly resolve: (id: string) => TaskDoc | undefined,
    private readonly publish: (ids: string[]) => void
  ) {}

  add(id: string): void {
    this.pending.add(id);
    if (Date.now() - this.lastFlush >= FLUSH_EVERY_MS) this.flush();
  }

  /** Ids written so far, flushed or not. */
  count(): number {
    return this.total + this.pending.size;
  }

  flush(): void {
    this.lastFlush = Date.now();
    if (this.pending.size === 0) return;
    const ids = [...this.pending];
    this.pending.clear();
    this.total += ids.length;
    const docs = ids.map(this.resolve);
    if (docs.every((d): d is TaskDoc => d !== undefined)) {
      this.cache.upsert(docs);
    } else {
      this.cache.refresh(this.store, ids);
    }
    this.publish(ids);
  }
}

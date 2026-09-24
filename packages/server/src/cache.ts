import {
  canonicalKind,
  canonicalStatus,
  CONTAINER_KINDS,
  readyTasks,
  taskIdFromFilename,
} from '@dispatch/core';
import type {
  ListSafeError,
  StatusModel,
  TaskDoc,
  TaskListItem,
  TaskMeta,
  TaskStorePort,
} from '@dispatch/core';
import { Database } from 'bun:sqlite';

// Loose query shape (plain strings, not core's TaskKind/Priority unions) since
// values here come straight off HTTP query params.
export interface CacheFilter {
  status?: string;
  kind?: string;
  parent?: string;
  // Only containers: a container kind, or any task some other task names as
  // its parent (see core's isContainer).
  containers?: boolean;
  // When false/omitted, query() excludes archived tasks (the default board view).
  includeArchived?: boolean;
}

// Cached rows hold canonical kinds, so the legacy `epic` never appears here.
const CONTAINER_SQL = CONTAINER_KINDS.map((k) => `'${k}'`).join(', ');

interface TaskRow {
  json: string;
}

// A doc with its content stamp, ready to write.
interface StampedDoc {
  doc: TaskDoc;
  stamp: string;
}

// Rebuilds each object with its keys sorted, for stampOf.
function sortedKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key];
  return sorted;
}

// A hash of a doc's content that ignores key order. The doc a writer holds
// and the same doc read back from its file can list the same fields in a
// different order (a patch appends a key the file had elsewhere), so this,
// not the JSON, is what tells a real edit from an echo of one.
function stampOf(doc: TaskDoc): string {
  return String(Bun.hash(JSON.stringify(doc, sortedKeys)));
}

// Whether a recorded problem is about task `id`: keyed by the id itself on
// the database backend, by the file it names on the file backend.
function isProblemFor(problem: ListSafeError, id: string): boolean {
  if (problem.file === id) return true;
  return taskIdFromFilename(problem.file.replace(/\.md$/, '')) === id;
}

/**
 * In-memory read cache for the task graph, derived one-way from whichever
 * store the daemon opened (markdown files or its SQLite database). The cache
 * never writes to the store — everything in it was read from there, so it is
 * always safely reconstructible from source, which remains the single source
 * of truth (see spec §4).
 *
 * A writer that knows which tasks it touched calls `refresh()` with their ids;
 * `resync()` is the full rescan for a change nobody can name. Both write only
 * the rows whose content changed and report which ones those were.
 *
 * The full TaskDoc is stashed as a `json` column and reconstructed on read;
 * the other columns exist purely so SQL can filter/sort without touching the
 * blob, per the phase-2 plan's schema. `stamp` is the doc's content hash (see
 * stampOf).
 */
export class TaskCache {
  private readonly db: Database;
  // Parse failures from the most recent rescan, kept current by refreshes
  // (empty when every task parsed cleanly). Kept around so `problems()` can
  // surface them at `GET /api/health` without the caller having to thread
  // them through separately.
  private lastErrors: ListSafeError[] = [];

  constructor() {
    this.db = new Database(':memory:');
    this.db.run(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT,
        status TEXT,
        kind TEXT,
        parent TEXT,
        priority TEXT,
        assignee TEXT,
        created TEXT,
        updated TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        json TEXT,
        stamp TEXT
      )
    `);
  }

  /** resync(), returning the parse failures it met. */
  rebuild(store: TaskStorePort): ListSafeError[] {
    this.resync(store);
    return this.lastErrors;
  }

  /**
   * Makes the cache match the whole store, writing only the rows that differ,
   * and returns the ids of the tasks that were added, changed or removed.
   *
   * `listSafe()` rather than `list()`, so one corrupt task file costs itself
   * rather than the rescan: it is left out and named by `problems()`. The scan
   * runs before any write, so one that throws outright (the tasks directory
   * vanishing mid-scan) leaves the last-good rows in place.
   */
  resync(store: TaskStorePort): string[] {
    const { docs, errors } = store.listSafe();
    const previous = new Map(
      (
        this.db.query('SELECT id, stamp FROM tasks').all() as {
          id: string;
          stamp: string;
        }[]
      ).map((row) => [row.id, row.stamp])
    );
    const writes: StampedDoc[] = [];
    const changed = new Set<string>();
    for (const doc of docs) {
      const stamp = stampOf(doc);
      const before = previous.get(doc.meta.id);
      previous.delete(doc.meta.id);
      if (before === stamp) continue;
      writes.push({ doc, stamp });
      changed.add(doc.meta.id);
    }
    const removed = [...previous.keys()];
    this.apply(writes, removed);
    this.lastErrors = errors;
    return [...changed, ...removed];
  }

  /**
   * Re-reads just these tasks from the store and writes their rows; a task the
   * store no longer has, or can no longer parse, leaves the cache. Returns the
   * ids whose rows changed, which is how the file watcher tells someone's edit
   * from the echo of a write this daemon already applied.
   */
  refresh(store: TaskStorePort, ids: Iterable<string>): string[] {
    const select = this.db.query('SELECT stamp FROM tasks WHERE id = $id');
    const writes: StampedDoc[] = [];
    const removed: string[] = [];
    for (const id of new Set(ids)) {
      let doc: TaskDoc | null = null;
      const problems = this.lastErrors.filter((e) => !isProblemFor(e, id));
      try {
        doc = store.get(id);
      } catch (err) {
        problems.push({ file: id, message: (err as Error).message });
      }
      this.lastErrors = problems;
      const before = (select.get({ $id: id }) as { stamp: string } | null)
        ?.stamp;
      if (doc === null) {
        if (before !== undefined) removed.push(id);
        continue;
      }
      const stamp = stampOf(doc);
      if (stamp !== before) writes.push({ doc, stamp });
    }
    this.apply(writes, removed);
    return [...writes.map((w) => w.doc.meta.id), ...removed];
  }

  /**
   * Writes just these docs over their cached rows. For a writer that already
   * holds what it wrote (a sync pass importing thousands of tasks), where even
   * re-reading each one would cost a parse per task file.
   */
  upsert(docs: readonly TaskDoc[]): void {
    this.apply(
      docs.map((doc) => ({ doc, stamp: stampOf(doc) })),
      []
    );
  }

  private apply(writes: readonly StampedDoc[], removed: readonly string[]) {
    if (writes.length === 0 && removed.length === 0) return;
    const insert = this.db.query(
      `INSERT OR REPLACE INTO tasks (id, title, status, kind, parent, priority, assignee, created, updated, archived, json, stamp)
       VALUES ($id, $title, $status, $kind, $parent, $priority, $assignee, $created, $updated, $archived, $json, $stamp)`
    );
    const remove = this.db.query('DELETE FROM tasks WHERE id = $id');
    this.db.transaction(() => {
      for (const id of removed) remove.run({ $id: id });
      for (const { doc, stamp } of writes) {
        insert.run({
          $id: doc.meta.id,
          $title: doc.meta.title,
          $status: doc.meta.status,
          $kind: doc.meta.kind,
          $parent: doc.meta.parent,
          $priority: doc.meta.priority,
          $assignee: doc.meta.assignee,
          $created: doc.meta.created,
          $updated: doc.meta.updated,
          $archived: doc.meta.archivedAt !== undefined ? 1 : 0,
          $json: JSON.stringify(doc),
          $stamp: stamp,
        });
      }
    })();
  }

  // Human-readable form of the current parse failures, for
  // `GET /api/health`'s `problems` field — empty when the task set is clean.
  problems(): string[] {
    return this.lastErrors.map((e) => `${e.file}: ${e.message}`);
  }

  // Matches TaskStorePort.list()'s filter semantics and sort order (created, then
  // id) so API responses stay consistent whether they hit the store directly
  // or the cache.
  query(filter: CacheFilter = {}): TaskDoc[] {
    return this.select('json', filter).map(
      (json) => JSON.parse(json) as TaskDoc
    );
  }

  // query() without bodies: SQLite extracts `meta` from the stored blob, so a
  // large board's list never serializes or parses its descriptions.
  queryMeta(filter: CacheFilter = {}): TaskListItem[] {
    return this.select("json_extract(json, '$.meta')", filter).map((json) => ({
      meta: JSON.parse(json) as TaskMeta,
    }));
  }

  // Runs one filtered, ordered SELECT of `column` (a JSON text expression).
  private select(column: string, filter: CacheFilter): string[] {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (filter.status !== undefined) {
      clauses.push('status = $status');
      // Cached rows hold canonical statuses; the alias layer covers the query
      // side too, so `?status=backlog` keeps finding drafts forever.
      params.$status = canonicalStatus(filter.status);
    }
    if (filter.kind !== undefined) {
      clauses.push('kind = $kind');
      params.$kind = canonicalKind(filter.kind);
    }
    if (filter.parent !== undefined) {
      clauses.push('parent = $parent');
      params.$parent = filter.parent;
    }
    if (filter.containers === true) {
      clauses.push(
        `(kind IN (${CONTAINER_SQL}) OR id IN (SELECT parent FROM tasks WHERE parent IS NOT NULL))`
      );
    }
    if (filter.includeArchived !== true) {
      clauses.push('archived = 0');
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .query(
        `SELECT ${column} AS json FROM tasks ${where} ORDER BY created, id`
      )
      .all(params) as TaskRow[];
    return rows.map((row) => row.json);
  }

  // Whether `id` can fan out: a container kind, or a task with children.
  isContainer(id: string): boolean {
    const row = this.db
      .query(
        `SELECT 1 AS hit FROM tasks WHERE (id = $id AND kind IN (${CONTAINER_SQL})) OR parent = $id LIMIT 1`
      )
      .get({ $id: id });
    return row !== null;
  }

  get(id: string): TaskDoc | null {
    const row = this.db
      .query('SELECT json FROM tasks WHERE id = $id')
      .get({ $id: id }) as TaskRow | null;
    return row !== null ? (JSON.parse(row.json) as TaskDoc) : null;
  }

  // Graph logic (blockers, priority ordering) stays in core's readyTasks — the
  // cache only supplies the current doc set, never reimplements the graph
  // rules in SQL.
  ready(model?: StatusModel): TaskDoc[] {
    // includeArchived, deliberately: readyTasks excludes archived tasks from
    // its results but resolves blockers against whatever it is given, so the
    // default archived-excluding query made an archived blocker read as
    // satisfied and sprang its dependents.
    return readyTasks(this.query({ includeArchived: true }), model);
  }
}

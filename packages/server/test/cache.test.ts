import { TaskStore } from '@dispatch/core';
import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TaskCache } from '../src/cache.js';

let root: string;
let store: TaskStore;
let cache: TaskCache;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dispatch-cache-'));
  store = TaskStore.init(root);
  cache = new TaskCache();
});

describe('rebuild + query', () => {
  it('mirrors store.list() after a rebuild', () => {
    store.create({ title: 'A' }, '2026-07-13T01:00:00Z');
    store.create({ title: 'B', status: 'draft' }, '2026-07-13T02:00:00Z');
    cache.rebuild(store);

    expect(cache.query().map((t) => t.meta.title)).toEqual(['A', 'B']);
    expect(cache.query({ status: 'draft' }).map((t) => t.meta.title)).toEqual([
      'B',
    ]);
  });

  it('reflects deletions and edits after a subsequent rebuild', () => {
    const a = store.create({ title: 'A' }, '2026-07-13T01:00:00Z');
    cache.rebuild(store);
    expect(cache.query()).toHaveLength(1);

    store.update(a.meta.id, { title: 'Renamed' }, '2026-07-13T02:00:00Z');
    cache.rebuild(store);
    expect(cache.query()[0].meta.title).toBe('Renamed');
  });
});

describe('upsert', () => {
  it('adds and replaces just the given rows, leaving the rest', () => {
    const a = store.create({ title: 'A' }, '2026-07-13T01:00:00Z');
    cache.rebuild(store);
    const renamed = store.update(
      a.meta.id,
      { title: 'A2' },
      '2026-07-13T02:00:00Z'
    );
    const b = store.create({ title: 'B' }, '2026-07-13T03:00:00Z');

    cache.upsert([renamed, b]);

    expect(cache.query().map((t) => t.meta.title)).toEqual(['A2', 'B']);
    expect(cache.get(b.meta.id)?.meta.title).toBe('B');
  });
});

describe('refresh', () => {
  it('re-reads just the named tasks and reports the ones that changed', () => {
    const a = store.create({ title: 'A' }, '2026-07-13T01:00:00Z');
    const b = store.create({ title: 'B' }, '2026-07-13T02:00:00Z');
    cache.rebuild(store);
    store.update(a.meta.id, { title: 'A2' });
    store.update(b.meta.id, { title: 'B2' });

    expect(cache.refresh(store, [a.meta.id])).toEqual([a.meta.id]);
    // B was not named, so its row still holds what the last read saw.
    expect(cache.query().map((t) => t.meta.title)).toEqual(['A2', 'B']);
    // Nothing moved since: a second refresh is an echo.
    expect(cache.refresh(store, [a.meta.id])).toEqual([]);
  });

  it('adds a new task and drops one the store no longer has', () => {
    const a = store.create({ title: 'A' }, '2026-07-13T01:00:00Z');
    cache.rebuild(store);
    const b = store.create({ title: 'B' }, '2026-07-13T02:00:00Z');
    store.remove(a.meta.id);

    expect(cache.refresh(store, [a.meta.id, b.meta.id]).sort()).toEqual(
      [a.meta.id, b.meta.id].sort()
    );
    expect(cache.query().map((t) => t.meta.title)).toEqual(['B']);
    expect(cache.refresh(store, ['t-000000'])).toEqual([]);
  });

  it('matches a doc read back from its file to the one the writer held', () => {
    const a = store.create({ title: 'A' }, '2026-07-13T01:00:00Z');
    cache.rebuild(store);
    // The patch adds a key the file lists elsewhere, so the two docs differ
    // in key order only.
    const held = store.update(a.meta.id, {
      archivedAt: '2026-07-14T00:00:00Z',
    });
    cache.upsert([held]);

    expect(cache.refresh(store, [a.meta.id])).toEqual([]);
  });

  it('drops a task whose file stops parsing, names it, and clears it once fixed', () => {
    const a = store.create({ title: 'A' }, '2026-07-13T01:00:00Z');
    cache.rebuild(store);
    const path = store.taskFilePath(a.meta.id)!;
    const good = readFileSync(path, 'utf8');
    writeFileSync(path, 'not a task file');

    expect(cache.refresh(store, [a.meta.id])).toEqual([a.meta.id]);
    expect(cache.get(a.meta.id)).toBeNull();
    expect(cache.problems()).toHaveLength(1);
    expect(cache.problems()[0]).toContain(a.meta.id);

    writeFileSync(path, good);
    expect(cache.refresh(store, [a.meta.id])).toEqual([a.meta.id]);
    expect(cache.problems()).toEqual([]);
  });
});

describe('resync', () => {
  it('writes and reports only what differs from the cache', () => {
    const a = store.create({ title: 'A' }, '2026-07-13T01:00:00Z');
    const b = store.create({ title: 'B' }, '2026-07-13T02:00:00Z');
    expect(cache.resync(store).sort()).toEqual([a.meta.id, b.meta.id].sort());
    expect(cache.resync(store)).toEqual([]);

    store.update(a.meta.id, { title: 'A2' });
    store.remove(b.meta.id);
    const c = store.create({ title: 'C' }, '2026-07-13T03:00:00Z');
    expect(cache.resync(store).sort()).toEqual(
      [a.meta.id, b.meta.id, c.meta.id].sort()
    );
    expect(cache.query().map((t) => t.meta.title)).toEqual(['A2', 'C']);
  });
});

describe('queryMeta', () => {
  it('returns the same rows as query() with every body left out', () => {
    store.create({ title: 'A' }, '2026-07-13T01:00:00Z');
    store.create({ title: 'B', status: 'draft' }, '2026-07-13T02:00:00Z');
    cache.rebuild(store);

    expect(cache.queryMeta()).toEqual(
      cache.query().map((doc) => ({ meta: doc.meta }))
    );
    expect(
      cache.queryMeta({ status: 'draft' }).map((t) => t.meta.title)
    ).toEqual(['B']);
  });
});

describe('get', () => {
  it('returns a single cached doc by id, or null', () => {
    const a = store.create({ title: 'A' }, '2026-07-13T01:00:00Z');
    cache.rebuild(store);
    expect(cache.get(a.meta.id)?.meta.title).toBe('A');
    expect(cache.get('t-000000')).toBeNull();
  });
});

describe('ready', () => {
  it('delegates to core readyTasks over all cached docs', () => {
    store.create({ title: 'Ready one' }, '2026-07-13T01:00:00Z');
    store.create(
      { title: 'Not ready', status: 'draft' },
      '2026-07-13T02:00:00Z'
    );
    cache.rebuild(store);
    expect(cache.ready().map((t) => t.meta.title)).toEqual(['Ready one']);
  });
});

import { TaskStore } from '@dispatch/core';
import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
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

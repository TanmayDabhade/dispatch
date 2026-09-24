import { TaskStore } from '@dispatch/core';
import type { LinearIssue } from '@dispatch/core';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TaskCache } from '../src/cache.js';
import { EventBus } from '../src/events.js';
import type { ServerEvent } from '../src/events.js';
import { HttpLinearClient } from '../src/linear/client.js';
import { ISSUE_PAGE } from '../src/linear/queries.js';
import { LinearSync } from '../src/linear/sync.js';
import {
  FakeLinearClient,
  LABELS,
  STATES,
  TEAMMATE,
  VIEWER,
} from './linearFake.js';
import { graphqlFetch } from './linearGraphqlFake.js';
import type { GraphqlWorld } from './linearGraphqlFake.js';

const ISSUES = 2000;

let root: string;
let store: TaskStore;
let cache: TaskCache;
let events: EventBus;
let broadcasts: ServerEvent[];
const originalHome = process.env.DISPATCH_HOME;

// A team of `count` issues across a project, with sub-issues, assignees,
// labels and blocking relations, as the real API would page them out.
function world(count: number): GraphqlWorld {
  const shape = new FakeLinearClient();
  const project = shape.project({ id: 'proj-big', name: 'Big project' });
  const issues: LinearIssue[] = [];
  for (let n = 0; n < count; n++) {
    const id = `iss-${n}`;
    issues.push(
      shape.issue({
        id,
        identifier: `HYD-${n}`,
        title: `Issue ${n}`,
        url: `https://linear.app/acme/issue/HYD-${n}`,
        updatedAt: new Date(Date.UTC(2026, 6, 1) + n * 1000).toISOString(),
        state: STATES[n % STATES.length],
        assigneeId: n % 3 === 0 ? TEAMMATE.id : null,
        projectId: n % 4 === 0 ? project.id : null,
        parentId: n % 10 === 5 ? `iss-${n - 1}` : null,
        relations:
          n % 25 === 1
            ? [
                {
                  id: `rel-${n}`,
                  type: 'blocks',
                  issueId: `iss-${n - 1}`,
                  relatedIssueId: id,
                },
              ]
            : [],
      })
    );
  }
  // Relations appear on both ends, as `relations` and `inverseRelations`.
  for (const issue of issues) {
    for (const r of issue.relations) {
      const other = issues.find((i) => i.id === r.issueId);
      if (other !== undefined && other !== issue)
        other.relations.push({ ...r });
    }
  }
  return {
    viewer: VIEWER,
    members: [VIEWER, TEAMMATE],
    states: STATES,
    labels: LABELS,
    issues,
    projects: [project],
  };
}

beforeEach(() => {
  process.env.DISPATCH_HOME = mkdtempSync(
    join(tmpdir(), 'dispatch-scale-home-')
  );
  root = mkdtempSync(join(tmpdir(), 'dispatch-scale-'));
  store = TaskStore.init(root);
  cache = new TaskCache();
  events = new EventBus();
  broadcasts = [];
  events.subscribe((event) => broadcasts.push(event));
  writeFileSync(
    join(root, '.dispatch', 'config.yml'),
    'autoCommit: false\nlinear:\n  enabled: true\n  teamId: team-1\n'
  );
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.DISPATCH_HOME;
  else process.env.DISPATCH_HOME = originalHome;
});

describe(`importing ${ISSUES} issues through the GraphQL client`, () => {
  it('pages sanely, batches its events and reports progress', async () => {
    const team = world(ISSUES);
    const { fetch, requests } = graphqlFetch(team);
    const sync = new LinearSync({
      rootDir: root,
      store,
      cache,
      events,
      client: new HttpLinearClient('lin_api_test', { fetchImpl: fetch }),
      localHumanRef: 'human:wyat',
    });

    // What a timer sees of the apply phase: it only ever fires mid-apply if
    // the import hands the event loop back as it writes.
    const seenApplying: number[] = [];
    const tick = setInterval(() => {
      const progress = sync.status().progress;
      if (progress?.phase === 'applying') seenApplying.push(progress.done);
    }, 1);
    const started = Date.now();
    const summary = await sync.importIssues();
    const elapsed = Date.now() - started;
    clearInterval(tick);
    expect(seenApplying.some((done) => done < ISSUES)).toBe(true);

    expect(summary.errors).toEqual([]);
    expect(summary.created).toBe(ISSUES + 1);
    const docs = store.list();
    expect(docs).toHaveLength(ISSUES + 1);

    // Pages at the query's own size, and never refetches one issue at a time.
    const pages = requests.filter((r) => r.operation === 'IssuesAll').length;
    expect(pages).toBe(Math.ceil(ISSUES / ISSUE_PAGE));
    expect(requests.some((r) => r.operation === 'IssuesById')).toBe(false);
    expect(requests.length).toBeLessThan(pages + 15);

    // Writes reach clients as a handful of batched events naming their ids —
    // at most one per 1.5s of work plus the last — never one per task.
    const changed = broadcasts.filter(
      (e): e is Extract<ServerEvent, { type: 'task.changed' }> =>
        e.type === 'task.changed'
    );
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThanOrEqual(Math.ceil(elapsed / 1500) + 2);
    expect(changed.every((e) => e.ids !== undefined)).toBe(true);
    const named = new Set(changed.flatMap((e) => e.ids ?? []));
    for (const doc of docs) expect(named.has(doc.meta.id)).toBe(true);

    // Progress runs through fetching then applying, and ends cleared.
    const progress = broadcasts.flatMap((e) =>
      e.type === 'linear.progress' ? [e.progress] : []
    );
    const fetching = progress.filter((p) => p.phase === 'issues');
    expect(fetching.at(-1)?.done).toBe(ISSUES);
    const applying = progress.filter((p) => p.phase === 'applying');
    expect(applying.length).toBeGreaterThan(1);
    expect(applying.at(-1)?.done).toBeGreaterThanOrEqual(ISSUES);
    expect(sync.status().progress).toBeNull();

    // The mapping held at scale.
    const byExternal = new Map(docs.map((d) => [d.meta.external, d.meta]));
    const project = byExternal.get('linear-project:proj-big');
    expect(byExternal.get('linear:iss-4')?.parent).toBe(project?.id);
    expect(byExternal.get('linear:iss-5')?.parent).toBe(
      byExternal.get('linear:iss-4')?.id
    );
    expect(byExternal.get('linear:iss-26')?.blockedBy).toEqual([
      byExternal.get('linear:iss-25')?.id ?? '',
    ]);
    expect(byExternal.get('linear:iss-3')?.assignee).toBe('human:ana');
    // No wall-clock bound: it flakes on a loaded machine. The page count and
    // the missing per-issue refetch above are what guard the cost.
  }, 300_000);

  it('follows an import with one cheap probe when nothing moved', async () => {
    const { fetch, requests } = graphqlFetch(world(300));
    const sync = new LinearSync({
      rootDir: root,
      store,
      cache,
      events,
      client: new HttpLinearClient('lin_api_test', { fetchImpl: fetch }),
      localHumanRef: 'human:wyat',
    });
    await sync.importIssues();
    await sync.syncOnce();
    requests.length = 0;

    await sync.syncOnce();

    expect(requests.map((r) => r.operation)).toEqual(['Probe']);
  }, 60_000);
});

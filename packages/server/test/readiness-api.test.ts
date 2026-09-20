import { TaskStore } from '@dispatch/core';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerHandle, StartServerOptions } from '../src/index.js';
import { startServer } from '../src/index.js';
import type { JudgmentClient } from '../src/judgments/client.js';
import { runGitSync } from './orchestrator/helpers.js';
import { useTestAuth } from './testAuth.js';

// GET /api/tasks/ready attaches a readiness reading per task when a judgment
// client is configured, GET /api/tasks/readiness serves the cache the board
// reads, and GET /api/queue ranks a judged title-only task below its peer.

function initDispatchGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-readiness-api-'));
  runGitSync(dir, ['init', '-b', 'main']);
  runGitSync(dir, ['config', 'user.email', 'test@example.com']);
  runGitSync(dir, ['config', 'user.name', 'Test']);
  writeFileSync(join(dir, 'README.md'), '# test repo\n');
  runGitSync(dir, ['add', '-A']);
  runGitSync(dir, ['commit', '-m', 'initial commit']);
  return dir;
}

let fakeHome: string;
let root: string;
let handle: ServerHandle | null = null;
let baseUrl: string;
const originalDispatchHome = process.env.DISPATCH_HOME;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'dispatch-home-'));
  process.env.DISPATCH_HOME = fakeHome;
  root = initDispatchGitRepo();
  TaskStore.init(root);
});

afterEach(async () => {
  await handle?.stop();
  handle = null;
  if (originalDispatchHome === undefined) delete process.env.DISPATCH_HOME;
  else process.env.DISPATCH_HOME = originalDispatchHome;
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

// Level 3 for a task whose body names a file, level 0 otherwise — the store
// always writes the section template, so "empty" is judged by content.
function bodyAwareClient(): JudgmentClient {
  return {
    model: 'jev-test',
    judge: (state) => {
      const body = (state as { body: string }).body;
      const level = body.includes('src/') ? '3' : '0';
      const probabilities: Record<string, number> = {
        '0': 0,
        '1': 0,
        '2': 0,
        '3': 0,
      };
      probabilities[level] = 1;
      return Promise.resolve({
        model: 'jev-test',
        answers: {
          readiness: {
            type: 'score',
            score: Number(level),
            confidence: 0.9,
            legend: {},
            probabilities,
          },
          split: { type: 'noul', noul: 0.05 },
        },
        usage: { input_tokens: 1, output_tokens: 0 },
      } as never);
    },
  };
}

async function boot(over: Partial<StartServerOptions>): Promise<void> {
  handle = await startServer({
    rootDir: root,
    port: 0,
    webDistDir: null,
    writeDaemonFile: false,
    judgments: null,
    ...over,
  });
  useTestAuth(handle);
  baseUrl = `http://127.0.0.1:${handle.port}`;
}

interface ReadyTask {
  meta: { id: string };
  readiness?: { level: number; label: string; splitProbability: number };
}

describe('readiness on the ready route', () => {
  it('attaches a reading per ready task and serves the cache map', async () => {
    const store = new TaskStore(root);
    const bare = store.create({ title: 'Bare', status: 'ready' });
    const full = store.create({
      title: 'Full',
      status: 'ready',
      description: 'Change src/x.ts so the thing works.',
    });
    await boot({ judgments: bodyAwareClient() });

    const ready = (await (
      await fetch(`${baseUrl}/api/tasks/ready`)
    ).json()) as ReadyTask[];
    const byId = new Map(ready.map((t) => [t.meta.id, t]));
    expect(byId.get(bare.meta.id)?.readiness?.level).toBe(0);
    expect(byId.get(full.meta.id)?.readiness?.level).toBe(3);
    expect(byId.get(full.meta.id)?.readiness?.splitProbability).toBe(0.05);

    const cache = (await (
      await fetch(`${baseUrl}/api/tasks/readiness`)
    ).json()) as Record<string, { level: number }>;
    expect(cache[bare.meta.id].level).toBe(0);
    expect(cache[full.meta.id].level).toBe(3);

    const queue = (await (await fetch(`${baseUrl}/api/queue`)).json()) as {
      tasks: {
        task: { meta: { id: string } };
        factors: { key: string; value: number }[];
      }[];
    };
    expect(queue.tasks.map((t) => t.task.meta.id)).toEqual([
      full.meta.id,
      bare.meta.id,
    ]);
    const factor = queue.tasks[1].factors.find((f) => f.key === 'readiness');
    expect(factor?.value).toBe(0);
  });

  it('leaves the ready route and the queue untouched without a client', async () => {
    const store = new TaskStore(root);
    const bare = store.create({ title: 'Bare', status: 'ready' });
    await boot({ judgments: null });

    const ready = (await (
      await fetch(`${baseUrl}/api/tasks/ready`)
    ).json()) as ReadyTask[];
    expect(ready[0].meta.id).toBe(bare.meta.id);
    expect('readiness' in ready[0]).toBe(false);

    const cache = await (await fetch(`${baseUrl}/api/tasks/readiness`)).json();
    expect(cache).toEqual({});

    const queue = (await (await fetch(`${baseUrl}/api/queue`)).json()) as {
      tasks: { factors: { key: string; weight: number; detail: string }[] }[];
    };
    const factor = queue.tasks[0].factors.find((f) => f.key === 'readiness');
    expect(factor?.weight).toBe(0);
    expect(factor?.detail).toBe('not judged');
  });
});

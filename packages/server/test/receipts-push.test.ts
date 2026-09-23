import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { ServerHandle } from '../src/index.js';
import { startServer } from '../src/index.js';
import { runGitSync } from './orchestrator/helpers.js';
import { rawFetch } from './testAuth.js';

// The receipt log leaving the machine: with `receipts.remote` set, every
// export that changes the log is pushed, so the audit trail — and the board
// it can rebuild — survives the machine it was written on.

let handle: ServerHandle | undefined;
const dirs: string[] = [];
const originalHome = process.env.DISPATCH_HOME;

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env.DISPATCH_HOME = temp('dispatch-home-');
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  if (originalHome === undefined) delete process.env.DISPATCH_HOME;
  else process.env.DISPATCH_HOME = originalHome;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function remoteHas(remote: string, path: string): boolean {
  const res = Bun.spawnSync({
    cmd: ['git', 'cat-file', '-e', `dispatch-receipts:${path}`],
    cwd: remote,
  });
  return res.exitCode === 0;
}

function remoteTree(remote: string): string {
  const res = Bun.spawnSync({
    cmd: ['git', 'ls-tree', '-r', '--name-only', 'dispatch-receipts'],
    cwd: remote,
  });
  return res.stdout.toString();
}

/** A project with `receipts` set as given, served; returns a task-maker. */
async function serve(root: string, receipts: string) {
  mkdirSync(join(root, '.dispatch'), { recursive: true });
  writeFileSync(
    join(root, '.dispatch', 'config.yml'),
    `receipts:\n  enabled: true\n${receipts}`
  );
  handle = await startServer({
    rootDir: root,
    port: 0,
    webDistDir: null,
    storeBackend: 'sqlite',
    receiptsDebounceMs: 20,
  });
  const port = handle.port;
  const token = handle.tokens.appToken;
  return async (title: string) => {
    const res = await rawFetch(`http://127.0.0.1:${port}/api/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title }),
    });
    return ((await res.json()) as { meta: { id: string } }).meta.id;
  };
}

async function waitForTask(remote: string, id: string): Promise<void> {
  for (let i = 0; i < 100 && !remoteTree(remote).includes(id); i++) {
    await Bun.sleep(50);
  }
}

function bareRemote(): string {
  const remote = temp('dispatch-receipts-remote-');
  runGitSync(remote, ['init', '-q', '--bare']);
  return remote;
}

function project(): string {
  const root = temp('dispatch-receipts-project-');
  runGitSync(root, ['init', '-q', '-b', 'main']);
  return root;
}

it('pushes the log to a repository of its own, and each change after', async () => {
  const remote = bareRemote();
  const create = await serve(project(), `  repo: ${remote}\n`);

  const id = await create('Survives the laptop');
  await waitForTask(remote, id);
  expect(remoteTree(remote)).toContain(id);
  expect(remoteHas(remote, 'README.md')).toBe(true);
});

it('or to a branch on one of the project’s own remotes, even one added as a relative path', async () => {
  // Git reads a relative remote URL against the directory it runs in, and
  // the push runs from the log's own clone, far from the project — so the
  // path is resolved against the project root first, where it was meant.
  const remote = bareRemote();
  const root = project();
  runGitSync(root, ['remote', 'add', 'origin', join('..', basename(remote))]);
  const create = await serve(root, '  remote: origin\n');

  const id = await create('Pushed next to the code');
  await waitForTask(remote, id);
  expect(remoteTree(remote)).toContain(id);
});

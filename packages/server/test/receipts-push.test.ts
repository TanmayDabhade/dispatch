import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

it('pushes the log to receipts.remote, and each change after', async () => {
  const remote = temp('dispatch-receipts-remote-');
  runGitSync(remote, ['init', '-q', '--bare']);
  const root = temp('dispatch-receipts-project-');
  runGitSync(root, ['init', '-q', '-b', 'main']);
  mkdirSync(join(root, '.dispatch'), { recursive: true });
  writeFileSync(
    join(root, '.dispatch', 'config.yml'),
    `receipts:\n  enabled: true\n  remote: ${remote}\n`
  );
  handle = await startServer({
    rootDir: root,
    port: 0,
    webDistDir: null,
    storeBackend: 'sqlite',
    receiptsDebounceMs: 20,
  });

  const res = await rawFetch(`http://127.0.0.1:${handle.port}/api/tasks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${handle.tokens.appToken}`,
    },
    body: JSON.stringify({ title: 'Survives the laptop' }),
  });
  const { meta } = (await res.json()) as { meta: { id: string } };

  for (let i = 0; i < 100 && !remoteTree(remote).includes(meta.id); i++) {
    await Bun.sleep(50);
  }
  expect(remoteTree(remote)).toContain(meta.id);
  expect(remoteHas(remote, 'README.md')).toBe(true);
});

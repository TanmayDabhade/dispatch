import {
  initProjectStores,
  materializeReceipts,
  openProjectStores,
  readProjectBackend,
} from '@dispatch/core';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CliContext } from '../src/context.js';
import { makeProgram } from '../src/program.js';

// The disaster-recovery half of the receipt log: a machine that pushed its log
// is gone, and a fresh checkout rebuilds the board from what it pushed.

const dirs: string[] = [];
const originalHome = process.env.DISPATCH_HOME;

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  const res = Bun.spawnSync({ cmd: ['git', ...args], cwd });
  if (res.exitCode !== 0)
    throw new Error(`git ${args.join(' ')}: ${res.stderr.toString()}`);
}

beforeEach(() => {
  process.env.DISPATCH_HOME = temp('dispatch-home-');
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.DISPATCH_HOME;
  else process.env.DISPATCH_HOME = originalHome;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A receipt log for a board with two tasks, pushed to a bare remote the way
 *  the daemon's exporter pushes it. */
function pushedLog(): { remote: string; ids: string[] } {
  const source = temp('dispatch-source-');
  const stores = initProjectStores({ rootDir: source, backend: 'sqlite' });
  const ids = [
    stores.tasks.create({ title: 'Fix the login redirect' }).meta.id,
    stores.tasks.create({ title: 'Write the release notes' }).meta.id,
  ];
  const log = temp('dispatch-log-');
  git(log, 'init', '-q', '-b', 'main');
  materializeReceipts(stores, log);
  stores.close();
  git(log, 'add', '-A');
  git(
    log,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '-m',
    'receipts'
  );
  const remote = temp('dispatch-remote-');
  git(remote, 'init', '-q', '--bare');
  git(log, 'push', '-q', remote, 'HEAD:dispatch-receipts');
  return { remote, ids };
}

test('a fresh checkout rebuilds the board from a pushed receipt log', async () => {
  const { remote, ids } = pushedLog();
  const fresh = temp('dispatch-fresh-');
  git(fresh, 'init', '-q', '-b', 'main');
  const lines: string[] = [];
  const ctx: CliContext = { cwd: fresh, log: (l) => lines.push(l) };

  await makeProgram(ctx).parseAsync(['receipts', 'restore', '--from', remote], {
    from: 'user',
  });

  const stores = openProjectStores({ rootDir: fresh, backend: 'sqlite' });
  try {
    expect(stores.tasks.get(ids[0])?.meta.title).toBe('Fix the login redirect');
    expect(stores.tasks.get(ids[1])?.meta.title).toBe(
      'Write the release notes'
    );
  } finally {
    stores.close();
  }
  // Marked, so the CLI and the next daemon read this board from the database.
  expect(readProjectBackend(fresh)).toBe('sqlite');
  expect(lines.join('\n')).toContain('Restored.');
});

test('a branch that is not there fails with where it looked', async () => {
  const { remote } = pushedLog();
  const fresh = temp('dispatch-fresh-');
  git(fresh, 'init', '-q', '-b', 'main');
  const ctx: CliContext = { cwd: fresh, log: () => {} };
  await expect(
    makeProgram(ctx).parseAsync(
      ['receipts', 'restore', '--from', remote, '--branch', 'nope'],
      { from: 'user' }
    )
  ).rejects.toThrow('could not fetch nope');
});

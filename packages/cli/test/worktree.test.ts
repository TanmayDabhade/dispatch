import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  defaultWorktreePath,
  parseWorktreeList,
} from '../src/commands/worktree.js';
import type { CliContext } from '../src/context.js';
import { makeProgram } from '../src/program.js';

describe('parseWorktreeList', () => {
  it('reads the porcelain records', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo-feature',
      'HEAD def456',
      'branch refs/heads/feature/x',
      '',
    ].join('\n');

    expect(parseWorktreeList(porcelain)).toEqual([
      {
        path: '/repo',
        head: 'abc123',
        branch: 'main',
        detached: false,
        main: true,
      },
      {
        path: '/repo-feature',
        head: 'def456',
        branch: 'feature/x',
        detached: false,
        main: false,
      },
    ]);
  });

  it('handles a detached worktree', () => {
    const porcelain = ['worktree /repo', 'HEAD abc123', 'detached', ''].join(
      '\n'
    );
    const [row] = parseWorktreeList(porcelain);
    expect(row?.detached).toBe(true);
    expect(row?.branch).toBeNull();
  });

  it('keeps a path containing spaces in one piece', () => {
    // The reason the porcelain form is parsed rather than the column output.
    const porcelain = [
      'worktree /my repos/thing',
      'HEAD abc',
      'detached',
      '',
    ].join('\n');
    expect(parseWorktreeList(porcelain)[0]?.path).toBe('/my repos/thing');
  });

  it('is empty for empty input', () => {
    expect(parseWorktreeList('')).toEqual([]);
  });
});

describe('defaultWorktreePath', () => {
  it('puts a worktree beside the repo, not inside it', () => {
    // Nested in its own repo, a worktree shows up as untracked content in
    // every `git status` and is easy to commit by accident.
    const path = defaultWorktreePath('/work/app', 'feature');
    expect(path).toBe(resolve('/work/app-feature'));
    expect(path.startsWith('/work/app/')).toBe(false);
  });

  it('flattens a branch name that is not filesystem-safe', () => {
    expect(defaultWorktreePath('/work/repo', 'feat/new thing')).toBe(
      resolve('/work/repo-feat-new-thing')
    );
  });
});

describe('dispatch worktree against a real repo', () => {
  let root: string;
  let logged: string[];
  let ctx: CliContext;

  async function run(args: string[]): Promise<void> {
    await makeProgram(ctx).parseAsync(['node', 'dispatch', ...args]);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dispatch-worktree-cli-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: root,
    });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    writeFileSync(join(root, 'README.md'), '# test\n');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: root });

    logged = [];
    ctx = { cwd: root, log: (line: string) => logged.push(line) };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists the main working copy', async () => {
    await run(['worktree', 'list', '--json']);
    const rows = JSON.parse(logged.join('\n')) as {
      main: boolean;
      branch: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.main).toBe(true);
    expect(rows[0]?.branch).toBe('main');
  });

  it('creates a worktree on a new branch and lists it', async () => {
    const target = join(root, '..', `${root.split('/').pop()}-wt`);
    await run(['worktree', 'create', 'feature/x', target]);
    try {
      expect(existsSync(target)).toBe(true);
      expect(existsSync(join(target, 'README.md'))).toBe(true);

      logged = [];
      await run(['worktree', 'list', '--json']);
      const rows = JSON.parse(logged.join('\n')) as { branch: string }[];
      expect(rows.map((row) => row.branch).sort()).toEqual([
        'feature/x',
        'main',
      ]);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('reuses an existing branch rather than failing', async () => {
    // Picking work back up is the ordinary case, and `git worktree add -b`
    // refuses a branch that already exists.
    execFileSync('git', ['branch', 'existing'], { cwd: root });
    const target = join(root, '..', `${root.split('/').pop()}-existing`);
    await run(['worktree', 'create', 'existing', target, '--json']);
    try {
      const row = JSON.parse(logged.join('\n')) as { created: boolean };
      expect(row.created).toBe(false);
      expect(existsSync(target)).toBe(true);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('removes a worktree and can delete its branch', async () => {
    const target = join(root, '..', `${root.split('/').pop()}-gone`);
    await run(['worktree', 'create', 'throwaway', target]);
    await run(['worktree', 'remove', target, '--delete-branch']);

    expect(existsSync(target)).toBe(false);
    expect(
      execFileSync('git', ['branch', '--list', 'throwaway'], {
        cwd: root,
        encoding: 'utf8',
      }).trim()
    ).toBe('');
  });

  it('refuses to remove the project’s own working copy', async () => {
    // Removing it would leave the user without a checkout at all.
    await expect(run(['worktree', 'remove', root])).rejects.toThrow(
      'own working copy'
    );
  });

  it('refuses a target that already exists', async () => {
    await expect(run(['worktree', 'create', 'x', root])).rejects.toThrow(
      'already exists'
    );
  });

  it('reports an unknown worktree instead of shelling out blindly', async () => {
    await expect(
      run(['worktree', 'remove', join(root, 'not-a-worktree')])
    ).rejects.toThrow('no worktree at');
  });
});

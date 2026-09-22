import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { remoteDestination } from '../src/commands/remote.js';
import type { CliContext } from '../src/context.js';
import { makeProgram } from '../src/program.js';

describe('remoteDestination', () => {
  it('is the bare host with no user', () => {
    expect(remoteDestination({ host: 'build-box' })).toBe('build-box');
  });

  it('prefixes the user when there is one', () => {
    expect(remoteDestination({ host: 'build-box', user: 'ci' })).toBe(
      'ci@build-box'
    );
  });

  it('treats an empty user as none', () => {
    expect(remoteDestination({ host: 'build-box', user: '' })).toBe(
      'build-box'
    );
  });
});

describe('dispatch remote list', () => {
  let root: string;
  let logged: string[];
  let ctx: CliContext;

  async function run(args: string[]): Promise<void> {
    await makeProgram(ctx).parseAsync(['node', 'dispatch', ...args]);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dispatch-remote-cli-'));
    mkdirSync(join(root, '.dispatch'), { recursive: true });
    logged = [];
    ctx = { cwd: root, log: (line: string) => logged.push(line) };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('says so when nothing is configured, and points at the config', async () => {
    writeFileSync(join(root, '.dispatch', 'config.yml'), 'autoCommit: true\n');
    await run(['remote', 'list']);
    expect(logged.join('\n')).toContain('no remotes configured');
  });

  it('lists what is configured', async () => {
    writeFileSync(
      join(root, '.dispatch', 'config.yml'),
      'remotes:\n  box:\n    host: build-box\n    user: ci\n    path: /srv/repo\n'
    );
    await run(['remote', 'list', '--json']);
    expect(JSON.parse(logged.join('\n'))).toEqual([
      { name: 'box', destination: 'ci@build-box', path: '/srv/repo' },
    ]);
  });

  it('errors on an unknown remote, naming the ones that exist', async () => {
    writeFileSync(
      join(root, '.dispatch', 'config.yml'),
      'remotes:\n  box:\n    host: build-box\n'
    );
    await expect(run(['remote', 'exec', 'nope', 'ls'])).rejects.toThrow('box');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  forwardArgs,
  parsePortPair,
  remoteDestination,
} from '../src/commands/remote.js';
import type { CliContext } from '../src/context.js';
import { CliError } from '../src/context.js';
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

describe('parsePortPair', () => {
  it('treats a single port as the same on both sides', () => {
    expect(parsePortPair('5173')).toEqual({
      localPort: 5173,
      remotePort: 5173,
    });
  });

  it('reads a local:remote pair', () => {
    expect(parsePortPair('8080:3000')).toEqual({
      localPort: 8080,
      remotePort: 3000,
    });
  });

  it('tolerates spaces', () => {
    expect(parsePortPair(' 8080 : 3000 ')).toEqual({
      localPort: 8080,
      remotePort: 3000,
    });
  });

  it('rejects anything that is not a port', () => {
    for (const bad of ['', 'http', '0', '-1', '70000', '1:2:3', '1.5']) {
      expect(() => parsePortPair(bad)).toThrow(CliError);
    }
  });
});

describe('forwardArgs', () => {
  it('binds only to loopback', () => {
    // Binding to every interface would quietly publish a forwarded dev server
    // to whatever network the laptop is on.
    expect(forwardArgs({ host: 'box' }, 5173, 5173)).toContain(
      '127.0.0.1:5173:127.0.0.1:5173'
    );
  });

  it('runs no remote command', () => {
    expect(forwardArgs({ host: 'box' }, 1, 2)).toContain('-N');
  });

  it('passes the port and identity file through', () => {
    const args = forwardArgs(
      { host: 'box', port: 2222, identityFile: '/keys/id' },
      1,
      2
    );
    expect(args).toContain('-p');
    expect(args).toContain('2222');
    expect(args).toContain('/keys/id');
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

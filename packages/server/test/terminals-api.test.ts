import { TaskStore } from '@dispatch/core';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerHandle } from '../src/index.js';
import { startServer } from '../src/index.js';
import { json } from './json.js';
import { runGitSync } from './orchestrator/helpers.js';
import { rawFetch, useTestAuth } from './testAuth.js';

function initDispatchGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-terminals-api-'));
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
let handle: ServerHandle;
let baseUrl: string;
const originalDispatchHome = process.env.DISPATCH_HOME;

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type'))
    headers.set('content-type', 'application/json');
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function decode(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf8');
}

// Polls the session until it reports `exited`, so no assertion races a shell.
async function waitForExit(id: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const info = await json(await apiFetch(`/api/terminals/${id}`));
    if (info.state === 'exited') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

beforeEach(async () => {
  fakeHome = mkdtempSync(join(tmpdir(), 'dispatch-home-'));
  process.env.DISPATCH_HOME = fakeHome;
  root = initDispatchGitRepo();
  TaskStore.init(root);
  handle = await startServer({ rootDir: root, port: 0 });
  useTestAuth(handle);
  baseUrl = `http://127.0.0.1:${handle.port}`;
});

afterEach(async () => {
  await handle.stop();
  if (originalDispatchHome === undefined) delete process.env.DISPATCH_HOME;
  else process.env.DISPATCH_HOME = originalDispatchHome;
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe('terminal routes', () => {
  it('opens a session in the project root and lists it', async () => {
    const created = await apiFetch('/api/terminals', {
      method: 'POST',
      body: JSON.stringify({
        command: ['sh', '-c', 'echo ready'],
        title: 'probe',
      }),
    });
    expect(created.status).toBe(201);
    const info = await json(created);
    expect(info.cwd).toBe(root);
    expect(info.title).toBe('probe');

    const listed = await json(await apiFetch('/api/terminals'));
    expect(listed.map((t: { id: string }) => t.id)).toEqual([info.id]);
  });

  it('serves output from a cursor and advances it', async () => {
    const info = await json(
      await apiFetch('/api/terminals', {
        method: 'POST',
        body: JSON.stringify({ command: ['sh', '-c', 'echo marker-one'] }),
      })
    );
    await waitForExit(info.id);

    const first = await json(
      await apiFetch(`/api/terminals/${info.id}/output?since=0`)
    );
    expect(decode(first.data)).toContain('marker-one');
    expect(first.more).toBe(false);

    // Resuming from the end of the last read returns nothing new.
    const second = await json(
      await apiFetch(`/api/terminals/${info.id}/output?since=${first.next}`)
    );
    expect(decode(second.data)).toBe('');
  });

  it('accepts keystrokes and echoes them back through the shell', async () => {
    const info = await json(
      await apiFetch('/api/terminals', {
        method: 'POST',
        body: JSON.stringify({ command: ['sh'] }),
      })
    );
    const typed = await apiFetch(`/api/terminals/${info.id}/input`, {
      method: 'POST',
      body: JSON.stringify({ data: 'echo typed-it-in\n' }),
    });
    expect(typed.status).toBe(200);

    let seen = '';
    for (let i = 0; i < 200; i++) {
      const out = await json(
        await apiFetch(`/api/terminals/${info.id}/output?since=0`)
      );
      seen = decode(out.data);
      if (seen.includes('typed-it-in')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(seen).toContain('typed-it-in');
  });

  it('records a resize', async () => {
    const info = await json(
      await apiFetch('/api/terminals', {
        method: 'POST',
        body: JSON.stringify({ command: ['sh'], cols: 80, rows: 24 }),
      })
    );
    const resized = await json(
      await apiFetch(`/api/terminals/${info.id}/resize`, {
        method: 'POST',
        body: JSON.stringify({ cols: 160, rows: 48 }),
      })
    );
    expect(resized.cols).toBe(160);
    expect(resized.rows).toBe(48);
  });

  it('409s input to a session that has already exited', async () => {
    const info = await json(
      await apiFetch('/api/terminals', {
        method: 'POST',
        body: JSON.stringify({ command: ['sh', '-c', 'exit 0'] }),
      })
    );
    await waitForExit(info.id);
    const res = await apiFetch(`/api/terminals/${info.id}/input`, {
      method: 'POST',
      body: JSON.stringify({ data: 'ls\n' }),
    });
    // Not a 404: the id is real, there is just nothing on the other end.
    expect(res.status).toBe(409);
  });

  it('deletes a session and forgets its scrollback', async () => {
    const info = await json(
      await apiFetch('/api/terminals', {
        method: 'POST',
        body: JSON.stringify({ command: ['sh'] }),
      })
    );
    expect(
      (await apiFetch(`/api/terminals/${info.id}`, { method: 'DELETE' })).status
    ).toBe(200);
    expect((await apiFetch(`/api/terminals/${info.id}`)).status).toBe(404);
  });

  it('404s an unknown id', async () => {
    expect((await apiFetch('/api/terminals/nope')).status).toBe(404);
    expect((await apiFetch('/api/terminals/nope/output')).status).toBe(404);
  });

  it('rejects a cwd outside the project', async () => {
    const res = await apiFetch('/api/terminals', {
      method: 'POST',
      body: JSON.stringify({ cwd: '../../etc', command: ['sh'] }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain('inside the project');
  });

  it('rejects a run with no worktree on disk', async () => {
    const res = await apiFetch('/api/terminals', {
      method: 'POST',
      body: JSON.stringify({ runId: 'run-that-never-was' }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain('no worktree');
  });

  it('validates the body', async () => {
    const badCommand = await apiFetch('/api/terminals', {
      method: 'POST',
      body: JSON.stringify({ command: 'sh' }),
    });
    expect(badCommand.status).toBe(400);

    const info = await json(
      await apiFetch('/api/terminals', {
        method: 'POST',
        body: JSON.stringify({ command: ['sh'] }),
      })
    );
    const badInput = await apiFetch(`/api/terminals/${info.id}/input`, {
      method: 'POST',
      body: JSON.stringify({ data: 42 }),
    });
    expect(badInput.status).toBe(400);
  });

  // The security property these routes are built around: a terminal is
  // arbitrary command execution, so the agent token must not reach it.
  it('refuses the agent token and accepts only the app token', async () => {
    const withAgentToken = await rawFetch(`${baseUrl}/api/terminals`, {
      headers: { authorization: `Bearer ${handle.tokens.agentToken}` },
    });
    expect(withAgentToken.status).toBe(403);

    const withAppToken = await rawFetch(`${baseUrl}/api/terminals`, {
      headers: { authorization: `Bearer ${handle.tokens.appToken}` },
    });
    expect(withAppToken.status).toBe(200);

    const spawnAttempt = await rawFetch(`${baseUrl}/api/terminals`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${handle.tokens.agentToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ command: ['sh'] }),
    });
    expect(spawnAttempt.status).toBe(403);
  });
});

// Remote sessions. The ssh invocation itself is covered in ssh.test.ts; this
// is about the route accepting a remote, validating it against config, and
// recording the session as remote.
describe('remote terminals', () => {
  function writeRemotesConfig(body: string): void {
    writeFileSync(join(root, '.dispatch', 'config.yml'), body);
  }

  it('lists no remotes when none are configured', async () => {
    expect(await json(await apiFetch('/api/remotes'))).toEqual([]);
  });

  it('lists configured remotes without leaking the identity file', async () => {
    // A key path is a local detail of whoever runs the daemon.
    writeRemotesConfig(
      'remotes:\n  box:\n    host: build-box\n    user: ci\n    path: /srv/repo\n    identityFile: /keys/id\n'
    );
    const remotes = await json(await apiFetch('/api/remotes'));
    expect(remotes).toEqual([
      {
        name: 'box',
        host: 'build-box',
        user: 'ci',
        port: null,
        path: '/srv/repo',
      },
    ]);
    expect(JSON.stringify(remotes)).not.toContain('/keys/id');
  });

  it('400s a remote that is not configured, naming the ones that are', async () => {
    writeRemotesConfig('remotes:\n  box:\n    host: build-box\n');
    const res = await apiFetch('/api/terminals', {
      method: 'POST',
      body: JSON.stringify({ remote: 'nonesuch' }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain('box');
  });

  it('opens a session against a configured remote and records it as remote', async () => {
    // `build-box` does not resolve, so the ssh process fails — which is fine:
    // what is asserted here is that the route built a remote session at all.
    writeRemotesConfig(
      'remotes:\n  box:\n    host: build-box\n    path: /srv/repo\n'
    );
    const info = await json(
      await apiFetch('/api/terminals', {
        method: 'POST',
        body: JSON.stringify({ remote: 'box' }),
      })
    );
    expect(info.remote).toBe('box');
    expect(info.command[0]).toBe('ssh');
    // ssh allocates the pty on the far side, so the command is NOT wrapped in
    // `script` — two nested ptys would double every echo.
    expect(info.command).not.toContain('script');
    expect(info.command.join(' ')).toContain('build-box');
    expect(info.title).toBe('box');
  });

  it('marks a local session as not remote', async () => {
    const info = await json(
      await apiFetch('/api/terminals', {
        method: 'POST',
        body: JSON.stringify({ command: ['sh'] }),
      })
    );
    expect(info.remote).toBeNull();
  });
});

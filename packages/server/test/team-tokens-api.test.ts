import { parseTeam, TaskStore } from '@dispatch/core';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerHandle } from '../src/index.js';
import { startServer } from '../src/index.js';
import { runGitSync } from './orchestrator/helpers.js';
import { rawFetch } from './testAuth.js';

// The invite flow end to end through a real daemon: issue a teammate a
// credential, use it, see it attributed, revoke it — and that none of it is
// reachable with the agent token.

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-team-tokens-'));
  runGitSync(dir, ['init', '-b', 'main']);
  runGitSync(dir, ['config', 'user.email', 'wyat@example.com']);
  runGitSync(dir, ['config', 'user.name', 'Wyat']);
  writeFileSync(join(dir, 'README.md'), '# test\n');
  runGitSync(dir, ['add', '-A']);
  runGitSync(dir, ['commit', '-m', 'initial']);
  return dir;
}

let fakeHome: string;
let root: string;
let handle: ServerHandle;
let baseUrl: string;
const originalHome = process.env.DISPATCH_HOME;

beforeEach(async () => {
  fakeHome = mkdtempSync(join(tmpdir(), 'dispatch-home-'));
  process.env.DISPATCH_HOME = fakeHome;
  root = initRepo();
  TaskStore.init(root);
  handle = await startServer({ rootDir: root, port: 0, webDistDir: null });
  baseUrl = `http://127.0.0.1:${handle.port}`;
});

afterEach(async () => {
  await handle.stop();
  if (originalHome === undefined) delete process.env.DISPATCH_HOME;
  else process.env.DISPATCH_HOME = originalHome;
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

function headers(token: string | null): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) h.authorization = `Bearer ${token}`;
  return h;
}

async function invite(body: object, token = handle.tokens.appToken) {
  return rawFetch(`${baseUrl}/api/team/tokens`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

describe('team tokens', () => {
  it('invites a teammate by email, adds them to the roster, and the token names them', async () => {
    const res = await invite({ email: 'ada@example.com', displayName: 'Ada' });
    expect(res.status).toBe(201);
    const issued = (await res.json()) as {
      handle: string;
      tier: string;
      token: string;
    };
    expect(issued.handle).toBe('ada');
    // A new teammate can drive before they can adjudicate.
    expect(issued.tier).toBe('request');

    const roster = parseTeam(
      readFileSync(join(root, '.dispatch', 'team.yml'), 'utf8')
    );
    expect(roster.map((m) => m.handle)).toContain('ada');

    const me = await rawFetch(`${baseUrl}/api/whoami`, {
      headers: headers(issued.token),
    });
    expect(await me.json()).toEqual({
      handle: 'ada',
      ref: 'human:ada',
      tier: 'request',
    });
  });

  it('an issued token survives a daemon restart', async () => {
    const { token } = (await (
      await invite({ email: 'ada@example.com' })
    ).json()) as {
      token: string;
    };
    await handle.stop();
    handle = await startServer({ rootDir: root, port: 0, webDistDir: null });
    baseUrl = `http://127.0.0.1:${handle.port}`;

    const me = await rawFetch(`${baseUrl}/api/whoami`, {
      headers: headers(token),
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { handle: string }).handle).toBe('ada');
  });

  it('nothing on disk carries the token itself', async () => {
    const { token } = (await (
      await invite({ email: 'ada@example.com' })
    ).json()) as {
      token: string;
    };
    const file = join(fakeHome, '.dispatch', 'projects');
    const found = Bun.spawnSync(['grep', '-r', token, file]);
    // grep exits 1 when it finds nothing.
    expect(found.exitCode).toBe(1);
  });

  it('refuses every team route to the agent token', async () => {
    // An agent must not be able to mint itself a second identity.
    const agent = handle.tokens.agentToken;
    expect((await invite({ email: 'eve@example.com' }, agent)).status).toBe(
      403
    );
    expect(
      (
        await rawFetch(`${baseUrl}/api/team/tokens`, {
          headers: headers(agent),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await rawFetch(`${baseUrl}/api/team/tokens/ada`, {
          method: 'DELETE',
          headers: headers(agent),
        })
      ).status
    ).toBe(403);
  });

  it('a teammate token at request tier cannot issue tokens either', async () => {
    const { token } = (await (
      await invite({ email: 'ada@example.com' })
    ).json()) as {
      token: string;
    };
    expect((await invite({ email: 'eve@example.com' }, token)).status).toBe(
      403
    );
  });

  it('lists holders without disclosing a token', async () => {
    const { token } = (await (
      await invite({ email: 'ada@example.com' })
    ).json()) as {
      token: string;
    };
    const res = await rawFetch(`${baseUrl}/api/team/tokens`, {
      headers: headers(handle.tokens.appToken),
    });
    const text = await res.text();
    expect(text).toContain('"ada"');
    expect(text).not.toContain(token);
  });

  it('revoking stops the token working immediately', async () => {
    const { token } = (await (
      await invite({ email: 'ada@example.com' })
    ).json()) as {
      token: string;
    };
    const del = await rawFetch(`${baseUrl}/api/team/tokens/ada`, {
      method: 'DELETE',
      headers: headers(handle.tokens.appToken),
    });
    expect(del.status).toBe(200);
    const me = await rawFetch(`${baseUrl}/api/whoami`, {
      headers: headers(token),
    });
    expect(me.status).toBe(401);
  });

  it('revoking nothing is a visible 404, not a silent success', async () => {
    const res = await rawFetch(`${baseUrl}/api/team/tokens/nobody`, {
      method: 'DELETE',
      headers: headers(handle.tokens.appToken),
    });
    expect(res.status).toBe(404);
  });

  it('a handle not on the roster is refused rather than invented', async () => {
    const res = await invite({ handle: 'ghost' });
    expect(res.status).toBe(404);
  });

  it('rejects an unknown tier', async () => {
    const res = await invite({ email: 'ada@example.com', tier: 'admin' });
    expect(res.status).toBe(400);
  });
});

describe('the tier ladder', () => {
  async function issued(body: object, token?: string): Promise<string> {
    const res = await invite(body, token);
    expect(res.status).toBe(201);
    return ((await res.json()) as { token: string }).token;
  }

  function get(path: string, token: string) {
    return rawFetch(`${baseUrl}${path}`, { headers: headers(token) });
  }

  function post(path: string, token: string, body: object = {}) {
    return rawFetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(body),
    });
  }

  it('the app token is the operator and can reach every rung', async () => {
    const me = await get('/api/whoami', handle.tokens.appToken);
    expect(((await me.json()) as { tier: string }).tier).toBe('operator');
    expect((await get('/api/terminals', handle.tokens.appToken)).status).toBe(
      200
    );
  });

  it('decide can approve but not open a shell, drive the browser or change the checkout', async () => {
    const lead = await issued({ email: 'grace@example.com', tier: 'decide' });

    // Above request: the team routes are decide-tier.
    expect((await get('/api/team/tokens', lead)).status).toBe(200);

    // Not operator: every one of these acts on the host as its owner.
    for (const res of [
      await get('/api/terminals', lead),
      await get('/api/browser', lead),
      await post('/api/files/write', lead, { path: 'x', text: 'y' }),
      await post('/api/git/stage', lead, { paths: ['README.md'] }),
      await post('/api/git/push', lead),
    ]) {
      expect(res.status).toBe(403);
      // The refusal says what was missing and how to get it.
      expect((await res.json()) as { error: string }).toEqual(
        expect.objectContaining({
          error: expect.stringContaining('needs the operator tier'),
        })
      );
    }
  });

  it('a teammate issued operator reaches the host routes', async () => {
    const ops = await issued({ email: 'linus@example.com', tier: 'operator' });
    expect((await get('/api/terminals', ops)).status).toBe(200);
  });

  it('request tier no longer changes the checkout, but still reads it', async () => {
    const agent = handle.tokens.agentToken;
    expect((await post('/api/git/stage', agent, { paths: ['x'] })).status).toBe(
      403
    );
    expect(
      (await post('/api/git/discard', agent, { paths: ['x'] })).status
    ).toBe(403);
    expect((await get('/api/git/status', agent)).status).toBe(200);
  });

  it('nobody hands out more than they hold', async () => {
    const lead = await issued({ email: 'grace@example.com', tier: 'decide' });

    // A decide-tier lead can invite reviewers at their own level or below…
    expect((await invite({ email: 'ada@example.com' }, lead)).status).toBe(201);
    expect(
      (await invite({ email: 'mary@example.com', tier: 'decide' }, lead)).status
    ).toBe(201);
    // …but minting an operator token would be a shell by another name.
    expect(
      (await invite({ email: 'eve@example.com', tier: 'operator' }, lead))
        .status
    ).toBe(403);
  });

  it('nor replaces or revokes a token above their own tier', async () => {
    const ops = await issued({ email: 'linus@example.com', tier: 'operator' });
    const lead = await issued({ email: 'grace@example.com', tier: 'decide' });

    // Re-inviting replaces the old token, so downgrading Linus is revoking
    // his operator token by another route.
    expect((await invite({ handle: 'linus' }, lead)).status).toBe(403);
    const del = await rawFetch(`${baseUrl}/api/team/tokens/linus`, {
      method: 'DELETE',
      headers: headers(lead),
    });
    expect(del.status).toBe(403);

    // Linus is untouched.
    expect((await get('/api/whoami', ops)).status).toBe(200);
  });
});

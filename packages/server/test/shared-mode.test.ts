import { TaskStore } from '@dispatch/core';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerHandle } from '../src/index.js';
import { startServer } from '../src/index.js';
import { runGitSync } from './orchestrator/helpers.js';
import { rawFetch } from './testAuth.js';

// Team-local mode end to end. The rules loopback made safe — an agent token
// injected into the served page, every loopback origin trusted, previews with
// no credential — are exactly the ones that must not survive a bind anyone on
// the network can reach. These tests reach the daemon over a real
// non-loopback interface where the machine has one, so "a teammate's browser"
// is an actual peer address, not a pretend one.

const LAN_ADDRESS = Object.values(networkInterfaces())
  .flat()
  .find((a) => a !== undefined && !a.internal && a.family === 'IPv4')?.address;

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-shared-'));
  runGitSync(dir, ['init', '-b', 'main']);
  runGitSync(dir, ['config', 'user.email', 'wyat@example.com']);
  runGitSync(dir, ['config', 'user.name', 'Wyat']);
  writeFileSync(join(dir, 'README.md'), '# test\n');
  runGitSync(dir, ['add', '-A']);
  runGitSync(dir, ['commit', '-m', 'initial']);
  return dir;
}

// A stand-in for the built desktop bundle: just enough for serveStatic.
function webDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-web-dist-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><html><head><title>Dispatch</title></head><body></body></html>'
  );
  return dir;
}

let fakeHome: string;
let root: string;
let handle: ServerHandle;
const originalHome = process.env.DISPATCH_HOME;

async function boot(host: string | undefined): Promise<void> {
  handle = await startServer({
    rootDir: root,
    port: 0,
    webDistDir: webDist(),
    ...(host === undefined ? {} : { host }),
  });
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'dispatch-home-'));
  process.env.DISPATCH_HOME = fakeHome;
  root = initRepo();
  TaskStore.init(root);
});

afterEach(async () => {
  await handle.stop();
  if (originalHome === undefined) delete process.env.DISPATCH_HOME;
  else process.env.DISPATCH_HOME = originalHome;
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe('loopback mode (the default) is unchanged', () => {
  it('still hands the served page its agent token', async () => {
    await boot(undefined);
    const html = await (
      await rawFetch(`http://127.0.0.1:${handle.port}/`)
    ).text();
    expect(html).toContain('__DISPATCH_DAEMON_TOKEN__');
    expect(html).toContain(handle.tokens.agentToken);
    expect(html).not.toContain('__DISPATCH_SHARED__');
  });
});

describe('team-local mode', () => {
  it('refuses a single interface address rather than losing loopback', async () => {
    await boot(undefined); // so afterEach has something to stop
    await expect(
      startServer({
        rootDir: root,
        port: 0,
        webDistDir: null,
        host: '192.168.1.5',
      })
    ).rejects.toThrow('0.0.0.0');
  });

  it('never injects a token into the page anyone on the network can load', async () => {
    await boot('0.0.0.0');
    const html = await (
      await rawFetch(`http://127.0.0.1:${handle.port}/`)
    ).text();

    // The whole point: injecting the operator's credential here would hand it
    // to every machine that can reach the port.
    expect(html).not.toContain(handle.tokens.agentToken);
    expect(html).not.toContain(handle.tokens.appToken);
    expect(html).not.toContain('__DISPATCH_DAEMON_TOKEN__');
    expect(html).toContain('__DISPATCH_SHARED__');
  });

  it('still answers the CLI and the app on loopback', async () => {
    await boot('0.0.0.0');
    const res = await rawFetch(`http://127.0.0.1:${handle.port}/api/whoami`, {
      headers: { authorization: `Bearer ${handle.tokens.agentToken}` },
    });
    expect(res.status).toBe(200);
  });

  it.skipIf(LAN_ADDRESS === undefined)(
    "trusts a teammate's page on the daemon's own origin",
    async () => {
      await boot('0.0.0.0');
      const origin = `http://${LAN_ADDRESS}:${handle.port}`;
      // A state change from the daemon's own network origin — what a
      // teammate's browser sends — passes the origin guard and reaches auth.
      const res = await rawFetch(`${origin}/api/tasks`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          authorization: `Bearer ${handle.tokens.agentToken}`,
        },
        body: JSON.stringify({ title: 'From a teammate' }),
      });
      expect(res.status).toBe(201);
    }
  );

  it.skipIf(LAN_ADDRESS === undefined)(
    'still rejects every other origin, however the Host header reads',
    async () => {
      await boot('0.0.0.0');
      // A DNS-rebinding page has an Origin and a Host that agree by
      // construction; agreeing with itself must not make it trusted.
      const res = await rawFetch(
        `http://${LAN_ADDRESS}:${handle.port}/api/tasks`,
        {
          method: 'POST',
          headers: {
            origin: `http://evil.example:${handle.port}`,
            host: `evil.example:${handle.port}`,
            'content-type': 'application/json',
            authorization: `Bearer ${handle.tokens.agentToken}`,
          },
          body: JSON.stringify({ title: 'Rebound' }),
        }
      );
      expect(res.status).toBe(403);
    }
  );

  it.skipIf(LAN_ADDRESS === undefined)(
    'serves previews only to the machine running the daemon',
    async () => {
      await boot('0.0.0.0');
      const fromLan = await rawFetch(
        `http://${LAN_ADDRESS}:${handle.port}/preview/r-any/`
      );
      expect(fromLan.status).toBe(403);

      // Loopback still reaches the proxy, which 404s a run with no preview.
      const fromHere = await rawFetch(
        `http://127.0.0.1:${handle.port}/preview/r-any/`
      );
      expect(fromHere.status).toBe(404);
    }
  );

  it.skipIf(LAN_ADDRESS === undefined)(
    'a teammate with an issued token is who they say, over the network',
    async () => {
      await boot('0.0.0.0');
      const issued = await rawFetch(
        `http://127.0.0.1:${handle.port}/api/team/tokens`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${handle.tokens.appToken}`,
          },
          body: JSON.stringify({ email: 'ada@example.com' }),
        }
      );
      const { token } = (await issued.json()) as { token: string };

      const me = await rawFetch(
        `http://${LAN_ADDRESS}:${handle.port}/api/whoami`,
        {
          headers: { authorization: `Bearer ${token}` },
        }
      );
      expect(((await me.json()) as { handle: string }).handle).toBe('ada');
    }
  );
});

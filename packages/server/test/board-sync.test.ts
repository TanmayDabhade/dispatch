import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerHandle } from '../src/index.js';
import { startServer } from '../src/index.js';
import { runGitSync } from './orchestrator/helpers.js';
import { rawFetch } from './testAuth.js';

// Board sync end to end: real daemons, each with its own project checkout
// and its own database, exchanging changes through a real git remote — a bare
// repository on disk, which is all a team's origin is to git.

let fakeHome: string;
let remote: string;
const handles: ServerHandle[] = [];
const dirs: string[] = [];
const originalHome = process.env.DISPATCH_HOME;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  fakeHome = tempDir('dispatch-home-');
  process.env.DISPATCH_HOME = fakeHome;
  remote = tempDir('dispatch-sync-remote-');
  runGitSync(remote, ['init', '-q', '--bare', '-b', 'main']);
});

afterEach(async () => {
  for (const h of handles.splice(0)) await h.stop();
  if (originalHome === undefined) delete process.env.DISPATCH_HOME;
  else process.env.DISPATCH_HOME = originalHome;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A teammate: their own checkout and database, sync pointed at `remoteUrl`. */
async function teammate(name: string, remoteUrl = remote, intervalSec = 3600) {
  const root = tempDir(`dispatch-sync-${name}-`);
  runGitSync(root, ['init', '-q', '-b', 'main']);
  runGitSync(root, ['config', 'user.email', `${name}@example.com`]);
  runGitSync(root, ['config', 'user.name', name]);
  writeFileSync(join(root, 'README.md'), `# ${name}\n`);
  mkdirSync(join(root, '.dispatch'), { recursive: true });
  // A long interval: every pass in these tests is asked for explicitly, so
  // what each assertion sees does not depend on a timer.
  writeFileSync(
    join(root, '.dispatch', 'config.yml'),
    `sync:\n  enabled: true\n  remote: ${remoteUrl}\n  intervalSec: ${intervalSec}\n`
  );
  runGitSync(root, ['add', '-A']);
  runGitSync(root, ['commit', '-q', '-m', 'init']);
  const handle = await startServer({
    rootDir: root,
    port: 0,
    webDistDir: null,
    storeBackend: 'sqlite',
  });
  handles.push(handle);
  const base = `http://127.0.0.1:${handle.port}`;
  const auth = { authorization: `Bearer ${handle.tokens.appToken}` };
  const api = async (path: string, init: RequestInit = {}) => {
    const res = await rawFetch(`${base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...auth, ...init.headers },
    });
    const text = await res.text();
    return {
      status: res.status,
      body: text === '' ? null : (JSON.parse(text) as Record<string, unknown>),
    };
  };
  return {
    handle,
    api,
    sync: () => api('/api/board-sync/now', { method: 'POST' }),
    create: async (title: string) =>
      (
        (
          await api('/api/tasks', {
            method: 'POST',
            body: JSON.stringify({ title }),
          })
        ).body as {
          meta: { id: string };
        }
      ).meta.id,
    patch: (id: string, patch: object) =>
      api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    get: async (id: string) => {
      const res = await api(`/api/tasks/${id}`);
      return res.status === 200
        ? (res.body as { meta: Record<string, unknown>; body: string })
        : null;
    },
  };
}

describe('board sync', () => {
  it('a task created on one machine appears on another', async () => {
    const ada = await teammate('ada');
    const grace = await teammate('grace');

    const id = await ada.create('Fix the login redirect');
    // A synced board mints the longer ids that make two machines picking the
    // same one vanishingly unlikely.
    expect(id).toMatch(/^t-[0-9a-f]{8}$/);
    expect((await ada.sync()).body?.lastError).toBeNull();
    await grace.sync();

    expect((await grace.get(id))?.meta.title).toBe('Fix the login redirect');
  });

  it('edits to different fields on both machines both survive', async () => {
    const ada = await teammate('ada');
    const grace = await teammate('grace');
    const id = await ada.create('Fix the login redirect');
    await ada.sync();
    await grace.sync();

    await ada.patch(id, { labels: ['auth'] });
    await grace.patch(id, { priority: 'high' });
    await ada.sync();
    await grace.sync();
    await ada.sync();

    for (const who of [ada, grace]) {
      const task = await who.get(id);
      expect(task?.meta.labels).toEqual(['auth']);
      expect(task?.meta.priority).toBe('high');
    }
  });

  it('the same field edited on both: the later edit wins on both', async () => {
    const ada = await teammate('ada');
    const grace = await teammate('grace');
    const id = await ada.create('Draft');
    await ada.sync();
    await grace.sync();

    await ada.patch(id, { title: 'Ada’s title' });
    await Bun.sleep(5);
    await grace.patch(id, { title: 'Grace’s title' });
    await ada.sync();
    await grace.sync();
    await ada.sync();

    expect((await ada.get(id))?.meta.title).toBe('Grace’s title');
    expect((await grace.get(id))?.meta.title).toBe('Grace’s title');
  });

  it('a deletion reaches the other machine', async () => {
    const ada = await teammate('ada');
    const grace = await teammate('grace');
    const id = await ada.create('Obsolete');
    await ada.sync();
    await grace.sync();
    expect(await grace.get(id)).not.toBeNull();

    // Removal has no public route (tasks are archived), so this goes through
    // the orchestrator's store, which is the wrapped one every caller holds.
    grace.handle.orchestrator['ctx'].store.remove(id);
    await grace.sync();
    await ada.sync();
    expect(await ada.get(id)).toBeNull();
  });

  it('a new machine with an empty database gets the whole board', async () => {
    const ada = await teammate('ada');
    const ids = [await ada.create('One'), await ada.create('Two')];
    await ada.patch(ids[0], { status: 'done' });
    await ada.sync();

    // Someone new clones the repo and turns sync on: nothing local at all.
    const linus = await teammate('linus');
    await linus.sync();
    expect((await linus.get(ids[0]))?.meta.title).toBe('One');
    expect((await linus.get(ids[1]))?.meta.title).toBe('Two');
    expect((await linus.get(ids[0]))?.meta.status).toBe(
      (await ada.get(ids[0]))?.meta.status
    );
  });

  it('while the remote is unreachable, work goes on and waits to be sent', async () => {
    const ada = await teammate(
      'ada',
      join(tmpdir(), 'dispatch-no-such-remote-x', 'r.git')
    );
    const id = await ada.create('Written offline');
    const status = (await ada.sync()).body as {
      lastError: string | null;
      pending: number;
    };
    expect(status.lastError).not.toBeNull();
    // The change is committed to this replica's own log, ready to go.
    expect(status.pending).toBe(0);
    expect((await ada.get(id))?.meta.title).toBe('Written offline');
  });

  it('reports itself off when it is off', async () => {
    const root = tempDir('dispatch-sync-off-');
    runGitSync(root, ['init', '-q', '-b', 'main']);
    const handle = await startServer({
      rootDir: root,
      port: 0,
      webDistDir: null,
      storeBackend: 'sqlite',
    });
    handles.push(handle);
    const res = await rawFetch(
      `http://127.0.0.1:${handle.port}/api/board-sync`,
      {
        headers: { authorization: `Bearer ${handle.tokens.agentToken}` },
      }
    );
    expect(await res.json()).toEqual({ enabled: false });
  });

  it('leaves the file backend syncer’s own status route alone', async () => {
    // /api/sync predates this and the app's status strip reads it; board
    // sync answering there instead would blank that strip.
    const ada = await teammate('ada');
    const res = await ada.api('/api/sync');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('replica');
  });

  it('with nobody pressing anything, a teammate’s board updates on its own', async () => {
    // The path people actually use: an edit is pushed shortly after it is
    // made, the other daemon pulls on its interval, and its clients hear
    // task.changed and refetch — no sync command anywhere.
    const ada = await teammate('ada', remote, 5);
    const grace = await teammate('grace', remote, 5);
    const events: string[] = [];
    const ws = new WebSocket(
      `ws://127.0.0.1:${grace.handle.port}/ws?token=${grace.handle.tokens.agentToken}`
    );
    ws.onmessage = (m) =>
      events.push((JSON.parse(String(m.data)) as { type: string }).type);
    await new Promise((resolve) => (ws.onopen = resolve));

    const id = await ada.create('Arrives by itself');
    let seen = null;
    for (let i = 0; i < 60 && seen === null; i++) {
      await Bun.sleep(500);
      seen = await grace.get(id);
    }
    ws.close();
    expect(seen?.meta.title).toBe('Arrives by itself');
    expect(events).toContain('task.changed');
  }, 40_000);
});

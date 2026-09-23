import { TaskStore } from '@dispatch/core';
import type { ActorContext, TaskComment, TaskDoc } from '@dispatch/core';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addComment } from '../src/api/comments.js';
import { EventBus } from '../src/events.js';
import type { ServerEvent } from '../src/events.js';
import type { ServerHandle } from '../src/index.js';
import { startServer } from '../src/index.js';
import { runGitSync } from './orchestrator/helpers.js';
import { useTestAuth } from './testAuth.js';

function json<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

function initDispatchGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-comments-api-'));
  runGitSync(dir, ['init', '-b', 'main']);
  runGitSync(dir, ['config', 'user.email', 'test@example.com']);
  runGitSync(dir, ['config', 'user.name', 'Test']);
  writeFileSync(join(dir, 'README.md'), '# test repo\n');
  runGitSync(dir, ['add', '-A']);
  runGitSync(dir, ['commit', '-m', 'initial commit']);
  return dir;
}

let root: string;
let fakeHome: string;
let handle: ServerHandle;
let baseUrl: string;
let taskId: string;
const originalDispatchHome = process.env.DISPATCH_HOME;

beforeEach(async () => {
  // startServer hydrates the merge queue, which writes run state under
  // DISPATCH_HOME — left unset it lands in the real home, one dir per test.
  fakeHome = mkdtempSync(join(tmpdir(), 'dispatch-home-'));
  process.env.DISPATCH_HOME = fakeHome;
  root = initDispatchGitRepo();
  TaskStore.init(root);
  handle = await startServer({
    rootDir: root,
    port: 0,
    writeDaemonFile: false,
  });
  useTestAuth(handle);
  baseUrl = `http://127.0.0.1:${handle.port}`;
  const taskRes = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'store the linear reference' }),
  });
  taskId = (await json<{ meta: { id: string } }>(taskRes)).meta.id;
});

afterEach(async () => {
  await handle.stop();
  if (originalDispatchHome === undefined) delete process.env.DISPATCH_HOME;
  else process.env.DISPATCH_HOME = originalDispatchHome;
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

function send(path: string, method: string, value?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}

describe('/api/tasks/:id/comments', () => {
  it('adds, lists, edits and deletes a thread', async () => {
    const path = `/api/tasks/${taskId}/comments`;
    const first = await json<TaskComment>(
      await send(path, 'POST', { body: 'Looks right?' })
    );
    expect(first.taskId).toBe(taskId);
    expect(first.author.startsWith('human')).toBe(true);
    expect(first.parentId).toBeNull();

    const reply = await send(path, 'POST', {
      body: 'Yes',
      parentId: first.id,
      author: 'human:ada',
      external: 'linear:c1',
      created: '2026-01-01T00:00:00.000Z',
    });
    expect(reply.status).toBe(201);
    const replied = await json<TaskComment>(reply);
    expect(replied.author).toBe('human:ada');
    expect(replied.external).toBe('linear:c1');

    const listed = await json<TaskComment[]>(await send(path, 'GET'));
    // The imported reply's `created` predates the first, so it sorts first.
    expect(listed.map((c) => c.id)).toEqual([replied.id, first.id]);

    const edited = await json<TaskComment>(
      await send(`${path}/${first.id}`, 'PATCH', { body: 'Looks right.' })
    );
    expect(edited.body).toBe('Looks right.');

    const removed = await json<{ removed: string[] }>(
      await send(`${path}/${first.id}`, 'DELETE')
    );
    expect(removed.removed.sort()).toEqual([first.id, replied.id].sort());
    expect(await json<TaskComment[]>(await send(path, 'GET'))).toEqual([]);
  });

  it('validates input and 404s unknown tasks and comments', async () => {
    const path = `/api/tasks/${taskId}/comments`;
    expect((await send(path, 'POST', { body: '  ' })).status).toBe(400);
    expect(
      (await send(path, 'POST', { body: 'x', parentId: 'c-00000000' })).status
    ).toBe(400);
    expect((await send('/api/tasks/t-ffffff/comments', 'GET')).status).toBe(
      404
    );
    expect((await send(`${path}/c-00000000`, 'DELETE')).status).toBe(404);
    expect(
      (await send(`${path}/c-00000000`, 'PATCH', { body: 'x' })).status
    ).toBe(404);
  });

  it('stamps new tasks with their creator', async () => {
    const doc = await json<TaskDoc>(await send(`/api/tasks/${taskId}`, 'GET'));
    expect(doc.meta.creator).not.toBeNull();
  });

  it('broadcasts comment.changed, not task.changed', async () => {
    const events = new EventBus();
    const seen: ServerEvent[] = [];
    events.subscribe((event) => seen.push(event));
    const store = new TaskStore(root);
    const res = await addComment(
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'hi', author: 'human:wyat' }),
      }),
      {
        rootDir: root,
        store,
        events,
        // Unused: the request names its author.
        actorContext: undefined as unknown as ActorContext,
      },
      taskId
    );
    const comment = await json<TaskComment>(res);
    expect(seen).toEqual([
      { type: 'comment.changed', taskId, commentIds: [comment.id] },
    ]);
  });
});

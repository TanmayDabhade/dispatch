import type { NormalizedEntry } from '@dispatch/client';
import { describe, expect, test } from 'bun:test';

import {
  runStepFromEntry,
  RunStepStore,
  shellStep,
  shortPath,
  withLiveStep,
} from './runStep';

const RUN = 'r-abc123';
const WORKTREE = `/Users/me/.dispatch/worktrees/5f3a/${RUN}`;

function tool(toolName: string, toolInput: unknown): NormalizedEntry {
  return {
    ts: '2026-09-24T00:00:00.000Z',
    kind: 'tool',
    toolName,
    toolInput,
    status: 'running',
  };
}

function step(entry: NormalizedEntry): string | null {
  return runStepFromEntry(entry, RUN);
}

describe('runStepFromEntry', () => {
  test('file tools name the file relative to the run’s worktree', () => {
    expect(step(tool('Edit', { file_path: `${WORKTREE}/src/foo.ts` }))).toBe(
      'Editing src/foo.ts'
    );
    expect(step(tool('Write', { file_path: `${WORKTREE}/docs/a.md` }))).toBe(
      'Writing docs/a.md'
    );
    expect(step(tool('Read', { file_path: '/etc/hosts' }))).toBe(
      'Reading etc/hosts'
    );
    expect(
      step(tool('codex.fileChange', { changes: [{ path: 'lib/x.rs' }] }))
    ).toBe('Editing lib/x.rs');
  });

  test('shell commands read as the work they do', () => {
    expect(
      step(
        tool('Bash', { command: `cd ${WORKTREE} && bun test src/a.test.ts` })
      )
    ).toBe('Running tests');
    expect(
      step(tool('codex.commandExecution', { command: 'pnpm tsc -b' }))
    ).toBe('Typechecking');
    expect(
      step(tool('Bash', { command: 'ls -la', description: 'List the files' }))
    ).toBe('List the files');
  });

  test('other tools, thinking and sub-agents', () => {
    expect(step(tool('Grep', { pattern: 'useRunStep' }))).toBe(
      'Searching for useRunStep'
    );
    expect(step(tool('mcp__dispatch__task_save', {}))).toBe('Using task_save');
    expect(step(tool('mcp.linear.save_issue', {}))).toBe('Using save_issue');
    expect(step({ ts: '', kind: 'thinking', text: 'hmm' })).toBe('Thinking');
    expect(
      step({
        ts: '',
        kind: 'agent',
        agent: {
          id: 'a1',
          phase: 'started',
          status: 'running',
          label: 'Map the store',
        },
      })
    ).toBe('Sub-agent: Map the store');
  });

  test('prose, usage and a sub-agent’s own tool calls say nothing new', () => {
    expect(step({ ts: '', kind: 'assistant', text: 'Done.' })).toBeNull();
    expect(step({ ts: '', kind: 'usage', text: '{"costUsd":1}' })).toBeNull();
    expect(
      step({ ...tool('Edit', { file_path: 'a.ts' }), parentToolUseId: 'tu-1' })
    ).toBeNull();
  });
});

describe('shellStep', () => {
  test('recognises the common kinds of work', () => {
    expect(shellStep('moon run desktop:test')).toBe('Running tests');
    expect(shellStep('npx vitest run')).toBe('Running tests');
    expect(shellStep('pnpm run lint')).toBe('Linting');
    expect(shellStep('moon run root:format')).toBe('Formatting');
    expect(shellStep('moon run core:build')).toBe('Building');
    expect(shellStep('pnpm install')).toBe('Installing dependencies');
    expect(shellStep('git commit -m "x"')).toBe('Committing');
    expect(shellStep('git status --short')).toBe('Running git status');
  });

  test('falls back to the program past cd and env prefixes', () => {
    expect(shellStep('cd /tmp && FOO=1 /usr/bin/rg needle')).toBe('Running rg');
    // A path segment named test is not a test run.
    expect(shellStep('cat src/test/fixture.json')).toBe('Running cat');
  });
});

test('shortPath keeps a relative path and trims a foreign absolute one', () => {
  expect(shortPath('src/a.ts', RUN)).toBe('src/a.ts');
  expect(shortPath('/a/b/c/d/e.ts', RUN)).toBe('c/d/e.ts');
});

test('withLiveStep replaces "Working", extends the named phases, keeps the rest', () => {
  expect(withLiveStep('Working', 'Editing a.ts')).toBe('Editing a.ts');
  expect(withLiveStep('Reviewing', 'Reading a.ts')).toBe(
    'Reviewing · Reading a.ts'
  );
  expect(withLiveStep('Waiting on approval', 'Editing a.ts')).toBe(
    'Waiting on approval'
  );
  expect(withLiveStep('Working', null)).toBe('Working');
});

// A hand-cranked clock: `advance` runs whatever the store scheduled once its time comes.
function fakeScheduler() {
  let now = 0;
  const queue: { at: number; run: () => void }[] = [];
  return {
    now: () => now,
    schedule: (run: () => void, ms: number) => {
      queue.push({ at: now + ms, run });
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (next === undefined || next.at > until) break;
        queue.shift();
        now = next.at;
        next.run();
      }
      now = until;
    },
  };
}

describe('RunStepStore', () => {
  test('a chatty run publishes at most 4 times a second, always ending on its newest step', () => {
    const clock = fakeScheduler();
    const store = new RunStepStore(clock);
    let publishes = 0;
    store.subscribe(() => publishes++);
    // 200 entries a second for 2 seconds: a step every 5ms.
    for (let i = 0; i < 400; i++) {
      store.record(RUN, tool('Edit', { file_path: `f${i}.ts` }));
      clock.advance(5);
    }
    clock.advance(250);
    expect(publishes).toBeLessThanOrEqual(9);
    expect(publishes).toBeGreaterThanOrEqual(7);
    expect(store.get(RUN)).toBe('Editing f399.ts');
  });

  test('publishes the first step at once and skips a repeat', () => {
    const clock = fakeScheduler();
    const store = new RunStepStore(clock);
    let publishes = 0;
    store.subscribe(() => publishes++);
    store.record(RUN, { ts: '', kind: 'thinking' });
    clock.advance(0);
    expect(store.get(RUN)).toBe('Thinking');
    expect(publishes).toBe(1);
    clock.advance(1000);
    store.record(RUN, { ts: '', kind: 'thinking' });
    clock.advance(0);
    expect(publishes).toBe(1);
  });

  test('entries without a step never schedule a publish', () => {
    const clock = fakeScheduler();
    const store = new RunStepStore(clock);
    let publishes = 0;
    store.subscribe(() => publishes++);
    store.record(RUN, { ts: '', kind: 'assistant', text: 'ok' });
    clock.advance(1000);
    expect(publishes).toBe(0);
    expect(store.get(RUN)).toBeNull();
  });

  test('an unsubscribed listener hears nothing', () => {
    const clock = fakeScheduler();
    const store = new RunStepStore(clock);
    let publishes = 0;
    const unsubscribe = store.subscribe(() => publishes++);
    unsubscribe();
    store.record(RUN, { ts: '', kind: 'thinking' });
    clock.advance(0);
    expect(publishes).toBe(0);
  });
});

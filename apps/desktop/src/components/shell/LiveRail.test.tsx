import type { OverseerAction, OverseerRecord, RunMeta } from '@dispatch/client';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'bun:test';

import type { OverseerSession } from '../../hooks/useOverseerSession';
import { LiveRail } from './LiveRail';

function run(over: Partial<RunMeta> = {}): RunMeta {
  return {
    id: 'r-1',
    taskId: 't-1',
    taskTitle: 'Do the thing',
    executor: 'claude',
    state: 'running',
    branch: 'dispatch/t-1',
    baseBranch: 'main',
    worktreePath: '/tmp/wt',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...over,
  } as RunMeta;
}

// The same record/action fixtures overseerThread.test.ts builds — the section reads the
// identical OverseerSession seam OverseerView uses, so a fake session with a canned record
// is the whole test backend.
function overseerRecord(over: Partial<OverseerRecord> = {}): OverseerRecord {
  return {
    id: 'w-1',
    prompt: 'what is going on?',
    backendName: 'fake',
    state: 'ready',
    messages: [],
    pendingActions: [],
    pendingApprovals: [],
    undeliveredDecisions: [],
    createdAt: '2026-08-10T00:00:00Z',
    updatedAt: '2026-08-10T00:00:05Z',
    ...over,
  };
}

function overseerAction(over: Partial<OverseerAction> = {}): OverseerAction {
  return {
    id: 'act-1',
    tool: 'cancel_run',
    input: { runId: 'r-1' },
    summary: 'Cancel run r-1',
    createdAt: '2026-08-10T00:00:02Z',
    status: 'pending',
    ...over,
  };
}

function overseerSession(over: Partial<OverseerSession> = {}): OverseerSession {
  return {
    conversationId: null,
    record: undefined,
    recordError: null,
    submit: () => Promise.resolve(),
    sending: false,
    sendError: null,
    confirmAction: () => Promise.resolve(),
    decidingActionId: null,
    decideApproval: () => Promise.resolve(),
    decidingRequestId: null,
    decideError: null,
    model: 'claude-opus-5',
    setModel: () => {},
    reset: () => {},
    draft: '',
    setDraft: () => {},
    ...over,
  };
}

function railProps(over: Partial<Parameters<typeof LiveRail>[0]> = {}) {
  return {
    runs: [],
    overseer: overseerSession(),
    onOpenTask: () => {},
    onOpenOverseer: () => {},
    ...over,
  };
}

test('renders the idle copy with no runs', () => {
  render(<LiveRail {...railProps()} />);
  expect(screen.getByText('No agents running.')).toBeDefined();
  expect(screen.queryByRole('button')).toBeNull();
});

test('renders a 28px row per live run; clicking opens its task on Chat', () => {
  const calls: unknown[] = [];
  render(
    <LiveRail
      {...railProps({
        runs: [run()],
        onOpenTask: (taskId, tab, runId) => {
          calls.push([taskId, tab, runId]);
        },
      })}
    />
  );
  const row = screen.getByRole('button', { name: 'Do the thing' });
  expect(row.className).toContain('h-7');
  fireEvent.click(row);
  expect(calls).toEqual([['t-1', 'chat', 'r-1']]);
});

test('the section has no tabs and no attention strip any more', () => {
  render(<LiveRail {...railProps({ runs: [run()] })} />);
  expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.queryByText(/waiting on you/)).toBeNull();
  // No mono meta, no kind word on screen — the kind lives in the accessible name.
  expect(screen.queryByText('agent')).toBeNull();
});

test('a review run carries its kind in the accessible name', () => {
  render(<LiveRail {...railProps({ runs: [run({ kind: 'review' })] })} />);
  expect(
    screen.getByRole('button', { name: 'Do the thing (review)' })
  ).toBeDefined();
});

test('a running overseer turn is a row that opens the Overseer page', () => {
  let opened = 0;
  const overseer = overseerSession({
    conversationId: 'w-1',
    record: overseerRecord({ state: 'running' }),
  });
  render(
    <LiveRail
      {...railProps({
        runs: [run()],
        overseer,
        onOpenOverseer: () => opened++,
      })}
    />
  );
  fireEvent.click(screen.getByText('what is going on?'));
  expect(opened).toBe(1);
});

test('a settled overseer conversation adds no row', () => {
  const overseer = overseerSession({
    conversationId: 'w-1',
    record: overseerRecord({ state: 'ready' }),
  });
  render(<LiveRail {...railProps({ overseer })} />);
  expect(screen.getByText('No agents running.')).toBeDefined();
});

// A failed record fetch (daemon restart → the stale id 404s, and the query has
// retry: false) leaves record undefined forever. That is a broken conversation, not an
// agent at work — no phantom running row.
test('a failed overseer record fetch does not fake a running row', () => {
  const overseer = overseerSession({
    conversationId: 'w-1',
    record: undefined,
    recordError: 'overseer conversation w-1 not found (404)',
  });
  render(<LiveRail {...railProps({ overseer })} />);
  expect(screen.getByText('No agents running.')).toBeDefined();
});

// A settled turn holding a queued mutation is state 'ready' — idle — but the section must
// not go quiet while an approval is stranded on the human.
test('a queued approval keeps a waiting row named by the action', () => {
  const overseer = overseerSession({
    conversationId: 'w-1',
    record: overseerRecord({
      state: 'ready',
      pendingActions: [overseerAction()],
    }),
  });
  render(<LiveRail {...railProps({ overseer })} />);
  expect(screen.queryByText('No agents running.')).toBeNull();
  // The row names the thing that is actually waiting — the queued action — not the
  // conversation's opening question from possibly hours earlier.
  expect(screen.getByText('Cancel run r-1')).toBeDefined();
  expect(screen.queryByText('what is going on?')).toBeNull();
});

test('a transient refetch error mid-turn keeps the running row', () => {
  const overseer = overseerSession({
    conversationId: 'w-1',
    record: overseerRecord({ state: 'running' }),
    recordError: 'network blip',
  });
  render(<LiveRail {...railProps({ overseer })} />);
  expect(screen.getByText('what is going on?')).toBeDefined();
});

test('a parked tool call names the waiting row', () => {
  const overseer = overseerSession({
    conversationId: 'w-1',
    record: overseerRecord({
      state: 'running',
      pendingApprovals: [
        {
          requestId: 'req-1',
          toolName: 'Bash',
          input: { command: 'git status' },
          summary: 'Bash: git status',
          requestedAt: '2026-08-10T00:00:01Z',
        },
      ],
    }),
  });
  render(<LiveRail {...railProps({ overseer })} />);
  expect(screen.getByText('Bash: git status')).toBeDefined();
});

test('a live run that fanned out shows its running/total sub-agent count', () => {
  render(
    <LiveRail
      {...railProps({
        runs: [
          run({
            subagents: {
              total: 12,
              running: 5,
              done: 7,
              failed: 0,
              stopped: 0,
            },
          }),
        ],
      })}
    />
  );
  expect(screen.getByLabelText('5 of 12 sub-agents running').textContent).toBe(
    '5/12'
  );
});

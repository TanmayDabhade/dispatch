import type { RunQuestion } from '@dispatch/client';
import { SquareTerminal } from 'lucide-react';

import { useRunDetail } from '../../../hooks/useRunData';
import { useScopeRequest } from '../../../hooks/useScopeRequest';
import { deriveStopControl, isTerminalRunState } from '../../../lib/runState';
import { RunLogView } from '../../runs/RunLogView';
import { TabSkeleton } from '../TabSkeleton';
import type { TaskPageModel } from './pageModel';
import { FilesTouched, RunStrip } from './RunStrip';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/chrome';

// Shared so a run with no open questions keeps one prop identity across renders.
const NO_QUESTIONS: RunQuestion[] = [];

/**
 * Run mode — an agent at work: the run's vitals (state, model, a ticking clock, spend,
 * turns) with Stop and Cancel while it is live, the files it has touched, then its
 * transcript streaming in with approvals, questions and scope requests inline, and the
 * message box at the foot to steer it (or, once it has finished, to request changes).
 */
export function RunMode({ page }: { page: TaskPageModel }) {
  const { project } = page;
  const run = page.selectedRun;
  const runId = run?.id ?? null;
  const detail = useRunDetail(project.client, project.port, runId);
  const scopeRequestId =
    runId === null
      ? undefined
      : project.pendingScopeRequests.get(runId)?.requestId;
  const { request: scopeRequest } = useScopeRequest(
    project.client,
    project.port,
    runId ?? undefined,
    scopeRequestId
  );

  if (run === undefined) {
    return (
      <EmptyState
        icon={SquareTerminal}
        heading="No agent has worked this yet"
        description="Dispatch it from the spec, and its run streams in here."
        className="h-full justify-center"
        primary={{ label: 'Open spec', onClick: () => page.selectMode('spec') }}
      />
    );
  }

  // The detail carries the freshest meta once loaded; the run list's is instant.
  const meta = detail?.meta.id === run.id ? detail.meta : run;
  const terminal = isTerminalRunState(meta.state);
  const stop = deriveStopControl(meta);

  return (
    <div data-slot="run-mode" className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-col gap-1.5">
        <RunStrip
          run={meta}
          runs={page.runs}
          onSelectRun={page.selectRun}
          actions={
            stop.showButtons ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={stop.stopDisabled}
                  onClick={() => void project.handleStopRun(meta.id)}
                >
                  {stop.stopLabel}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hover:text-state-failed"
                  onClick={() => void project.handleCancelRun(meta.id)}
                >
                  Cancel
                </Button>
              </>
            ) : terminal && meta.state === 'finished' ? (
              <Button size="sm" onClick={() => page.selectMode('review')}>
                Review
              </Button>
            ) : undefined
          }
        />
        <FilesTouched files={meta.claims ?? []} />
      </div>
      {detail === undefined || detail.meta.id !== run.id ? (
        <TabSkeleton />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <RunLogView
            meta={detail.meta}
            entries={detail.entries}
            pendingApproval={project.pendingApprovals.get(run.id) ?? null}
            onApprove={(requestId, allow, opts) =>
              project.handleApprove(run.id, requestId, allow, opts)
            }
            onSendMessage={(text) => project.handleSendMessage(run.id, text)}
            openQuestions={
              // A dropped socket must not leave a dead run still asking.
              terminal
                ? NO_QUESTIONS
                : (project.openQuestions.get(run.id) ?? NO_QUESTIONS)
            }
            onAnswerQuestion={(questionId, answer) =>
              project.handleAnswerQuestion(run.id, questionId, answer)
            }
            pendingScopeRequest={terminal ? null : scopeRequest}
            onDecideScopeRequest={(granted) =>
              scopeRequestId === undefined
                ? Promise.resolve()
                : project.handleDecideScopeRequest(
                    run.id,
                    scopeRequestId,
                    granted
                  )
            }
            scopeDecide={project.scopeDecide}
            onRestartDaemon={project.handleRestartDaemon}
            onRequestChanges={(text) =>
              project.handleRequestChanges(run.id, text)
            }
          />
        </div>
      )}
    </div>
  );
}

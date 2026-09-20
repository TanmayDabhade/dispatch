import type { RunMeta } from '@dispatch/client';

import { subagentSummaryLabel } from '../../../lib/subagentSummary';
import { formatShortDate } from '../../../lib/taskDates';
import { RunStatePill } from '../../runs/RunStatePill';
import { MainSection } from '../detail/MainSection';
import { ListRow } from '@/ui/ai/list-row';

/** `2 agents · $0.42` — a run's fan-out and spend as one muted phrase, or `null` when there
 * is nothing to say. */
function sessionMeta(run: RunMeta): string | null {
  const parts: string[] = [];
  const agents = subagentSummaryLabel(run.subagents);
  if (agents !== null) parts.push(agents);
  if (run.costUsd !== undefined) parts.push(`$${run.costUsd.toFixed(2)}`);
  return parts.length === 0 ? null : parts.join(' · ');
}

// Every agent session this task has had, newest first, as borderless 36px rows: the run id
// in sans, the run-state pill, `2 agents · $0.42`, and the day it last moved. Clicking a
// row opens that session's log/review.
export function SessionsBlock({
  runs,
  onOpenSession,
}: {
  runs: RunMeta[];
  onOpenSession: (runId: string) => void;
}) {
  const sorted = [...runs].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
  return (
    <MainSection
      title="Sessions"
      trailing={
        runs.length > 0 ? (
          <span className="text-muted-foreground font-book text-[12px] tabular-nums">
            {runs.length}
          </span>
        ) : undefined
      }
    >
      {sorted.length === 0 ? (
        <p className="text-muted-foreground font-book px-3 text-[12px]">
          No agent has worked this task yet.
        </p>
      ) : (
        <div data-slot="sessions-block" className="-mx-3 flex flex-col">
          {sorted.map((run) => {
            const meta = sessionMeta(run);
            return (
              <ListRow
                key={run.id}
                data-run-id={run.id}
                id={run.id}
                title={<RunStatePill meta={run} />}
                trailing={
                  meta !== null ? (
                    <span className="text-muted-foreground font-book text-[12px] tabular-nums">
                      {meta}
                    </span>
                  ) : undefined
                }
                date={formatShortDate(run.updatedAt)}
                onClick={() => onOpenSession(run.id)}
              />
            );
          })}
        </div>
      )}
    </MainSection>
  );
}

import type { BranchEntry, BranchEntryStatus } from '@dispatch/client';
import { Bot, Check, GitBranch, Sparkles } from 'lucide-react';
import { useMemo } from 'react';

import { GitSummary } from './GitSummary';
import { formatRelativeTimeFromIso } from '@/lib/format';
import type { BranchRowVM } from '@/lib/gitBranchRows';
import { canActOnBranchRow } from '@/lib/gitBranchRows';
import type { GitFilter } from '@/lib/gitHealth';
import { computeGitHealth } from '@/lib/gitHealth';
import { IconButton } from '@/ui/ai/icon-button';
import { ListRow } from '@/ui/ai/list-row';
import { LabelPill, PillButton } from '@/ui/ai/pill';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';

// A worktree's status as a label pill: the dot carries the run-state colour, the text
// stays on the neutral chip surface.
const STATUS_CHIP: Record<BranchEntryStatus, { label: string; color: string }> =
  {
    active: { label: 'Live', color: 'var(--state-working-fg)' },
    reviewable: { label: 'Unreviewed', color: 'var(--state-review-fg)' },
    leftover: { label: 'Cleanup failed', color: 'var(--state-failed-fg)' },
    orphan: { label: 'Orphan', color: 'var(--text-muted)' },
    epic: { label: 'Epic', color: 'var(--state-landing-fg)' },
  };

interface BranchesPanelProps {
  rows: BranchRowVM[];
  /** Always the full unfiltered set, so GitSummary's health chips never change as the list
   * itself is filtered. */
  worktrees: BranchEntry[];
  selectedIndex: number;
  filter: GitFilter;
  onFilterChange: (filter: GitFilter) => void;
  reclaiming: boolean;
  onReclaimMerged: () => void;
  onDeleteAllMergedOrphans: () => void;
  onSelectIndex: (index: number) => void;
  onOpenRun: (runId: string) => void;
  onDispatchAgent: (branch: string) => void;
}

/** Panel 3: every branch git knows about, dispatch ones badged with their run/task, plus
 * dispatch's worktree health chips and reclaim/bulk-cleanup actions. */
export function BranchesPanel({
  rows,
  worktrees,
  selectedIndex,
  filter,
  onFilterChange,
  reclaiming,
  onReclaimMerged,
  onDeleteAllMergedOrphans,
  onSelectIndex,
  onOpenRun,
  onDispatchAgent,
}: BranchesPanelProps) {
  const health = useMemo(() => computeGitHealth(worktrees), [worktrees]);

  return (
    <div className="flex flex-col gap-2 px-1 py-2">
      <GitSummary
        branches={worktrees}
        health={health}
        reclaiming={reclaiming}
        onReclaimMerged={onReclaimMerged}
        active={filter}
        onFocus={onFilterChange}
      />
      {health.mergedOrphans.length > 0 && (
        <PillButton
          className="ml-2 self-start"
          onClick={onDeleteAllMergedOrphans}
        >
          Delete {health.mergedOrphans.length} merged orphan
          {health.mergedOrphans.length === 1 ? '' : 's'}
        </PillButton>
      )}
      {rows.length === 0 ? (
        <div className="text-muted-foreground font-book px-3 py-2 text-[13px]">
          No branches match this filter.
        </div>
      ) : (
        <div className="flex flex-col" role="list" aria-label="Branches">
          {rows.map((row, index) => {
            const chip =
              row.worktree !== undefined
                ? STATUS_CHIP[row.worktree.status]
                : null;
            const canAct = canActOnBranchRow(row);
            return (
              <ListRow
                key={row.name}
                data-git-selected={index === selectedIndex ? 'true' : undefined}
                onClick={() => onSelectIndex(index)}
                focused={index === selectedIndex}
                role="listitem"
                leading={
                  row.isCurrent ? (
                    <Check className="text-state-review" />
                  ) : (
                    <GitBranch />
                  )
                }
                title={row.name}
                crumb={row.taskTitle ?? row.subject}
                trailing={
                  <>
                    {chip !== null && (
                      <LabelPill color={chip.color}>{chip.label}</LabelPill>
                    )}
                    {row.worktree?.dirty === true && (
                      <LabelPill
                        color="var(--state-waiting-fg)"
                        title="Uncommitted changes in this worktree"
                      >
                        Uncommitted
                      </LabelPill>
                    )}
                    {row.worktree?.status === 'epic' &&
                      (row.worktree.behindBase ?? 0) > 0 && (
                        <LabelPill
                          color="var(--state-waiting-fg)"
                          title={`This epic branch is missing ${row.worktree.behindBase} commit(s) from ${row.worktree.baseBranch ?? 'its base'} — merge it in to update (dispatch never rewrites an epic branch on its own)`}
                        >
                          {row.worktree.behindBase} behind{' '}
                          {row.worktree.baseBranch ?? 'base'}
                        </LabelPill>
                      )}
                    {row.runId !== undefined && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenRun(row.runId);
                        }}
                        className="text-muted-foreground font-book text-[12px] underline-offset-2 hover:text-(--text-secondary) hover:underline"
                      >
                        {row.runId}
                      </button>
                    )}
                    <span className="text-muted-foreground font-book text-[12px] tabular-nums">
                      {row.shortSha}
                    </span>
                    {canAct && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <IconButton
                              label="Dispatch agent"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDispatchAgent(row.name);
                              }}
                            />
                          }
                        >
                          <Bot />
                        </TooltipTrigger>
                        <TooltipContent>
                          Start an agent working from this branch
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </>
                }
                date={formatRelativeTimeFromIso(row.date)}
              />
            );
          })}
        </div>
      )}
      {health.orphans.length > 0 && (
        <div className="text-muted-foreground font-book flex items-center gap-1.5 px-3 text-[12px]">
          <Sparkles className="size-3" />
          {health.orphans.length} orphaned worktree
          {health.orphans.length === 1 ? '' : 's'} — filter to “Orphaned” above
          to clean up.
        </div>
      )}
    </div>
  );
}

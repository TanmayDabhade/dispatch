import type { BranchEntry } from '@dispatch/client';
import { useMemo } from 'react';

import { formatBytes } from '../../lib/formatBytes';
import type { GitFilter, GitHealth } from '../../lib/gitHealth';
import { computeGitHealth } from '../../lib/gitHealth';
import { cn } from '@/lib/utils';
import {
  VIEW_TAB_ACTIVE_CLASS,
  VIEW_TAB_CLASS,
  VIEW_TAB_INACTIVE_CLASS,
} from '@/ui/ai/page-header';
import { Button } from '@/ui/button';

interface GitSummaryProps {
  branches: BranchEntry[];
  /** Skips this component's own `computeGitHealth` pass when the caller already has one
   * (e.g. it also needs the same health data for its own rendering). */
  health?: GitHealth;
  /** Reclaims every worktree that is safe to reclaim, in one go. */
  onReclaimMerged: () => void;
  /** Filters the list below to one bucket, so a count is a way in and not a fact. */
  onFocus: (filter: GitFilter) => void;
  active: GitFilter;
  reclaiming?: boolean;
}

/** What git is costing you, above the list of branches. Every number is also a filter, so a
 *  count is a way into the rows behind it rather than a readout you then have to act on. */
export function GitSummary({
  branches,
  health: precomputedHealth,
  onReclaimMerged,
  onFocus,
  active,
  reclaiming = false,
}: GitSummaryProps) {
  const health = useMemo(
    () => precomputedHealth ?? computeGitHealth(branches),
    [precomputedHealth, branches]
  );

  return (
    <div className="flex flex-wrap items-center gap-1 px-2">
      <Stat
        label="Branches"
        value={String(health.branches)}
        filterValue="all"
        active={active === 'all'}
        onClick={() => onFocus('all')}
      />
      <Stat
        label="On disk"
        value={formatBytes(health.totalBytes)}
        hint={`${health.onDisk.length} worktree${health.onDisk.length === 1 ? '' : 's'}`}
      />
      <Stat
        label="Stale"
        value={String(health.stale.length)}
        hint={
          health.staleBytes > 0 ? formatBytes(health.staleBytes) : undefined
        }
        tone={health.stale.length > 0 ? 'warn' : undefined}
        filterValue={health.stale.length > 0 ? 'stale' : undefined}
        active={active === 'stale'}
        onClick={health.stale.length > 0 ? () => onFocus('stale') : undefined}
      />
      <Stat
        label="Orphaned"
        value={String(health.orphans.length)}
        tone={health.orphans.length > 0 ? 'bad' : undefined}
        filterValue={health.orphans.length > 0 ? 'orphans' : undefined}
        active={active === 'orphans'}
        onClick={
          health.orphans.length > 0 ? () => onFocus('orphans') : undefined
        }
      />
      <Stat
        label="Uncommitted"
        value={String(health.dirty)}
        tone={health.dirty > 0 ? 'warn' : undefined}
        filterValue={health.dirty > 0 ? 'dirty' : undefined}
        active={active === 'dirty'}
        onClick={health.dirty > 0 ? () => onFocus('dirty') : undefined}
      />
      <Stat
        label="Stacked"
        value={String(health.stacked.length)}
        filterValue={health.stacked.length > 0 ? 'stacked' : undefined}
        active={active === 'stacked'}
        onClick={
          health.stacked.length > 0 ? () => onFocus('stacked') : undefined
        }
      />

      <span className="flex-1" />

      {health.reclaimable.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={reclaiming}
          onClick={onReclaimMerged}
          title={`${formatBytes(health.reclaimableBytes)} in ${health.reclaimable.length} merged worktree${health.reclaimable.length === 1 ? '' : 's'}`}
          // `disabled:pointer-events-auto` undoes Button's own suppression — the native
          // `title` (byte/worktree count) is the only place that detail shows, and a
          // pointer-events-blocked disabled button can't receive the hover that shows it.
          className="disabled:pointer-events-auto"
        >
          {reclaiming
            ? 'Reclaiming…'
            : `Reclaim ${formatBytes(health.reclaimableBytes)}`}
        </Button>
      )}
    </div>
  );
}

/** One health count as a toggle chip — the Display popover's on/off chip grammar: the
 * active filter lifts to the active surface, the rest read as muted text. */
function Stat({
  label,
  value,
  hint,
  tone,
  active = false,
  onClick,
  filterValue,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'warn' | 'bad';
  active?: boolean;
  onClick?: () => void;
  /** The `GitFilter` this chip toggles to — undefined keeps it a plain, non-interactive
   * readout (see the comment below). */
  filterValue?: GitFilter;
}) {
  const body = (
    <>
      <span
        className={cn(
          'tabular-nums',
          tone === 'warn' && 'text-state-waiting',
          tone === 'bad' && 'text-state-failed'
        )}
      >
        {value}
      </span>
      <span className="font-book">{label}</span>
    </>
  );

  // A count with nothing behind it is not a button. Rendering it as one would
  // promise a filter that shows an empty list.
  if (onClick === undefined || filterValue === undefined) {
    return (
      <span
        className={cn(VIEW_TAB_CLASS, 'text-muted-foreground bg-transparent')}
        title={hint}
      >
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      data-filter={filterValue}
      onClick={onClick}
      title={hint}
      className={cn(
        VIEW_TAB_CLASS,
        active ? VIEW_TAB_ACTIVE_CLASS : VIEW_TAB_INACTIVE_CLASS
      )}
    >
      {body}
    </button>
  );
}

import type { EpicProgress } from '@dispatch/client';
import type { TaskDoc } from '@dispatch/core/browser';
import {
  AlertCircle,
  GitMerge,
  Milestone,
  Play,
  Square,
  Waypoints,
} from 'lucide-react';
import { useState } from 'react';

import {
  clampConcurrencyInput,
  concurrencyChoices,
  concurrencyLabel,
} from '../../lib/epicConcurrency';
import { rollupMilestoneStatus } from '../../lib/milestoneRollup';
import { EpicDagModal } from './EpicDagModal';
import { statusColor, StatusIcon } from './StatusIcon';
import { cn } from '@/lib/utils';
import { GroupHeader } from '@/ui/ai/group-header';
import { IconButton } from '@/ui/ai/icon-button';
import { LabelPill, PillButton, SelectPill } from '@/ui/ai/pill';
import { Alert, AlertDescription } from '@/ui/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';

interface EpicLaneHeaderProps {
  /** The epic this lane belongs to, or `null` for the catch-all "No epic" lane — which still
   * collapses and still shows its count, it just has nothing to dispatch or graph. */
  epic: TaskDoc | null;
  /** Lane title: the epic's own, `No epic`, or a bare parent id that resolves to no known epic. */
  title: string;
  /** How many cards the lane holds, collapsed or not — the one count that never moves, so
   * folding a lane away can't look like its work disappeared. */
  total: number;
  expanded: boolean;
  onToggle: () => void;
  /** `undefined` until this epic's progress fetch resolves — the controls still render, just
   * without the `◔ n/m` glyph. */
  progress: EpicProgress | undefined;
  /** `orchestrator.epicConcurrency` from the project config, the picker's starting value. */
  concurrencyDefault: number;
  /** This epic's children — the dependency-graph modal's input and the rolled-up status. */
  childTasks: TaskDoc[];
  /** Opens a task in the peek/detail dialog: the epic itself (its id chip) or one of its
   * children (from the graph modal). */
  onOpenTask: (taskId: string) => void;
  onWork: (epicId: string, concurrency: number) => Promise<void>;
  /** When given, Work asks for a confirmation preview instead of dispatching straight away. */
  onRequestWork?: (epicId: string) => void;
  onStop: (epicId: string) => Promise<void>;
  /** Lands the finished epic branch on the default base (one PR or one local merge, decided
   * server-side). Optional so a header rendered without land wiring stays valid; the Land
   * button only renders once every child is done/cancelled, replacing the then-useless Work
   * button. */
  onLand?: (epicId: string) => Promise<void>;
  /** A `+` on the right that presets the epic in the task creator. */
  onAdd?: () => void;
}

// The `◔ 3/7` progress glyph: an r=6 ring with a pie that fills as children land, at 12px.
function ProgressGlyph({ fraction }: { fraction: number }) {
  const circumference = 2 * Math.PI * 4;
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      className="size-3 shrink-0 text-(--text-secondary)"
    >
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
      <circle
        cx="7"
        cy="7"
        r="2"
        stroke="currentColor"
        strokeWidth="4"
        strokeDasharray={`${circumference * fraction} ${circumference}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

/**
 * One epic's lane header on the board: a 36px `GroupHeader` tinted by the epic's rolled-up
 * status (the same glyph vocabulary its cards use), the title as the collapse target, the
 * card count, then the epic-level controls — `◔ done/total`, a `N running` pill, the id
 * chip, the dependency-graph button, the concurrency picker and Work/Stop/Land as pills.
 *
 * Epics are containers here, not objects on the board: they are never dragged and never
 * occupy a status column. Each control stops propagation so using it never also toggles
 * the lane.
 */
export function EpicLaneHeader({
  epic,
  title,
  total,
  expanded,
  onToggle,
  progress,
  concurrencyDefault,
  childTasks,
  onOpenTask,
  onWork,
  onRequestWork,
  onStop,
  onLand,
  onAdd,
}: EpicLaneHeaderProps) {
  const [concurrency, setConcurrency] = useState(concurrencyDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  const active = progress?.active ?? false;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const doneCount =
    progress?.children.filter(
      (c) => c.status === 'landed' || c.status === 'dropped'
    ).length ?? 0;
  const totalCount = progress?.children.length ?? 0;
  const liveCount = progress?.liveRuns.length ?? 0;
  // Same "finished" rule the server's land validation applies (every child done or
  // cancelled) — the button still only *requests*; the server is the authority and 409s
  // with its reason into the error alert below.
  const landable =
    onLand !== undefined &&
    epic !== null &&
    !active &&
    totalCount > 0 &&
    doneCount === totalCount &&
    epic.meta.status !== 'landed';
  const rollup = epic !== null ? rollupMilestoneStatus(childTasks) : null;

  return (
    <>
      <GroupHeader
        tint={rollup !== null ? statusColor(rollup) : undefined}
        icon={
          rollup !== null ? (
            <StatusIcon status={rollup} />
          ) : (
            <Milestone className="text-muted-foreground" />
          )
        }
        name={
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="focus-visible:ring-ring inline-flex max-w-full cursor-pointer items-center rounded-[4px] text-left outline-none focus-visible:ring-2"
          >
            <span className="truncate">{title}</span>
          </button>
        }
        count={total}
        collapsed={!expanded}
        onToggle={onToggle}
        onAdd={onAdd}
        addLabel={`New task in ${title}`}
        className="mb-2"
        actions={
          epic !== null && (
            <>
              {totalCount > 0 && (
                <span
                  data-slot="epic-progress"
                  className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-(--text-secondary)"
                >
                  <ProgressGlyph fraction={doneCount / totalCount} />
                  {doneCount}/{totalCount}
                </span>
              )}
              {liveCount > 0 && (
                <LabelPill color="var(--state-working-fg)">
                  {liveCount} running
                </LabelPill>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    // The epic id as a 24px pill that opens the epic — a `Pill`'s look on a
                    // real button.
                    <PillButton
                      aria-label={`Open ${epic.meta.id}`}
                      onClick={() => onOpenTask(epic.meta.id)}
                      className="bg-surface-quaternary h-6 px-2"
                    />
                  }
                >
                  {epic.meta.id}
                </TooltipTrigger>
                <TooltipContent>Open epic</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <IconButton
                      label={`View dependency graph for ${epic.meta.id}`}
                      onClick={() => setShowGraph(true)}
                    />
                  }
                >
                  <Waypoints aria-hidden />
                </TooltipTrigger>
                <TooltipContent>View dependency graph</TooltipContent>
              </Tooltip>
              {!landable && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={active || busy}
                    render={
                      <SelectPill
                        aria-label={`Epic dispatch concurrency for ${epic.meta.id}`}
                      />
                    }
                  >
                    {concurrencyLabel(concurrency)}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[96px]">
                    {concurrencyChoices(concurrencyDefault).map((choice) => (
                      <DropdownMenuItem
                        key={choice}
                        data-selected={choice === concurrency || undefined}
                        onClick={() =>
                          setConcurrency(clampConcurrencyInput(String(choice)))
                        }
                      >
                        {concurrencyLabel(choice)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {active ? (
                <PillButton
                  disabled={busy}
                  onClick={() => void run(() => onStop(epic.meta.id))}
                >
                  <Square className="size-3" />
                  Stop
                </PillButton>
              ) : landable ? (
                <PillButton
                  disabled={busy}
                  onClick={() => void run(() => onLand(epic.meta.id))}
                >
                  <GitMerge className="size-3" />
                  Land
                </PillButton>
              ) : (
                <PillButton
                  disabled={busy}
                  onClick={() => {
                    if (onRequestWork !== undefined) {
                      onRequestWork(epic.meta.id);
                      return;
                    }
                    void run(() => onWork(epic.meta.id, concurrency));
                  }}
                >
                  <Play className="size-3" />
                  Work
                </PillButton>
              )}
            </>
          )
        }
      />

      {error !== null && (
        <Alert
          variant="destructive"
          className={cn(
            'bg-destructive/10 mb-2 flex items-center gap-1.5 rounded-control border-0 px-2 py-1 text-[12px] has-[>svg]:gap-x-1.5 [&>svg]:translate-y-0'
          )}
        >
          <AlertCircle className="size-3 shrink-0" />
          <AlertDescription className="truncate text-[12px]">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {epic !== null && (
        <EpicDagModal
          epic={showGraph ? epic : null}
          tasks={childTasks}
          onOpenTask={onOpenTask}
          onClose={() => setShowGraph(false)}
        />
      )}
    </>
  );
}

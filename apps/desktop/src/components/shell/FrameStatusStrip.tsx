import type { SyncStatus } from '@dispatch/client';
import { CircleHelp, History } from 'lucide-react';

import { formatUsd } from '../../lib/epicSession';
import { syncSummary, type SyncTone } from './SyncChip';
import { cn } from '@/lib/utils';
import { IconButton } from '@/ui/ai/icon-button';
import { Pill } from '@/ui/ai/pill';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';

// Spelled out because Tailwind cannot build class names at runtime.
const DOT_CLASS: Record<SyncTone, string> = {
  review: 'bg-state-review',
  waiting: 'bg-state-waiting',
  failed: 'bg-state-failed',
  blocked: 'bg-state-blocked',
  ready: 'bg-state-ready',
};

interface FrameStatusStripProps {
  /** `null` until the first `GET /api/sync` resolves — no pill yet. */
  syncStatus: SyncStatus | null;
  /** Flips `.dispatch/config.yml`'s `autoCommit` off — the pill's kill switch. */
  onDisableAutoCommit: () => void;
  /** Settled spend across today's runs, or `null` to show nothing. */
  spendToday: number | null;
  /** The live milestone fan-outs summed (App sums `data.liveEpicSessions`): how many
   * sessions are active or paused, their settled spend, and their ceilings added up —
   * `null` when none carries one. Absent or `live: 0` shows nothing. */
  ceilings?: LiveCeilings | null;
  onOpenShortcuts: () => void;
  onOpenOverseer: () => void;
  className?: string;
}

export interface LiveCeilings {
  live: number;
  settledUsd: number;
  ceilingUsd: number | null;
}

/** `2 milestones live · $41.20 of $120 ceilings`, or `… · $41.20 spent` when no live
 * session set a ceiling. */
export function liveCeilingsLabel(ceilings: LiveCeilings): string {
  const live = `${ceilings.live} milestone${ceilings.live === 1 ? '' : 's'} live`;
  const settled = formatUsd(ceilings.settledUsd);
  return ceilings.ceilingUsd === null
    ? `${live} · ${settled} spent`
    : `${live} · ${settled} of ${formatUsd(ceilings.ceilingUsd)} ceilings`;
}

/**
 * The 36px strip under the inset panel (Linear §1): `?` and the sync pill bottom-left of
 * the frame, today's spend, the live milestones' spend against their ceilings, and an
 * Overseer link bottom-right. Everything here is glanceable context, which is why it
 * sits on the frame rather than inside any view.
 */
export function FrameStatusStrip({
  syncStatus,
  onDisableAutoCommit,
  spendToday,
  ceilings,
  onOpenShortcuts,
  onOpenOverseer,
  className,
}: FrameStatusStripProps) {
  const sync = syncStatus !== null ? syncSummary(syncStatus) : null;
  const showToday = spendToday !== null && spendToday > 0;
  const showCeilings =
    ceilings !== undefined && ceilings !== null && ceilings.live > 0;
  return (
    <div
      data-slot="frame-status-strip"
      className={cn(
        'flex h-9 items-center gap-2 pr-3 pl-2 text-[11px]',
        className
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <IconButton label="Keyboard shortcuts" onClick={onOpenShortcuts} />
          }
        >
          <CircleHelp />
        </TooltipTrigger>
        <TooltipContent side="top">Keyboard shortcuts · ?</TooltipContent>
      </Tooltip>

      {sync !== null && (
        <Tooltip>
          {/* Focusable whenever there is a tooltip to reach, so the detail lines open on
              Tab as well as hover; the same lines are mirrored for screen readers. */}
          <TooltipTrigger
            render={
              <Pill
                data-slot="sync-pill"
                tabIndex={sync.detail.length > 0 ? 0 : undefined}
                className="focus-visible:ring-ring h-6 max-w-[22rem] cursor-default gap-1.5 text-[11px] outline-none focus-visible:ring-2"
              />
            }
          >
            <span
              aria-hidden
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                DOT_CLASS[sync.tone]
              )}
            />
            <span className="min-w-0 truncate">{sync.message}</span>
            {sync.detail.length > 0 && (
              <span className="sr-only">{sync.detail.join('. ')}</span>
            )}
            {sync.canDisableAutoCommit && (
              <button
                type="button"
                onClick={onDisableAutoCommit}
                className="text-muted-foreground shrink-0 underline decoration-dotted underline-offset-2 hover:text-(--text-secondary)"
              >
                Auto-commit off
              </button>
            )}
          </TooltipTrigger>
          {sync.detail.length > 0 && (
            <TooltipContent side="top" className="max-w-xs">
              {sync.detail.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </TooltipContent>
          )}
        </Tooltip>
      )}

      <div className="flex-1" />

      {/* Hidden entirely at zero rather than showing "$0.00": a running cost meter is only
          worth the pixels once there is a cost. */}
      {showToday && (
        <span className="text-muted-foreground font-book tabular-nums">
          {formatUsd(spendToday)} today
        </span>
      )}
      {/* Only while a fan-out is live: the strip is the one place the whole fleet's
          ceilings read at once, and an idle project has nothing to meter. */}
      {showCeilings && (
        <>
          {showToday && (
            <span aria-hidden className="text-muted-foreground font-book">
              ·
            </span>
          )}
          <span
            data-slot="live-ceilings"
            className="text-muted-foreground font-book tabular-nums"
          >
            {liveCeilingsLabel(ceilings)}
          </span>
        </>
      )}
      <button
        type="button"
        onClick={onOpenOverseer}
        className="text-muted-foreground rounded-control flex h-7 items-center gap-1.5 px-2 text-[12px] font-medium transition-colors duration-100 hover:text-(--text-secondary)"
      >
        <History className="size-3.5" />
        Overseer
      </button>
    </div>
  );
}

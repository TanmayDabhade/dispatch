import type { SyncStatus } from '@dispatch/client';
import { CircleHelp, History } from 'lucide-react';

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
  onOpenShortcuts: () => void;
  onOpenOverseer: () => void;
  className?: string;
}

/**
 * The 36px strip under the inset panel (Linear §1): `?` and the sync pill bottom-left of
 * the frame, today's spend and an Overseer link bottom-right. Everything here is
 * glanceable context, which is why it sits on the frame rather than inside any view.
 */
export function FrameStatusStrip({
  syncStatus,
  onDisableAutoCommit,
  spendToday,
  onOpenShortcuts,
  onOpenOverseer,
  className,
}: FrameStatusStripProps) {
  const sync = syncStatus !== null ? syncSummary(syncStatus) : null;
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
      {spendToday !== null && spendToday > 0 && (
        <span className="text-muted-foreground font-book tabular-nums">
          ${spendToday.toFixed(2)} today
        </span>
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

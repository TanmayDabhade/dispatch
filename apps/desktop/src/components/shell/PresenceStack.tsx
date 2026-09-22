import type { PresenceEntry } from '@dispatch/client';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';

interface PresenceStackProps {
  presence: PresenceEntry[];
  className?: string;
}

// At most this many initials before collapsing the rest into "+N". Three
// fits the 36px strip at any window width the app supports; past that a
// row of letters stops being glanceable, which is the strip's whole job.
const MAX_SHOWN = 3;

/** Up to two letters from a handle, for the chip. Handles are
 *  `[a-z0-9._-]`, so splitting on the separators gives a sensible "AL" for
 *  `ada.lovelace` and "AD" for plain `ada`. */
export function initialsFor(handle: string): string {
  const parts = handle.split(/[._-]+/).filter((p) => p !== '');
  const letters =
    parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : handle.slice(0, 2);
  return letters.toUpperCase();
}

/** One line of tooltip per person: who, since when, and what they are
 *  running — the three questions someone hovering the stack is asking. */
export function presenceLine(entry: PresenceEntry): string {
  const since = new Date(entry.since).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const running =
    entry.runs.length === 0
      ? 'not running anything'
      : `running ${entry.runs.length} ${entry.runs.length === 1 ? 'agent' : 'agents'}`;
  return `${entry.handle} — here since ${since}, ${running}`;
}

/**
 * Who else is on this daemon, as a row of initials on the status strip.
 *
 * Renders nothing when only one person is present. That is every solo
 * project, and a lone chip reading "you are here" is noise; the stack earns
 * its place the moment a teammate connects with their own token.
 */
export function PresenceStack({ presence, className }: PresenceStackProps) {
  if (presence.length < 2) return null;
  const shown = presence.slice(0, MAX_SHOWN);
  const hidden = presence.length - shown.length;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-slot="presence-stack"
            tabIndex={0}
            role="group"
            aria-label={`${presence.length} people here`}
            className={cn(
              'focus-visible:ring-ring flex items-center rounded-full outline-none focus-visible:ring-2',
              className
            )}
          />
        }
      >
        {shown.map((entry, i) => (
          <span
            key={entry.handle}
            aria-hidden
            className={cn(
              'bg-surface-quaternary border-border-chip flex size-5 items-center justify-center rounded-full border text-[9px] font-medium',
              // Side by side, not overlapped: two-letter initials stacked
              // over each other read as one run-together word, not two people.
              i > 0 && 'ml-0.5',
              // A ring on anyone with a live agent, so "who is busy" reads
              // without opening the tooltip.
              entry.runs.length > 0 && 'ring-state-review ring-1'
            )}
          >
            {initialsFor(entry.handle)}
          </span>
        ))}
        {hidden > 0 && (
          <span aria-hidden className="text-muted-foreground ml-1">
            +{hidden}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="top">
        <ul className="flex flex-col gap-0.5">
          {presence.map((entry) => (
            <li key={entry.handle}>{presenceLine(entry)}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

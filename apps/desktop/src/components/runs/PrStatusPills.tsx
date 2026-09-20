import type {
  PrCheckSummary,
  PrConversationItem,
  PrStatus,
} from '@dispatch/client';
import { Check, Clock, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Pill } from '@/ui/ai/pill';

export type PillTone = 'green' | 'amber' | 'red' | 'purple' | 'muted';

// The 8px dot a toned pill leads with — the label-pill grammar, keyed to the run-state
// palette so a PR fact and a run state in the same colour mean the same thing.
const TONE_DOT: Record<Exclude<PillTone, 'muted'>, string> = {
  green: 'var(--state-review-fg)',
  amber: 'var(--state-waiting-fg)',
  red: 'var(--state-failed-fg)',
  purple: 'var(--status-done)',
};

const TONE_ICON: Record<PillTone, string> = {
  green: 'text-state-review',
  amber: 'text-state-waiting',
  red: 'text-state-failed',
  purple: 'text-status-done',
  muted: 'text-muted-foreground',
};

// One PR status fact (state, review decision, mergeability, checks) as a 24px pill: the
// neutral chip surface with either a toned icon or a toned 8px dot in front of the label.
// Shared so the Landing row and the PR panel cannot drift apart.
export function StatusPill({
  icon,
  children,
  tone = 'muted',
}: {
  icon?: ReactNode;
  children: ReactNode;
  tone?: PillTone;
}) {
  return (
    <Pill data-tone={tone}>
      {icon !== undefined ? (
        <span className={cn('flex shrink-0 items-center', TONE_ICON[tone])}>
          {icon}
        </span>
      ) : (
        tone !== 'muted' && (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: TONE_DOT[tone] }}
          />
        )
      )}
      <span className="min-w-0 truncate">{children}</span>
    </Pill>
  );
}

export const STATE_TONE: Record<PrStatus['state'], 'green' | 'purple' | 'red'> =
  {
    OPEN: 'green',
    MERGED: 'purple',
    CLOSED: 'red',
  };

export const REVIEW_VERDICT: Record<
  NonNullable<PrConversationItem['state']>,
  { label: string; tone: PillTone }
> = {
  APPROVED: { label: 'Approved', tone: 'green' },
  CHANGES_REQUESTED: { label: 'Changes requested', tone: 'amber' },
  COMMENTED: { label: 'Commented', tone: 'muted' },
  DISMISSED: { label: 'Dismissed', tone: 'muted' },
};

// Checks rollup as one pill: red on any failure, amber while pending, green
// when all pass. Renders nothing at zero checks, so a repo without CI is bare.
export function PrChecksPill({ checks }: { checks?: PrCheckSummary }) {
  // Optional, and read through `?.`: a daemon older than the widened RepoPr
  // sends no rollup, and throwing here would drop the whole page's render.
  const total = checks?.total ?? 0;
  const failed = checks?.failed ?? 0;
  const pending = checks?.pending ?? 0;
  if (total === 0) return null;
  const tone = failed > 0 ? 'red' : pending > 0 ? 'amber' : 'green';
  const icon =
    failed > 0 ? (
      <X className="size-3" />
    ) : pending > 0 ? (
      <Clock className="size-3" />
    ) : (
      <Check className="size-3" />
    );
  return (
    <StatusPill tone={tone} icon={icon}>
      {checks?.passed ?? 0}/{total} checks
    </StatusPill>
  );
}

import type { Priority, TaskRisk } from '@dispatch/core/browser';
import { statusLabel } from '@dispatch/core/browser';
import { Circle } from 'lucide-react';

import { priorityLabel } from '../../lib/taskDisplay';
import { Markdown } from '../runs/Markdown';
import { PriorityIcon } from './PriorityIcon';
import { StatusIcon } from './StatusIcon';
import { cn } from '@/lib/utils';
import { LabelPill, Pill } from '@/ui/ai/pill';

/**
 * The spec-shaped slice of a task: what it is and what done means, independent of any live
 * run state. Both a plan's still-unconfirmed drafts and real TaskDocs project onto this, so
 * the plan review and the task page render the same detail body.
 */
export interface TaskSpec {
  title: string;
  /** A canonical or custom status string — 'draft' for plan proposals. */
  status: string;
  priority: Priority;
  description: string;
  acceptanceCriteria: string[];
  writes: string[];
  risk?: TaskRisk;
  /** Blocking tasks by display title. `onOpenBlocker` receives the entry's `key`. */
  blockedBy: { key: string; title: string }[];
}

// The risk pill's dot: amber for elevated, red for critical.
const RISK_DOT: Record<'elevated' | 'critical', string> = {
  elevated: 'var(--state-waiting-fg)',
  critical: 'var(--state-failed-fg)',
};

/** One section under a sentence-case 12px/500 heading, opened by a half-pixel hairline —
 * whitespace and a rule, no inset fill. */
function SpecSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="spec-section"
      className="shadow-hairline-top flex flex-col gap-2 px-4 py-3"
    >
      <p className="text-muted-foreground text-[12px] font-medium">{label}</p>
      {children}
    </div>
  );
}

export interface TaskSpecViewProps {
  spec: TaskSpec;
  /** Jumps to a blocking task (dialog swap on the plan page; navigation on the task page). */
  onOpenBlocker?: (key: string) => void;
  className?: string;
}

/**
 * Read-only rendering of one task's spec — status, priority, description, acceptance
 * criteria, declared writes, risk, and blockers — on the task page's own grammar: the 14px
 * status glyph inline with a 24px/600 title, the description as 15px/450 prose, property
 * pills, then hairline-separated sections. Built for the plan page's draft-expansion dialog
 * and the inbox's right pane: it takes only the `TaskSpec` projection, never a live
 * TaskDoc, so it stays free of run, ledger, and fix-loop concerns by construction. Expects
 * a zero-padding container (sections carry their own edge-to-edge padding).
 */
export function TaskSpecView({
  spec,
  onOpenBlocker,
  className,
}: TaskSpecViewProps) {
  // 'routine' is the default risk everywhere — only the two elevated tiers earn a pill.
  const riskPill =
    spec.risk === 'elevated' || spec.risk === 'critical' ? spec.risk : null;

  return (
    <div data-slot="task-spec" className={cn('flex flex-col', className)}>
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
        <div className="flex items-start gap-2">
          <StatusIcon status={spec.status} className="mt-[9px]" />
          <h2 className="text-foreground min-w-0 flex-1 text-[24px] leading-8 font-semibold tracking-[-0.16px] text-pretty">
            {spec.title}
          </h2>
        </div>
        {spec.description.trim() !== '' && (
          <Markdown content={spec.description} variant="prose" />
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill>
            <StatusIcon status={spec.status} />
            {statusLabel(spec.status)}
          </Pill>
          <Pill>
            <PriorityIcon priority={spec.priority} />
            {priorityLabel(spec.priority)}
          </Pill>
          {riskPill !== null && (
            <LabelPill color={RISK_DOT[riskPill]} className="capitalize">
              {riskPill} risk
            </LabelPill>
          )}
        </div>
      </div>

      {spec.acceptanceCriteria.length > 0 && (
        <SpecSection label="Acceptance criteria">
          <ul className="flex flex-col gap-1">
            {spec.acceptanceCriteria.map((criterion, i) => (
              <li
                key={i}
                className="font-book flex items-start gap-2 text-[13px] leading-5"
              >
                <Circle className="text-muted-foreground/50 mt-1 size-3 shrink-0" />
                <span>{criterion}</span>
              </li>
            ))}
          </ul>
        </SpecSection>
      )}

      {spec.writes.length > 0 && (
        <SpecSection label="Writes">
          <div className="flex flex-wrap gap-1.5">
            {spec.writes.map((glob) => (
              <Pill key={glob} className="font-mono font-normal">
                {glob}
              </Pill>
            ))}
          </div>
        </SpecSection>
      )}

      {spec.blockedBy.length > 0 && (
        <SpecSection label="Blocked by">
          {/* Full-width hover rows, not chips — a blocker is a task you can jump to. */}
          <div className="-mx-2 flex flex-col">
            {spec.blockedBy.map((blocker) =>
              onOpenBlocker !== undefined ? (
                <button
                  key={blocker.key}
                  type="button"
                  onClick={() => onOpenBlocker(blocker.key)}
                  className="hover:bg-surface-hover rounded-control focus-visible:ring-ring flex h-8 w-full items-center gap-2 px-2 text-left transition-colors duration-100 outline-none focus-visible:ring-2"
                >
                  <span className="text-foreground min-w-0 flex-1 truncate text-[13px] font-medium">
                    {blocker.title}
                  </span>
                </button>
              ) : (
                <span
                  key={blocker.key}
                  className="text-foreground flex h-8 w-full items-center px-2 text-[13px] font-medium"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {blocker.title}
                  </span>
                </span>
              )
            )}
          </div>
        </SpecSection>
      )}
    </div>
  );
}

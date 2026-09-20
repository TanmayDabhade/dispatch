import type { LinearIssueLink, RunMeta } from '@dispatch/client';
import type { TaskDoc, UpdatePatch } from '@dispatch/core/browser';
import { ArrowUpRight, Layers, Link2 } from 'lucide-react';

import { kindLabel } from '../../../lib/taskDisplay';
import { MergeLadderPill } from '../../runs/MergeLadderDot';
import { BlockedByEditor } from '../detail/BlockedByEditor';
import { LabelEditor } from '../detail/LabelEditor';
import { MilestoneRow } from '../detail/MilestoneRow';
import { railRowClass, RailSection } from '../detail/RailSection';
import { SelfReviewRow } from '../detail/SelfReviewRow';
import {
  AssigneeControl,
  EpicControl,
  PriorityControl,
  StatusControl,
} from '../PropertyControls';
import { StackRail } from '../StackRail';
import { Pill } from '@/ui/ai/pill';
import { Button } from '@/ui/button';

/** Which rail picker the page's `s`/`p`/`a`/`l`/`e`/`m` keys have opened. */
export type RailPicker =
  | 'status'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'epic'
  | 'milestone';

interface PropertiesRailProps {
  doc: TaskDoc;
  statuses: string[];
  epics: TaskDoc[];
  /** Every task in the project — blocker candidates, label/milestone vocabularies, the stack. */
  tasks: TaskDoc[];
  run: RunMeta | undefined;
  latestRunByTaskId: Map<string, RunMeta>;
  /** Whether this task sits in a blockedBy chain — gates the Stack section. */
  hasStack: boolean;
  onChangeStatus: (status: string) => void;
  onPatch: (patch: UpdatePatch) => void;
  onOpenTask?: (taskId: string) => void;
  picker: RailPicker | null;
  onPickerChange: (picker: RailPicker | null) => void;
  /** The linked Linear issue, when the display map knows it. */
  linearLink: LinearIssueLink | null;
  /** Linked (by UUID) even when the display map has no entry yet. */
  linearLinked: boolean;
  /** Renders the `Push to Linear` ghost for an unlinked task. */
  onPushToLinear?: () => void;
  pushingLinear: boolean;
  /** Brief confirmation until the tasks cache refetches and the link chip takes over. */
  pushedLinear: boolean;
}

// The 280px properties rail Linear puts beside an issue: a `Properties` heading over one
// 32px ghost row per property (status, priority, assignee, kind, milestone, epic), then
// Labels, Blocked by, the run's merge/PR links, self review, and the blockedBy stack. No
// fill, no left rule, and no `No labels`/`No blockers` lines — an unset property reads as
// the action that fills it.
export function PropertiesRail({
  doc,
  statuses,
  epics,
  tasks,
  run,
  latestRunByTaskId,
  hasStack,
  onChangeStatus,
  onPatch,
  onOpenTask,
  picker,
  onPickerChange,
  linearLink,
  linearLinked,
  onPushToLinear,
  pushingLinear,
  pushedLinear,
}: PropertiesRailProps) {
  const pickerProps = (kind: RailPicker) => ({
    open: picker === kind,
    onOpenChange: (open: boolean) => onPickerChange(open ? kind : null),
  });
  const milestones = [
    ...new Set(
      tasks
        .map((t) => t.meta.milestone)
        .filter((m): m is string => m !== null && m !== '')
    ),
  ].sort();
  const labelVocabulary = [
    ...new Set(tasks.flatMap((t) => t.meta.labels)),
  ].sort();
  const showLinks =
    linearLinked || onPushToLinear !== undefined || run?.prUrl !== undefined;

  return (
    <aside
      data-slot="properties-rail"
      className="flex w-[280px] shrink-0 flex-col gap-5 overflow-y-auto px-4 py-6"
    >
      <RailSection title="Properties">
        <StatusControl
          value={doc.meta.status}
          statuses={statuses}
          onChange={onChangeStatus}
          variant="row"
          {...pickerProps('status')}
        />
        <PriorityControl
          value={doc.meta.priority}
          onChange={(priority) => onPatch({ priority })}
          variant="row"
          {...pickerProps('priority')}
        />
        <AssigneeControl
          value={doc.meta.assignee}
          onChange={(assignee) => onPatch({ assignee })}
          variant="row"
          {...pickerProps('assignee')}
        />
        {/* Kind is fixed at creation (task vs epic) — the one read-only property. */}
        <div data-slot="kind-row" className={railRowClass()}>
          <Layers className="text-muted-foreground" />
          <span className="truncate">{kindLabel(doc.meta.kind)}</span>
        </div>
        <MilestoneRow
          value={doc.meta.milestone}
          milestones={milestones}
          onChange={(milestone) => onPatch({ milestone })}
          {...pickerProps('milestone')}
        />
        <EpicControl
          value={doc.meta.parent}
          epics={epics}
          onChange={(parent) => onPatch({ parent })}
          variant="row"
          {...pickerProps('epic')}
        />
      </RailSection>

      <RailSection title="Labels">
        <LabelEditor
          labels={doc.meta.labels}
          candidates={labelVocabulary}
          onChange={(labels) => onPatch({ labels })}
          {...pickerProps('labels')}
        />
      </RailSection>

      <RailSection title="Blocked by">
        <BlockedByEditor
          blockedBy={doc.meta.blockedBy}
          candidates={tasks.filter((t) => t.meta.id !== doc.meta.id)}
          onChange={(blockedBy) => onPatch({ blockedBy })}
          onOpenTask={onOpenTask}
        />
      </RailSection>

      {showLinks && (
        <RailSection title="Links">
          <div className="flex flex-wrap items-center gap-1 px-2 py-1">
            {linearLinked &&
              (linearLink !== null ? (
                <a href={linearLink.url} target="_blank" rel="noreferrer">
                  <Pill className="hover:bg-surface-active">
                    <Link2 className="text-muted-foreground" />
                    {linearLink.identifier}
                  </Pill>
                </a>
              ) : (
                // The display map has no entry for this UUID yet (a baseline pass hasn't
                // covered it) — say "linked" without naming or linking to the issue.
                <Pill title="Linked to a Linear issue">
                  <Link2 className="text-muted-foreground" />
                  Linear
                </Pill>
              ))}
            {!linearLinked &&
              onPushToLinear !== undefined &&
              (pushedLinear ? (
                <Pill>
                  <Link2 className="text-status-green" />
                  Pushed
                </Pill>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onPushToLinear}
                  disabled={pushingLinear}
                  className="-ml-2.5"
                >
                  <Link2 />
                  {pushingLinear ? 'Pushing…' : 'Push to Linear'}
                </Button>
              ))}
            {run?.prUrl !== undefined && (
              <a href={run.prUrl} target="_blank" rel="noreferrer">
                <Pill className="hover:bg-surface-active">
                  Pull request
                  <ArrowUpRight className="text-muted-foreground" />
                </Pill>
              </a>
            )}
            <MergeLadderPill meta={run} />
          </div>
        </RailSection>
      )}

      <RailSection title="Review">
        <SelfReviewRow
          value={doc.meta.selfReview}
          onChange={(selfReview) => onPatch({ selfReview })}
        />
      </RailSection>

      {/* Gated on `hasStack` (not just letting `StackRail` render null on its own) so a
          lone task — the common case, not a "stack" of one — never shows an empty
          heading with nothing beneath it. */}
      {hasStack && (
        <RailSection title="Stack">
          <StackRail
            tasks={tasks}
            taskId={doc.meta.id}
            latestRunByTaskId={latestRunByTaskId}
            onOpenTask={onOpenTask}
          />
        </RailSection>
      )}
    </aside>
  );
}

import type { PlannedTask } from '@dispatch/client';
import { useMemo, useRef } from 'react';

import { type TaskSpec, TaskSpecView } from '../tasks/TaskSpecView';
import { Dialog, DialogChrome, DialogContent, DialogTitle } from '@/ui/dialog';

/** Projects one still-unconfirmed plan task onto the shared spec shape. Blockers are keyed by
 * their proposal index (as a string), since drafts have no task ids yet. */
function specFromPlannedTask(
  task: PlannedTask,
  allTasks: PlannedTask[]
): TaskSpec {
  return {
    title: task.title,
    status: 'draft',
    priority: task.priority,
    description: task.description,
    acceptanceCriteria: task.acceptanceCriteria,
    writes: task.writes ?? [],
    risk: task.risk,
    blockedBy: task.blockedByIndices.flatMap((blockerIndex) => {
      const blocker = allTasks[blockerIndex];
      return blocker === undefined
        ? []
        : [{ key: String(blockerIndex), title: blocker.title }];
    }),
  };
}

export interface PlanTaskSpecDialogProps {
  /** Which proposal task is expanded, or null for closed. */
  index: number | null;
  tasks: PlannedTask[];
  /** Swaps the dialog to another proposal task — how blocker chips navigate. */
  onOpenIndex: (index: number) => void;
  onClose: () => void;
}

/**
 * A proposal task expanded to full detail — the same spec body the task page will render,
 * with the Draft status badge making clear nothing exists on the board yet. Blocker chips
 * swap the dialog to that task in place rather than stacking dialogs.
 */
export function PlanTaskSpecDialog({
  index,
  tasks,
  onOpenIndex,
  onClose,
}: PlanTaskSpecDialogProps) {
  const task = index !== null ? tasks[index] : undefined;
  const spec = useMemo(
    () => (task === undefined ? null : specFromPlannedTask(task, tasks)),
    [task, tasks]
  );
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog
      open={spec !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* The spec view carries its own edge-to-edge section layout, so the dialog is the
          chrome row and the frame. */}
      <DialogContent
        showCloseButton={false}
        className="max-h-[85vh] sm:max-w-xl"
        // The spec view is read-only: focus the popup itself so a description link or
        // blocker row deep in the scrolling body does not pull the scroll on open.
        ref={contentRef}
        initialFocus={contentRef}
      >
        {spec !== null && index !== null && (
          <>
            <DialogChrome>Plan › Task {index + 1}</DialogChrome>
            {/* The spec body renders its own visible title; this satisfies the dialog's
                accessible-name requirement without doubling it on screen. */}
            <DialogTitle className="sr-only">{spec.title}</DialogTitle>
            <div className="min-h-0 overflow-y-auto">
              <TaskSpecView
                spec={spec}
                onOpenBlocker={(key) => onOpenIndex(Number(key))}
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

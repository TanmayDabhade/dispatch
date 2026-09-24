import type { EpicProgress, RunMeta } from '@dispatch/client';
import type { TaskListItem } from '@dispatch/core/browser';

import { EpicDagView } from '../EpicDagView';

/** What the container page hands its Flight Plan: the container, its direct children,
 * and the live data a fan-out view reads. */
export interface ContainerFlightPlanSlotProps {
  container: TaskListItem;
  /** The container's direct children, in list order. */
  childTasks: readonly TaskListItem[];
  /** Every task, for blockers outside the container. */
  tasks: readonly TaskListItem[];
  /** Every run in the project; filter by child. */
  runs: readonly RunMeta[];
  /** The container's fan-out session and waves, when it has ever started one. */
  progress: EpicProgress | undefined;
  onOpenTask: (taskId: string) => void;
}

/**
 * The container page's plan: the slot the full Flight Plan (P4's
 * `ContainerFlightPlanSection`) mounts in, taking these same props. Until it lands this
 * draws the children's dependency graph, so a container page already shows its waves.
 */
export function ContainerFlightPlanSlot({
  childTasks,
  onOpenTask,
}: ContainerFlightPlanSlotProps) {
  return (
    <section
      data-slot="container-flight-plan"
      aria-label="Flight plan"
      className="rounded-card border-border-strong h-[460px] overflow-auto border-[0.5px]"
    >
      <EpicDagView tasks={childTasks} onOpenTask={onOpenTask} />
    </section>
  );
}

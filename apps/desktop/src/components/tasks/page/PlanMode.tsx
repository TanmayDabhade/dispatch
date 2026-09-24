import { ContainerFlightPlanSlot } from './ContainerFlightPlanSlot';
import type { TaskPageModel } from './pageModel';
import { SubtasksBlock } from './SubtasksBlock';

/**
 * Plan mode — a container's fan-out: its Flight Plan (the slot P4's full view mounts in),
 * then every sub-issue as a row with its status, run and owner.
 */
export function PlanMode({ page }: { page: TaskPageModel }) {
  const { item, project } = page;
  return (
    <div data-slot="plan-mode" className="flex flex-col gap-5 px-4 pb-10">
      <ContainerFlightPlanSlot
        container={item}
        childTasks={page.children}
        tasks={project.tasksIncludingArchived}
        runs={project.runs}
        progress={project.epicProgressById.get(item.meta.id)}
        onOpenTask={page.openTask}
      />
      <SubtasksBlock
        title="Sub-issues"
        parent={item}
        tasks={page.children}
        latestRunByTaskId={project.latestRunByTaskId}
        onOpenTask={page.openTask}
        createPreset={{ epic: item.meta.id }}
      />
    </div>
  );
}

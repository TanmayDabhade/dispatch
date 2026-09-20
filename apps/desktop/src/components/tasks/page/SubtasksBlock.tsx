import type { RunMeta } from '@dispatch/client';
import type { TaskDoc } from '@dispatch/core/browser';
import { ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';

import { colorForLabel } from '../../../lib/labelColor';
import { isTerminalRunState } from '../../../lib/runState';
import { formatShortDate } from '../../../lib/taskDates';
import { RunStatePill } from '../../runs/RunStatePill';
import { useShellActions } from '../../shell/ShellActionsContext';
import { AssigneeAvatar } from '../AssigneeAvatar';
import { PriorityIcon } from '../PriorityIcon';
import { pieDashOffset, StatusIcon } from '../StatusIcon';
import { cn } from '@/lib/utils';
import { IconButton } from '@/ui/ai/icon-button';
import { ListRow } from '@/ui/ai/list-row';
import { LabelPill } from '@/ui/ai/pill';

/** Whether a sub-task counts as done for the `◔ n/m` glyph: landed, or dropped (it needs
 * nothing more from anyone). */
function isFinished(doc: TaskDoc): boolean {
  return doc.meta.status === 'landed' || doc.meta.status === 'dropped';
}

// Linear's tiny progress pie beside the sub-issues count: a 14px ring whose interior fills
// as children land, on the same geometry as `StatusIcon`'s pie.
function ProgressGlyph({ done, total }: { done: number; total: number }) {
  const fraction = total === 0 ? 0 : done / total;
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      className="text-muted-foreground size-3.5 shrink-0"
      role="img"
      aria-label={`${done} of ${total} done`}
    >
      <circle cx={7} cy={7} r={6} stroke="currentColor" strokeWidth={1.5} />
      <circle
        cx={7}
        cy={7}
        r={2}
        stroke="currentColor"
        strokeWidth={4}
        strokeDasharray="12.189379495928398 24.378758991856795"
        strokeDashoffset={pieDashOffset(fraction)}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

// The `▾ Sub-tasks ◔ 1/3` block under the description: a 12px/500 header with a collapse
// chevron, the progress pie and count, and a `+` that opens the task creator with this
// epic preset; then one 36px `ListRow` per child (priority, id, status, title, label pills,
// a live run mark, the assignee, the day it last moved). Also used, titled `Blocks`, for a
// task whose completion unblocks others.
export function SubtasksBlock({
  title = 'Sub-tasks',
  parent,
  tasks,
  latestRunByTaskId,
  onOpenTask,
  createPreset,
}: {
  title?: string;
  parent: TaskDoc;
  /** The child rows, in the order to draw them. */
  tasks: TaskDoc[];
  latestRunByTaskId: Map<string, RunMeta>;
  onOpenTask?: (taskId: string) => void;
  /** What the `+` pre-fills; omitted hides the button (a `Blocks` list has no creator). */
  createPreset?: { epic: string };
}) {
  const shell = useShellActions();
  const [collapsed, setCollapsed] = useState(false);
  const done = tasks.filter(isFinished).length;
  return (
    <section data-slot="subtasks-block" className="flex flex-col gap-1">
      <div className="flex h-7 items-center gap-1.5">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
          className="text-muted-foreground rounded-control focus-visible:ring-ring flex h-7 items-center gap-1.5 px-1 text-[12px] font-medium outline-none hover:text-(--text-secondary) focus-visible:ring-2"
        >
          <ChevronDown
            className={cn(
              'size-3 transition-transform duration-100',
              collapsed && '-rotate-90'
            )}
          />
          {title}
          <ProgressGlyph done={done} total={tasks.length} />
          <span className="font-book tabular-nums">
            {done}/{tasks.length}
          </span>
        </button>
        {createPreset !== undefined && (
          <IconButton
            label={`Add sub-task to ${parent.meta.title}`}
            className="ml-auto"
            onClick={() => shell.openCreateTask({ epic: createPreset.epic })}
          >
            <Plus />
          </IconButton>
        )}
      </div>
      {!collapsed && (
        <div className="-mx-3 flex flex-col">
          {tasks.map((child) => {
            const run = latestRunByTaskId.get(child.meta.id);
            const live = run !== undefined && !isTerminalRunState(run.state);
            return (
              <ListRow
                key={child.meta.id}
                data-row-id={child.meta.id}
                leading={<PriorityIcon priority={child.meta.priority} />}
                id={child.meta.id}
                status={<StatusIcon status={child.meta.status} />}
                title={child.meta.title}
                trailing={
                  <>
                    {child.meta.labels.map((label) => (
                      <LabelPill key={label} color={colorForLabel(label)}>
                        {label}
                      </LabelPill>
                    ))}
                    {live && run !== undefined && (
                      <RunStatePill meta={run} compact />
                    )}
                    <AssigneeAvatar assignee={child.meta.assignee} />
                  </>
                }
                date={formatShortDate(child.meta.updated)}
                onClick={
                  onOpenTask !== undefined
                    ? () => onOpenTask(child.meta.id)
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

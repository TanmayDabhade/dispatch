import type { ApiClient } from '@dispatch/client';
import type { TaskDoc, TaskListItem } from '@dispatch/core/browser';
import { createContext, useContext } from 'react';

import { useTaskDoc, withBody } from '../../hooks/useTaskDoc';
import { ErrorBoundary } from '../shell/ErrorBoundary';
import type { TaskDetailPanelProps } from './detail';
import { TaskPage } from './detail';
import { EmptyState } from '@/ui/chrome';
import { Spinner } from '@/ui/spinner';

/**
 * What a `TaskPane` needs from the shell to draw a task: where to fetch its body and how
 * to build the task page's props. App provides it once; any split view renders
 * `<TaskPane taskId>` without threading the project through.
 */
export interface TaskPaneHost {
  projectName: string | null;
  client: ApiClient | null;
  port: number | undefined;
  /** Every task, archived included — the pane's own lookup. */
  tasks: readonly TaskListItem[];
  panelProps: (doc: TaskDoc) => TaskDetailPanelProps;
}

export const TaskPaneHostContext = createContext<TaskPaneHost | null>(null);

interface TaskPaneProps {
  taskId: string;
  onClose: () => void;
  /** Grows the pane into the full task page. */
  onExpand: () => void;
}

/**
 * One task beside a list — the Cockpit's split view. The seam the state-adaptive task page
 * (P5) replaces: callers only ever say which task; what the pane draws for it is decided
 * here. Today it is the existing task page in its compact (peek) chrome, with its body
 * loaded per task and everything else read from the cached list.
 */
export function TaskPane(props: TaskPaneProps) {
  const host = useContext(TaskPaneHostContext);
  // No host (a test, a config still loading): nothing to draw the task with yet.
  return host === null ? null : <TaskPaneBody host={host} {...props} />;
}

function TaskPaneBody({
  host,
  taskId,
  onClose,
  onExpand,
}: TaskPaneProps & { host: TaskPaneHost }) {
  const full = useTaskDoc(host.client, host.port, taskId);
  const doc = withBody(host.tasks, taskId, full);
  const listed = host.tasks.some((t) => t.meta.id === taskId);
  return (
    <section
      aria-label="Task"
      data-slot="task-pane"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      {doc !== null ? (
        <ErrorBoundary label="this task">
          <TaskPage
            key={taskId}
            mode="peek"
            projectName={host.projectName}
            onExpand={onExpand}
            onClose={onClose}
            {...host.panelProps(doc)}
          />
        </ErrorBoundary>
      ) : listed ? (
        <div className="flex h-full items-center justify-center">
          <Spinner className="text-muted-foreground size-4" />
        </div>
      ) : (
        <EmptyState
          className="h-full"
          heading="That task is no longer available."
          description="It was archived or deleted while it was open."
          secondary={{ label: 'Close', onClick: onClose }}
        />
      )}
    </section>
  );
}

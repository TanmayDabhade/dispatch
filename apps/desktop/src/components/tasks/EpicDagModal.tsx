import type { TaskDoc } from '@dispatch/core/browser';

import { EpicDagView } from './EpicDagView';
import {
  Dialog,
  DialogBody,
  DialogChrome,
  DialogContent,
  DialogTitle,
} from '@/ui/dialog';

export interface EpicDagModalProps {
  /** The epic whose graph is open, or `null` when the modal is closed — a view-local-state
   * discriminated-by-value prop (mirroring `DiffModal`'s `filePath: string | null`) rather
   * than a separate boolean, so each of this feature's three entry points (TasksListView's
   * group header, EpicLaneHeader, TaskPage) can own one small piece of state instead of
   * this needing to be threaded through App-level nav state. */
  epic: TaskDoc | null;
  /** The epic's children — already filtered by the caller (each entry point already has the
   * full project task list in scope), so this modal never recomputes it itself. */
  tasks: TaskDoc[];
  onOpenTask?: (taskId: string) => void;
  onClose: () => void;
}

/**
 * Wraps `EpicDagView` in the 12px-radius dialog: a chrome row carrying the `t-xxxx ›
 * Dependency graph` crumb and the close button, the epic's title beneath it, then the
 * graph scrolling inside the body. Deliberately thin — all the actual graph logic lives
 * in `EpicDagView`/`dagLayout`.
 */
export function EpicDagModal({
  epic,
  tasks,
  onOpenTask,
  onClose,
}: EpicDagModalProps) {
  return (
    <Dialog
      open={epic !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] w-[min(1024px,92vw)] max-w-none flex-col sm:max-w-none"
      >
        {epic !== null && (
          <>
            <DialogChrome>
              <span className="font-book tracking-(--id-tracking)">
                {epic.meta.id}
              </span>
              <span aria-hidden>›</span>
              <span className="text-(--text-secondary)">Dependency graph</span>
            </DialogChrome>
            <DialogBody className="min-h-0 gap-3 overflow-auto pt-0 pb-4">
              <DialogTitle>{epic.meta.title || 'Dependency graph'}</DialogTitle>
              <EpicDagView tasks={tasks} onOpenTask={onOpenTask} />
            </DialogBody>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

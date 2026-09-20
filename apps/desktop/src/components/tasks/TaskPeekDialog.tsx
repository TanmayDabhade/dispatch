import { useEffect, useRef } from 'react';

import { ErrorBoundary } from '../shell/ErrorBoundary';
import type { TaskDetailPanelProps } from './detail';
import { TaskPage } from './detail';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';

/**
 * The task peek: `TaskPage` in peek mode inside a centred 12px-radius dialog, opened from
 * the board/list without leaving the current view. Adds only what a peek needs beyond the
 * page itself — the dialog shell, Escape-to-close, and the ⌘/Ctrl+Enter chord that hands
 * off to the full task view via `onExpand` (the page draws the expand button).
 */
export function TaskPeekDialog({
  onClose,
  onExpand,
  projectName,
  ...panelProps
}: TaskDetailPanelProps & {
  onClose: () => void;
  onExpand: () => void;
  projectName?: string | null;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  // Cmd/Ctrl+Enter grows the peek into the full task view.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        onExpand();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onExpand]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex h-[85vh] max-h-[760px] w-[min(960px,94vw)] flex-col overflow-hidden sm:max-w-[960px]"
        aria-describedby={undefined}
        showCloseButton={false}
        // The default open-autofocus lands on the first tabbable descendant — the
        // (pre-filled) title field — and browsers select a text input's full value when
        // it's focused this way. Left alone, opening this dialog and pressing any key would
        // silently wipe the task's title. Focus the content root itself instead (the popup
        // carries `tabIndex={-1}` for exactly this) — Tab still reaches the title normally.
        ref={contentRef}
        initialFocus={contentRef}
      >
        <DialogTitle className="sr-only">
          {panelProps.doc.meta.title || 'Task detail'}
        </DialogTitle>
        <ErrorBoundary label="this dialog">
          <TaskPage
            mode="peek"
            projectName={projectName}
            onExpand={onExpand}
            onClose={onClose}
            {...panelProps}
          />
        </ErrorBoundary>
      </DialogContent>
    </Dialog>
  );
}

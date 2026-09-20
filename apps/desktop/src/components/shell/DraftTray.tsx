import type { DraftRecord } from '@dispatch/client';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { draftTrayViewModel } from '../../lib/draftTray';
import { IconButton } from '@/ui/ai/icon-button';
import { TaskRow, type TaskRowState } from '@/ui/ai/task-rows';
import { EmptyState } from '@/ui/chrome';
import { Popover, PopoverContent } from '@/ui/popover';
import { ScrollArea } from '@/ui/scroll-area';

// The tray's own item states mapped onto `TaskRow`'s vocabulary: a ready proposal is 'done'
// (review color — it is waiting to be reviewed), the rest map by name.
const ROW_STATE: Record<'running' | 'ready' | 'failed', TaskRowState> = {
  running: 'running',
  ready: 'done',
  failed: 'failed',
};

/** The element the popover hangs off — the sidebar's Drafts row, looked up at open time so
 * the rail can re-render without the popover losing its anchor. */
type DraftTrayAnchor = () => Element | null;

interface DraftTrayPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: DraftTrayAnchor;
  /** Every draft currently held in memory, newest first — `data.drafts`. */
  drafts: DraftRecord[];
  /** Opens the review dialog for a ready draft. */
  onOpenDraft: (id: string) => void;
  onDismissDraft: (id: string) => void;
}

/** App-wide popover of in-flight and settled AI task drafts, anchored to the rail's Drafts
 * row — a draft keeps running after its composer closes, so this is reachable from any
 * view. The row itself carries the count; this is the list. */
export function DraftTrayPopover({
  open,
  onOpenChange,
  anchor,
  drafts,
  onOpenDraft,
  onDismissDraft,
}: DraftTrayPopoverProps) {
  const [now, setNow] = useState(() => Date.now());
  const { items, hasRunning } = draftTrayViewModel(drafts, now);

  // Ticks the elapsed readout once a second, but only while the popover is open and something
  // is still running.
  useEffect(() => {
    if (!open || !hasRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, hasRunning]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent
        anchor={anchor}
        align="start"
        side="right"
        sideOffset={8}
        className="w-[26rem] p-0"
      >
        <div className="text-muted-foreground flex h-9 items-center px-3 text-[12px] font-medium">
          Drafts
        </div>
        <ScrollArea className="max-h-[60vh]">
          {items.length === 0 ? (
            <EmptyState
              heading="No drafts yet"
              description="Start one from New task."
            />
          ) : (
            <div className="pb-1">
              {items.map((item) => (
                <TaskRow
                  key={item.id}
                  title={item.label}
                  agent="planner"
                  state={ROW_STATE[item.state]}
                  progress={
                    item.taskCount !== null && item.taskCount > 1
                      ? `${item.taskCount} tasks`
                      : undefined
                  }
                  elapsedLabel={item.elapsed}
                  onClick={
                    item.openable
                      ? () => {
                          onOpenDraft(item.id);
                          onOpenChange(false);
                        }
                      : undefined
                  }
                  actions={
                    <IconButton
                      label="Dismiss draft"
                      onClick={(event) => {
                        // The row itself is clickable; a dismiss must not also open it.
                        event.stopPropagation();
                        onDismissDraft(item.id);
                      }}
                      className="hover:text-red"
                    >
                      <X />
                    </IconButton>
                  }
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

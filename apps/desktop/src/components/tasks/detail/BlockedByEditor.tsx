import type { TaskDoc } from '@dispatch/core/browser';
import { Plus, X } from 'lucide-react';

import { StatusIcon } from '../StatusIcon';
import { PickerPopover } from './PickerPopover';
import { railRowClass } from './RailSection';
import { Pill } from '@/ui/ai/pill';

// The blocked-by group in the rail: current blockers as pills (the blocking task's title,
// its id on hover) each with a remove `×`, then an `Add blocker` row opening a searchable
// picker of the other tasks in the project. Unlike labels this IS a pick-from-list — a
// blocker has to be a real task id — so there is no create affordance; self and
// already-listed blockers are filtered out of the candidates.
export function BlockedByEditor({
  blockedBy,
  candidates,
  onChange,
  onOpenTask,
}: {
  blockedBy: string[];
  candidates: TaskDoc[];
  onChange: (next: string[]) => void;
  /** Clicking a blocker's pill re-points the page at that task. */
  onOpenTask?: (taskId: string) => void;
}) {
  const byId = new Map(candidates.map((t) => [t.meta.id, t]));
  const addable = candidates.filter((t) => !blockedBy.includes(t.meta.id));
  return (
    <div data-slot="blocked-by-editor" className="flex flex-col gap-1">
      {blockedBy.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 py-1">
          {blockedBy.map((id) => {
            const blocker = byId.get(id);
            const title = blocker?.meta.title ?? id;
            return (
              <Pill key={id} title={id} className="max-w-full">
                {blocker !== undefined && (
                  <StatusIcon status={blocker.meta.status} />
                )}
                {onOpenTask !== undefined ? (
                  <button
                    type="button"
                    className="hover:text-foreground min-w-0 truncate outline-none focus-visible:underline"
                    onClick={() => onOpenTask(id)}
                  >
                    {title}
                  </button>
                ) : (
                  <span className="min-w-0 truncate">{title}</span>
                )}
                <button
                  type="button"
                  aria-label={`Remove blocker ${id}`}
                  className="text-muted-foreground hover:text-foreground rounded-pill focus-visible:ring-ring -mr-1 flex size-4 shrink-0 items-center justify-center outline-none focus-visible:ring-2"
                  onClick={() => onChange(blockedBy.filter((b) => b !== id))}
                >
                  <X className="size-3" />
                </button>
              </Pill>
            );
          })}
        </div>
      )}
      {addable.length > 0 && (
        <PickerPopover
          triggerLabel="Add blocker"
          triggerClassName={railRowClass(true)}
          placeholder="Task…"
          items={addable.map((t) => ({
            value: t.meta.id,
            label: t.meta.title,
            hint: t.meta.id,
            glyph: <StatusIcon status={t.meta.status} />,
          }))}
          onSelect={(id) => onChange([...blockedBy, id])}
        >
          <Plus />
          <span className="truncate">Add blocker</span>
        </PickerPopover>
      )}
    </div>
  );
}

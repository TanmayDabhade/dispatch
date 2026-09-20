import { Plus, X } from 'lucide-react';

import { colorForLabel } from '../../../lib/labelColor';
import { PickerPopover } from './PickerPopover';
import { railRowClass } from './RailSection';
import { LabelPill } from '@/ui/ai/pill';

// The labels group in the rail: the task's labels as colour-dotted pills, each with a
// remove `×`, then an `Add label` row that opens a picker over every label the project
// already uses — plus `Create "…"` for a new one, since labels are freeform strings. Calls
// back with the whole new list (matching UpdatePatch.labels' shape), deduped.
export function LabelEditor({
  labels,
  candidates,
  onChange,
  open,
  onOpenChange,
}: {
  labels: string[];
  /** Every label used anywhere in the project, for the picker. */
  candidates: string[];
  onChange: (next: string[]) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  function add(label: string) {
    const next = label.trim();
    if (next !== '' && !labels.includes(next)) onChange([...labels, next]);
  }
  const items = candidates
    .filter((label) => !labels.includes(label))
    .map((label) => ({
      value: label,
      label,
      glyph: (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: colorForLabel(label) }}
        />
      ),
    }));
  return (
    <div data-slot="label-editor" className="flex flex-col gap-1">
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 py-1">
          {labels.map((label) => (
            <LabelPill key={label} color={colorForLabel(label)}>
              {label}
              <button
                type="button"
                aria-label={`Remove label ${label}`}
                className="text-muted-foreground hover:text-foreground rounded-pill focus-visible:ring-ring -mr-1 flex size-4 items-center justify-center outline-none focus-visible:ring-2"
                onClick={() => onChange(labels.filter((l) => l !== label))}
              >
                <X className="size-3" />
              </button>
            </LabelPill>
          ))}
        </div>
      )}
      <PickerPopover
        triggerLabel="Add label"
        triggerClassName={railRowClass({ unset: true })}
        placeholder="Label…"
        items={items}
        onSelect={add}
        onCreate={add}
        emptyLabel="Type a new label."
        open={open}
        onOpenChange={onOpenChange}
      >
        <Plus />
        <span className="truncate">Add label</span>
      </PickerPopover>
    </div>
  );
}

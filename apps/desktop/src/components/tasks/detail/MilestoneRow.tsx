import { Target } from 'lucide-react';

import { PickerPopover } from './PickerPopover';
import { railRowClass } from './RailSection';

// The milestone property in the rail: a 32px ghost row that reads the milestone's name, or
// `Add to milestone` when unset, and opens a picker of the project's existing milestone
// names — plus `Create "…"` for a new one, matching the free-form model (ad-hoc names, no
// per-project setup). `No milestone` clears it.
export function MilestoneRow({
  value,
  milestones,
  onChange,
  open,
  onOpenChange,
}: {
  value: string | null;
  milestones: string[];
  onChange: (milestone: string | null) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const items = milestones.map((name) => ({
    value: name,
    label: name,
    glyph: <Target className="text-muted-foreground" />,
    selected: name === value,
  }));
  if (value !== null) {
    items.push({
      value: '',
      label: 'No milestone',
      glyph: <Target className="text-muted-foreground" />,
      selected: false,
    });
  }
  return (
    <PickerPopover
      triggerLabel="Change milestone"
      triggerClassName={railRowClass({ unset: value === null })}
      placeholder="Milestone…"
      items={items}
      onSelect={(next) => onChange(next === '' ? null : next)}
      onCreate={(name) => onChange(name)}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Target className="text-muted-foreground" />
      <span className="truncate">{value ?? 'Add to milestone'}</span>
    </PickerPopover>
  );
}

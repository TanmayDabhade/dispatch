import { Eye } from 'lucide-react';

import { railRowClass } from './RailSection';
import { Switch } from '@/ui/ai/switch';

// The self-review toggle in the rail: when on, the orchestrator's prompt builder (see
// server's prompt.ts) tells the dispatched agent to re-review its own diff against the
// acceptance criteria before finishing. A 28×16 switch on a ghost row, so it reads as one
// more property rather than a bolted-on form control.
export function SelfReviewRow({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      htmlFor="task-self-review"
      data-slot="self-review-row"
      className={railRowClass()}
    >
      <Eye className="text-muted-foreground" />
      <span className="flex-1 truncate">Self review</span>
      <Switch
        id="task-self-review"
        checked={value}
        onCheckedChange={(checked) => onChange(checked)}
        aria-label="Self review before finishing"
      />
    </label>
  );
}

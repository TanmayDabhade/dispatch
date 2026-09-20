import type { Assignee, Priority, TaskDoc } from '@dispatch/core/browser';
import { Check, Milestone } from 'lucide-react';
import { type ReactNode, useId } from 'react';

import {
  assigneeLabel,
  priorityLabel,
  statusLabel,
} from '../../lib/taskDisplay';
import { AssigneeAvatar } from './AssigneeAvatar';
import { PriorityIcon } from './PriorityIcon';
import { StatusIcon } from './StatusIcon';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Kbd } from '@/ui/kbd';

// Shared inline editors for a task's properties, so status/priority/assignee/epic edit
// identically everywhere they appear — a bare 14px glyph you click on a board card or list
// row (`variant: 'inline'`), or Linear's 32px ghost row in the properties rail
// (`variant: 'row'`). Every surface that shows a property should edit it through one of
// these rather than re-deriving the picker, matching Linear's "click the thing to change the
// thing" interaction across the whole app.

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];
const ASSIGNEES: Assignee[] = ['agent', 'human', 'none'];
// Menu values can't be the empty string, so this sentinel stands in for the "no epic"
// choice and is mapped back to `null` at the onChange boundary.
const NO_EPIC = '__none__';

export type ControlVariant = 'inline' | 'row';

/** Open state a list row or the task page can drive from the `s`/`p`/`a`/`e` keys (the
 * label picker is `LabelEditor`, not one of these). Leave both out and the picker manages
 * itself. */
export interface ControlledOpen {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface Option {
  value: string;
  label: string;
  glyph: ReactNode;
}

// The trigger + menu shared by every control. Inline, the trigger is the selected option's
// glyph in a 20px hit area; in the rail it is the glyph plus its label on a 32px ghost row,
// and an unset value reads as the action that fills it (`Set priority`, `Assign`). The
// trigger's accessible name stays the action (`Change status`) and its current value rides
// along as the accessible description, so a screen reader hears both. The menu opens with a header naming the picker and its single-key shortcut, then one 32px
// item per option with a 12px check on the current one. Clicks and pointer-downs are
// stopped from propagating so opening/using the picker never also selects the card or row
// it sits on (both are themselves clickable, and the menu is portaled — its clicks would
// otherwise bubble through React back to that parent).
function PropertyDropdown({
  value,
  options,
  onChange,
  variant,
  ariaLabel,
  menuTitle,
  shortcut,
  unset = false,
  unsetLabel,
  open,
  onOpenChange,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  variant: ControlVariant;
  ariaLabel: string;
  /** The menu's header, `Change status`. */
  menuTitle: string;
  /** The single key that opens this picker from a focused row, shown as a keycap. */
  shortcut: string;
  /** The value is the "nothing chosen" option — the row dims and reads `unsetLabel`. */
  unset?: boolean;
  unsetLabel?: string;
} & ControlledOpen) {
  const selected = options.find((o) => o.value === value);
  const rowLabel =
    unset && unsetLabel !== undefined ? unsetLabel : selected?.label;
  const valueId = useId();
  return (
    <DropdownMenu
      open={open}
      onOpenChange={
        onOpenChange === undefined ? undefined : (next) => onOpenChange(next)
      }
    >
      <DropdownMenuTrigger
        aria-label={ariaLabel}
        aria-describedby={valueId}
        data-slot="property-control"
        data-variant={variant}
        data-unset={unset || undefined}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          'shrink-0 items-center rounded-control transition-colors duration-100 outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-surface-hover',
          variant === 'inline'
            ? 'inline-flex size-5 justify-center'
            : 'flex h-8 w-full min-w-0 gap-2 px-2 text-[13px] font-medium text-(--text-secondary)',
          variant === 'row' && unset && 'text-muted-foreground'
        )}
      >
        {selected?.glyph}
        <span
          id={valueId}
          className={variant === 'row' ? 'truncate' : 'sr-only'}
        >
          {rowLabel}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 min-w-[184px]"
        onClick={(e) => e.stopPropagation()}
        // Base UI portals the menu, but React still bubbles its keydowns up to the row or
        // card the trigger sits in, whose roving j/k and single-key handlers must not react.
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2">
            {menuTitle}
            <Kbd className="ml-auto">{shortcut}</Kbd>
          </DropdownMenuLabel>
          {options.map((o) => (
            <DropdownMenuItem
              key={o.value}
              onClick={() => onChange(o.value)}
              data-selected={o.value === value || undefined}
            >
              {o.glyph}
              <span className="truncate">{o.label}</span>
              {o.value === value && (
                <Check className="ml-auto size-3" aria-label="Selected" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StatusControl({
  value,
  statuses,
  onChange,
  variant = 'inline',
  open,
  onOpenChange,
}: {
  value: string;
  statuses: string[];
  onChange: (status: string) => void;
  variant?: ControlVariant;
} & ControlledOpen) {
  const options = statuses.map((s) => ({
    value: s,
    label: statusLabel(s),
    glyph: <StatusIcon status={s} />,
  }));
  return (
    <PropertyDropdown
      value={value}
      options={options}
      onChange={onChange}
      variant={variant}
      ariaLabel="Change status"
      menuTitle="Change status"
      shortcut="S"
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

export function PriorityControl({
  value,
  onChange,
  variant = 'inline',
  open,
  onOpenChange,
}: {
  value: Priority;
  onChange: (priority: Priority) => void;
  variant?: ControlVariant;
} & ControlledOpen) {
  const options = PRIORITIES.map((p) => ({
    value: p,
    label: priorityLabel(p),
    glyph: <PriorityIcon priority={p} />,
  }));
  return (
    <PropertyDropdown
      value={value}
      options={options}
      onChange={(v) => onChange(v as Priority)}
      variant={variant}
      ariaLabel="Change priority"
      menuTitle="Change priority"
      shortcut="P"
      unset={value === 'none'}
      unsetLabel="Set priority"
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

export function AssigneeControl({
  value,
  onChange,
  variant = 'inline',
  open,
  onOpenChange,
}: {
  value: Assignee;
  onChange: (assignee: Assignee) => void;
  variant?: ControlVariant;
} & ControlledOpen) {
  // A named ref (`human:wyat`) is not one of the three fixed choices, so it is listed as
  // the current value on top rather than silently rendering as unassigned.
  const values = ASSIGNEES.includes(value) ? ASSIGNEES : [value, ...ASSIGNEES];
  const options = values.map((a) => ({
    value: a,
    label: assigneeLabel(a),
    glyph: <AssigneeAvatar assignee={a} size={16} />,
  }));
  return (
    <PropertyDropdown
      value={value}
      options={options}
      onChange={onChange}
      variant={variant}
      ariaLabel="Change assignee"
      menuTitle="Assign to"
      shortcut="A"
      unset={value === 'none'}
      unsetLabel="Assign"
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

export function EpicControl({
  value,
  epics,
  onChange,
  variant = 'row',
  open,
  onOpenChange,
}: {
  value: string | null;
  epics: TaskDoc[];
  onChange: (parent: string | null) => void;
  variant?: ControlVariant;
} & ControlledOpen) {
  const options: Option[] = [
    {
      value: NO_EPIC,
      label: 'No epic',
      glyph: <Milestone className="size-3.5" />,
    },
    ...epics.map((epic) => ({
      value: epic.meta.id,
      label: epic.meta.title,
      glyph: <Milestone className="size-3.5" />,
    })),
  ];
  return (
    <PropertyDropdown
      value={value ?? NO_EPIC}
      options={options}
      onChange={(v) => onChange(v === NO_EPIC ? null : v)}
      variant={variant}
      ariaLabel="Change epic"
      menuTitle="Add to epic"
      shortcut="E"
      unset={value === null}
      unsetLabel="Add to epic"
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

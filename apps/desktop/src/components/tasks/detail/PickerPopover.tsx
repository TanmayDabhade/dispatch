import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';

interface PickerItem {
  value: string;
  label: string;
  /** Muted trailing text (a task id); also searched. */
  hint?: string;
  glyph?: ReactNode;
  /** The current value — drawn with a trailing check. */
  selected?: boolean;
}

// The searchable picker the rail's free-form properties open (milestone, labels, blockers):
// a 12px-radius popover holding a Command list with a search input on top. Where a property
// accepts new values, typing a name nobody has used yet offers to create it, so assigning a
// task to a milestone reuses a name with one keystroke or coins a new one. Controlled
// `open` lets the page's `l`/`m` keys open it.
export function PickerPopover({
  triggerLabel,
  triggerClassName,
  children,
  placeholder,
  items,
  onSelect,
  onCreate,
  emptyLabel = 'No matches.',
  open,
  onOpenChange,
}: {
  /** Accessible name of the trigger button. */
  triggerLabel: string;
  triggerClassName?: string;
  /** The trigger's face — a glyph and the current value, or the `Add …` action. */
  children: ReactNode;
  placeholder: string;
  items: PickerItem[];
  onSelect: (value: string) => void;
  /** Offered as `Create "<query>"` when the typed text matches no item. */
  onCreate?: (query: string) => void;
  emptyLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const isOpen = open ?? localOpen;
  function setOpen(next: boolean) {
    if (!next) setQuery('');
    setLocalOpen(next);
    onOpenChange?.(next);
  }
  const trimmed = query.trim();
  const canCreate =
    onCreate !== undefined &&
    trimmed !== '' &&
    !items.some((item) => item.label.toLowerCase() === trimmed.toLowerCase());

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={triggerLabel}
            data-slot="picker-trigger"
            className={triggerClassName}
          />
        }
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-64 p-1">
            {!canCreate && <CommandEmpty>{emptyLabel}</CommandEmpty>}
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.value}
                  value={`${item.label} ${item.hint ?? ''}`}
                  onSelect={() => {
                    onSelect(item.value);
                    setOpen(false);
                  }}
                  className="h-8"
                >
                  {item.glyph}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint !== undefined && (
                    <span className="text-muted-foreground ml-2 shrink-0 text-[12px]">
                      {item.hint}
                    </span>
                  )}
                  {item.selected === true && (
                    <Check className="ml-auto size-3 shrink-0" />
                  )}
                </CommandItem>
              ))}
              {canCreate && (
                <CommandItem
                  value={`create ${trimmed}`}
                  onSelect={() => {
                    onCreate(trimmed);
                    setOpen(false);
                  }}
                  className="h-8"
                >
                  <span className="min-w-0 flex-1 truncate">
                    Create &ldquo;{trimmed}&rdquo;
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

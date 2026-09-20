import type {
  ComponentPropsWithRef,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from 'react';

import { Checkbox } from '../checkbox';
import { cn } from '../lib/utils';

export type ListRowProps = {
  /** Priority glyph, 14px. */
  leading?: ReactNode;
  /** The issue id (`AI-32`): 13px/450 muted with Linear's -0.26px tracking. */
  id?: ReactNode;
  /** Status glyph, 14px. */
  status?: ReactNode;
  /** 13px/500, truncates. */
  title: ReactNode;
  /** ` › Parent` context after the title. */
  crumb?: ReactNode;
  /** Right-aligned pills, chips and the assignee avatar. */
  trailing?: ReactNode;
  /** 12px/450 muted, the far right. */
  date?: ReactNode;
  /** `1` nests the row 24px under its parent with a hairline tree connector. */
  indent?: 0 | 1;
  /** Bulk-selected: neutral surface, checkbox shown. */
  selected?: boolean;
  /** Keyboard cursor: neutral surface, checkbox shown. Never the accent. */
  focused?: boolean;
  /** Called with the mouse event on click, with nothing on Enter/Space. */
  onClick?: (event?: MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  /** Present → the row grows a hover-revealed checkbox at the far left. */
  onSelectToggle?: (selected: boolean) => void;
  /** Accessible name for the checkbox; defaults to "Select". */
  selectLabel?: string;
  className?: string;
} & Omit<
  ComponentPropsWithRef<'div'>,
  'id' | 'title' | 'onClick' | 'onContextMenu' | 'children'
>;

/** The 36px issue row: no background, no divider, a neutral wash on hover, focus and
 * selection. Slots read left to right in Linear's order — checkbox, priority, id,
 * status, title, crumb, then the right-aligned trailing group and date. Enter and Space
 * activate a clickable row; the checkbox is its own control and never opens the row.
 *
 * The default `role="row"` needs a `role="grid"` (or `rowgroup` inside one) ancestor
 * or it is an orphan ARIA row; a list that is not a grid should pass `role="button"`
 * (clickable) or `role={undefined}`. A nested row (`indent={1}`) dims its id. */
export function ListRow({
  leading,
  id,
  status,
  title,
  crumb,
  trailing,
  date,
  indent = 0,
  selected = false,
  focused = false,
  onClick,
  onContextMenu,
  onSelectToggle,
  selectLabel = 'Select',
  className,
  role = 'row',
  tabIndex,
  onKeyDown,
  ...rest
}: ListRowProps) {
  const interactive = onClick !== undefined;

  const activate = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (!interactive || event.defaultPrevented) return;
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      role={role}
      tabIndex={tabIndex ?? (interactive ? 0 : undefined)}
      data-slot="list-row"
      data-selected={selected || undefined}
      data-focused={focused || undefined}
      data-indent={indent || undefined}
      aria-selected={onSelectToggle ? selected : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={activate}
      className={cn(
        'group/row relative flex h-9 items-center gap-2 rounded-control px-3 text-[13px] transition-colors duration-100 outline-none hover:bg-surface-hover',
        (selected || focused) && 'bg-surface-hover',
        interactive && 'cursor-pointer',
        indent === 1 && 'ml-6',
        className
      )}
      {...rest}
    >
      {indent === 1 && (
        <span
          aria-hidden
          data-slot="list-row-connector"
          className="border-border-subtle absolute top-0 bottom-0 -left-3 border-l-[0.5px]"
        />
      )}
      {onSelectToggle !== undefined && (
        <span
          data-slot="list-row-select"
          className={cn(
            'flex size-4 shrink-0 items-center justify-center opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 focus-within:opacity-100',
            (selected || focused) && 'opacity-100'
          )}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Checkbox
            aria-label={selectLabel}
            checked={selected}
            onCheckedChange={(next) => onSelectToggle(next)}
          />
        </span>
      )}
      {leading !== undefined && (
        <span
          data-slot="list-row-leading"
          className="text-muted-foreground flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5"
        >
          {leading}
        </span>
      )}
      {id !== undefined && (
        <span
          data-slot="list-row-id"
          className={cn(
            'font-book text-muted-foreground shrink-0 tracking-(--id-tracking) tabular-nums',
            indent === 1 && 'text-muted-foreground/70'
          )}
        >
          {id}
        </span>
      )}
      {status !== undefined && (
        <span
          data-slot="list-row-status"
          className="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5"
        >
          {status}
        </span>
      )}
      <span
        data-slot="list-row-title"
        className="text-foreground min-w-0 flex-1 truncate font-medium"
      >
        {title}
        {crumb !== undefined && (
          <span
            data-slot="list-row-crumb"
            className="font-book text-muted-foreground ml-1.5"
          >
            › {crumb}
          </span>
        )}
      </span>
      {trailing !== undefined && (
        <span
          data-slot="list-row-trailing"
          className="flex shrink-0 items-center gap-1.5"
        >
          {trailing}
        </span>
      )}
      {date !== undefined && (
        <span
          data-slot="list-row-date"
          className="font-book text-muted-foreground shrink-0 text-[12px] tabular-nums"
        >
          {date}
        </span>
      )}
    </div>
  );
}

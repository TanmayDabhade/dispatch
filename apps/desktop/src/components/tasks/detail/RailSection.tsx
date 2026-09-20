import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

// A titled group of rows in the properties rail (Properties, Labels, Blocked by): the
// 13px/500 muted heading Linear stacks its property groups under, with no dividers doing
// the separating.
export function RailSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="rail-section"
      className={cn('flex flex-col gap-0.5', className)}
    >
      <div className="text-muted-foreground flex h-7 items-center px-2 text-[13px] font-medium">
        {title}
      </div>
      {children}
    </div>
  );
}

/** The 32px ghost row every rail property sits on — the same recipe as `PropertyControls`'
 * row variant, so a picker this file's editors open and a status picker read as one. An
 * `unset` row dims to muted and its label reads as the action that fills it. */
export function railRowClass(unset = false): string {
  return cn(
    'flex h-8 w-full min-w-0 items-center gap-2 rounded-control px-2 text-left text-[13px] font-medium text-(--text-secondary) transition-colors duration-100 outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-surface-hover [&_svg:not([class*=size-])]:size-3.5 [&_svg]:shrink-0',
    unset && 'text-muted-foreground'
  );
}

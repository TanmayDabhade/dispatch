import type { Assignee } from '@dispatch/core/browser';

import { colorForProject } from '../../lib/projectColor';
import { assigneeLabel, assigneeRef } from '../../lib/taskDisplay';
import { cn } from '@/lib/utils';
import { InitialsAvatar } from '@/ui/ai/initials-avatar';

export interface AssigneeAvatarProps {
  assignee: Assignee;
  /** The person's display name, for initials (`Wyat Soule` → `WS`). Falls back to the
   * ref's handle, then to the assignee kind. */
  name?: string;
  /** 18px on rows and cards (default); 16px on activity timeline lines. */
  size?: 16 | 18;
  className?: string;
}

// 18px is `InitialsAvatar`'s own size, so only the 16px variant overrides — restating
// `leading-none` because tailwind-merge drops the primitive's when a `text-[…]` size lands.
const SIZE_CLASS: Record<16 | 18, string> = {
  16: 'size-4 text-[8px] leading-none',
  18: '',
};

/**
 * Linear's 18px assignee circle: an agent is `AG` on the in-progress yellow (the one
 * Dispatch-specific thing about assignees — at a glance the board says which cards the
 * fleet owns), a person is their initials on a colour hashed from their name, and unassigned
 * is an empty dashed ring.
 */
export function AssigneeAvatar({
  assignee,
  name,
  size = 18,
  className,
}: AssigneeAvatarProps) {
  const kind = assigneeRef(assignee)?.kind ?? 'none';
  const sizeClass = SIZE_CLASS[size];

  if (kind === 'none') {
    const label = assigneeLabel(assignee);
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        data-slot="assignee-avatar"
        className={cn(
          'inline-block shrink-0 rounded-pill border-[0.5px] border-dashed border-muted-foreground/50',
          sizeClass,
          className
        )}
      />
    );
  }

  if (kind === 'agent') {
    return (
      <InitialsAvatar
        name="Agent"
        title={name ?? assigneeLabel(assignee)}
        color="var(--status-progress)"
        data-kind="agent"
        className={cn(sizeClass, className)}
      />
    );
  }

  const displayName = name ?? assigneeLabel(assignee);
  return (
    <InitialsAvatar
      name={displayName}
      title={displayName}
      color={colorForProject(displayName)}
      data-kind="human"
      className={cn(sizeClass, className)}
    />
  );
}

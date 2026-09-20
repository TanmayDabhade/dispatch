import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Panel, PanelRow } from '@/ui/chrome';

interface SettingsGroupProps {
  /** The 15px section heading above the card. */
  title: string;
  /** One muted line of context under the heading, before the card. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A settings section: a 15px/600 heading, an optional line of context, then the grouped
 * card its rows live in. Every settings page is a stack of these. */
export function SettingsGroup({
  title,
  hint,
  children,
  className,
}: SettingsGroupProps) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-foreground text-[15px] font-semibold">{title}</h2>
        {hint !== undefined && <SettingsHint>{hint}</SettingsHint>}
      </div>
      <Panel>{children}</Panel>
    </section>
  );
}

/** Explanatory prose beside a settings control — 12px/450 muted. */
export function SettingsHint({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn('font-book text-muted-foreground text-[12px]', className)}>
      {children}
    </p>
  );
}

interface SettingsRowProps {
  /** 13px/500. Becomes the control's `<label>` when `htmlFor` names it. */
  title: ReactNode;
  /** 12px muted, under the title. */
  subtitle?: ReactNode;
  htmlFor?: string;
  /** The control, right-aligned — a select pill, a switch, a short input. */
  control?: ReactNode;
  /** Puts the control under the text instead of beside it, for a field that needs the
   * whole width (a command, a URL, a textarea). */
  stacked?: boolean;
  /** Free content after the title/control line — an error, a status line. */
  children?: ReactNode;
  className?: string;
}

/** One row of a settings card: title + subtitle on the left, the control on the right. */
export function SettingsRow({
  title,
  subtitle,
  htmlFor,
  control,
  stacked = false,
  children,
  className,
}: SettingsRowProps) {
  const text = (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
      {htmlFor !== undefined ? (
        <label
          htmlFor={htmlFor}
          className="text-foreground text-[13px] font-medium"
        >
          {title}
        </label>
      ) : (
        <span className="text-foreground text-[13px] font-medium">{title}</span>
      )}
      {subtitle !== undefined && <SettingsHint>{subtitle}</SettingsHint>}
    </div>
  );
  return (
    <PanelRow
      className={cn(
        'flex-col items-stretch gap-1.5 py-2',
        stacked ? 'gap-2' : undefined,
        className
      )}
    >
      <div
        className={cn(
          'flex gap-4',
          stacked ? 'flex-col gap-2' : 'items-center justify-between'
        )}
      >
        {text}
        {control !== undefined && (
          <div
            className={cn(
              'flex shrink-0 items-center gap-2',
              stacked && 'w-full'
            )}
          >
            {control}
          </div>
        )}
      </div>
      {children}
    </PanelRow>
  );
}

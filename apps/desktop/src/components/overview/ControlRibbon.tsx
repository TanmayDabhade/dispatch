import type { FeedState } from '@/lib/feedState';
import { FEED_STATE_LABEL, FEED_STATE_ORDER } from '@/lib/feedState';
import { cn } from '@/lib/utils';
import {
  VIEW_TAB_ACTIVE_CLASS,
  VIEW_TAB_CLASS,
  VIEW_TAB_INACTIVE_CLASS,
} from '@/ui/ai/page-header';
import { StateMark } from '@/ui/chrome/state-mark';

interface ControlRibbonProps {
  counts: Record<FeedState, number>;
  /** Which run-state pills are filtering the feed, so the ribbon can show the same selection. */
  activeStates: ReadonlySet<FeedState>;
  onSelect: (state: FeedState) => void;
}

/**
 * The Control room's state strip as Linear's view-tab pills: one 28px pill per state with
 * its 14px glyph, a 12px/500 label and the count as plain muted text. More than one can be
 * lit — they are filters, not tabs — and a lit pill is the neutral active surface, never a
 * tint: the glyph's hue already says whose move a state is, and a strip of amber pills
 * would read as permanently alarmed.
 */
export function ControlRibbon({
  counts,
  activeStates,
  onSelect,
}: ControlRibbonProps) {
  return (
    <div
      role="group"
      aria-label="Feed states"
      data-slot="control-ribbon"
      className="flex flex-wrap items-center gap-1"
    >
      {FEED_STATE_ORDER.map((state) => {
        const active = activeStates.has(state);
        return (
          <button
            key={state}
            type="button"
            aria-pressed={active}
            data-active={active || undefined}
            data-state={state}
            onClick={() => onSelect(state)}
            className={cn(
              VIEW_TAB_CLASS,
              active ? VIEW_TAB_ACTIVE_CLASS : VIEW_TAB_INACTIVE_CLASS
            )}
          >
            <StateMark state={state} />
            {FEED_STATE_LABEL[state]}
            <span className="font-book text-muted-foreground tabular-nums">
              {counts[state]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

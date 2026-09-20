import { Search } from 'lucide-react';

import type { FeedState } from '@/lib/feedState';
import { FEED_STATE_LABEL, FEED_STATE_ORDER } from '@/lib/feedState';
import { FilterIconButton } from '@/ui/ai/page-header';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group';

interface FeedFilterBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  activeStates: ReadonlySet<FeedState>;
  /** Flips one state in or out of the filter — the ribbon toggles the same set. */
  onToggleState: (state: FeedState) => void;
  /** Clears every state filter. */
  onClearStates: () => void;
  /** Epics with rows in the feed, for the facet menu; `null` selects none. */
  epics: readonly string[];
  activeEpic: string | null;
  onEpicChange: (epic: string | null) => void;
  needsYouOnly: boolean;
  onNeedsYouChange: (value: boolean) => void;
  allCollapsed: boolean;
  onToggleCollapseAll: () => void;
}

/**
 * The Control room header's second-row controls: the search field, a `Collapse all` ghost
 * and the funnel icon button (there is no display popover or side panel here). The funnel
 * opens a small facet menu — state, epic, needs-you — sharing its selection with the ribbon
 * above, so the two can never disagree; the dot on it says a filter is applied.
 */
export function FeedFilterBar({
  query,
  onQueryChange,
  activeStates,
  onToggleState,
  onClearStates,
  epics,
  activeEpic,
  onEpicChange,
  needsYouOnly,
  onNeedsYouChange,
  allCollapsed,
  onToggleCollapseAll,
}: FeedFilterBarProps) {
  const filtered = activeStates.size > 0 || activeEpic !== null || needsYouOnly;
  return (
    <div className="flex items-center gap-1">
      <InputGroup className="h-7 w-56 gap-2 px-2 has-[>[data-align=inline-start]]:[&>input]:pl-0">
        <InputGroupAddon className="p-0">
          <Search className="text-muted-foreground size-3.5 shrink-0" />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter by task, id or epic"
          aria-label="Filter the feed"
          className="h-auto px-0 text-[12px] md:text-[12px]"
        />
      </InputGroup>
      <Button variant="ghost" onClick={onToggleCollapseAll}>
        {allCollapsed ? 'Expand all' : 'Collapse all'}
      </Button>
      {/* The feed has one layout and no side panel; only the triad's funnel earns a button. */}
      <DropdownMenu>
        <DropdownMenuTrigger render={<FilterIconButton active={filtered} />} />
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuCheckboxItem
            checked={needsYouOnly}
            onCheckedChange={(checked) => onNeedsYouChange(checked)}
          >
            Needs you
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>State</DropdownMenuLabel>
          {FEED_STATE_ORDER.map((state) => (
            <DropdownMenuCheckboxItem
              key={state}
              checked={activeStates.has(state)}
              onCheckedChange={() => onToggleState(state)}
            >
              {FEED_STATE_LABEL[state]}
            </DropdownMenuCheckboxItem>
          ))}
          {epics.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Epic</DropdownMenuLabel>
              {epics.map((epic) => (
                <DropdownMenuCheckboxItem
                  key={epic}
                  checked={activeEpic === epic}
                  onCheckedChange={(checked) =>
                    onEpicChange(checked ? epic : null)
                  }
                >
                  {epic}
                </DropdownMenuCheckboxItem>
              ))}
            </>
          )}
          {filtered && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  onClearStates();
                  onEpicChange(null);
                  onNeedsYouChange(false);
                }}
              >
                Clear filters
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

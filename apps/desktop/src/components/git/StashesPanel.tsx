import type { GitStash } from '@dispatch/client';
import { Trash2, Undo2 } from 'lucide-react';

import { formatRelativeTimeFromIso } from '@/lib/format';
import { IconButton } from '@/ui/ai/icon-button';
import { ListRow } from '@/ui/ai/list-row';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';

interface StashesPanelProps {
  stashes: GitStash[];
  loading: boolean;
  busy: boolean;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onPop: (index: number) => void;
  onRequestDrop: (stash: GitStash) => void;
}

/** Panel 5: the stash list. Pop and drop are both one click; drop routes through the caller's
 * confirmation dialog since it's the one irreversible stash action. */
export function StashesPanel({
  stashes,
  loading,
  busy,
  selectedIndex,
  onSelectIndex,
  onPop,
  onRequestDrop,
}: StashesPanelProps) {
  if (loading) {
    return (
      <div className="text-muted-foreground font-book px-3 py-2 text-[13px]">
        Loading…
      </div>
    );
  }
  if (stashes.length === 0) {
    return (
      <div className="text-muted-foreground font-book px-3 py-2 text-[13px]">
        No stashes.
      </div>
    );
  }

  return (
    <div className="flex flex-col px-1 py-1" role="list" aria-label="Stashes">
      {stashes.map((stash, index) => (
        <ListRow
          key={stash.ref}
          data-git-selected={index === selectedIndex ? 'true' : undefined}
          onClick={() => onSelectIndex(index)}
          focused={index === selectedIndex}
          role="listitem"
          title={stash.message}
          trailing={
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <IconButton
                      label="Pop (S)"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPop(stash.index);
                      }}
                    />
                  }
                >
                  <Undo2 />
                </TooltipTrigger>
                <TooltipContent>Pop (S)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <IconButton
                      label="Drop"
                      className="hover:text-state-failed"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestDrop(stash);
                      }}
                    />
                  }
                >
                  <Trash2 />
                </TooltipTrigger>
                <TooltipContent>Drop</TooltipContent>
              </Tooltip>
            </>
          }
          date={formatRelativeTimeFromIso(stash.date)}
        />
      ))}
    </div>
  );
}

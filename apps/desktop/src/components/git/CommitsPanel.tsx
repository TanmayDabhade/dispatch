import type { GitLogEntry } from '@dispatch/client';

import { formatRelativeTimeFromIso } from '@/lib/format';
import { ListRow } from '@/ui/ai/list-row';

interface CommitsPanelProps {
  commits: GitLogEntry[];
  loading: boolean;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
}

/** Panel 4: the commit log for whichever branch is selected in the Branches panel (or HEAD
 * when none is). Selecting a row shows that commit's diff in the right pane. */
export function CommitsPanel({
  commits,
  loading,
  selectedIndex,
  onSelectIndex,
}: CommitsPanelProps) {
  if (loading) {
    return (
      <div className="text-muted-foreground font-book px-3 py-2 text-[13px]">
        Loading…
      </div>
    );
  }
  if (commits.length === 0) {
    return (
      <div className="text-muted-foreground font-book px-3 py-2 text-[13px]">
        No commits.
      </div>
    );
  }

  return (
    <div className="flex flex-col px-1 py-1" role="table">
      {commits.map((commit, index) => (
        <ListRow
          key={commit.sha}
          data-git-selected={index === selectedIndex ? 'true' : undefined}
          onClick={() => onSelectIndex(index)}
          selected={index === selectedIndex}
          id={commit.shortSha}
          title={commit.subject}
          trailing={
            <span className="text-muted-foreground font-book max-w-32 truncate text-[12px]">
              {commit.author}
            </span>
          }
          date={formatRelativeTimeFromIso(commit.date)}
        />
      ))}
    </div>
  );
}

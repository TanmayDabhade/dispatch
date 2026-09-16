import type { GitStatus } from '@dispatch/client';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Download,
  GitBranch,
  Upload,
} from 'lucide-react';

import { PillButton } from '@/ui/ai/pill';

interface StatusPanelProps {
  status: GitStatus | undefined;
  loading: boolean;
  busy: boolean;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onResolveConflicts: () => void;
}

/** Panel 1: current branch, upstream, ahead/behind, remote actions (fetch/pull/push), and a
 * conflict callout with a one-click path to an agent instead of a bare warning. */
export function StatusPanel({
  status,
  loading,
  busy,
  onFetch,
  onPull,
  onPush,
  onResolveConflicts,
}: StatusPanelProps) {
  if (loading || status === undefined) {
    return (
      <div className="text-muted-foreground font-book px-3 py-2 text-[13px]">
        Loading…
      </div>
    );
  }

  const hasConflicts = status.conflicted.length > 0;

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex h-7 items-center gap-2">
        <GitBranch className="text-muted-foreground size-3.5 shrink-0" />
        <span className="truncate text-[13px] font-medium">
          {status.branch ?? 'detached HEAD'}
        </span>
      </div>
      {status.upstream !== null && (
        <div className="text-muted-foreground font-book flex items-center gap-3 text-[12px] tabular-nums">
          <span className="truncate">{status.upstream}</span>
          <span className="flex items-center gap-1">
            <ArrowUp className="size-3" />
            {status.ahead}
          </span>
          <span className="flex items-center gap-1">
            <ArrowDown className="size-3" />
            {status.behind}
          </span>
        </div>
      )}

      {hasConflicts && (
        <div className="bg-state-failed-surface text-state-failed rounded-card font-book flex flex-col gap-2 px-2.5 py-2 text-[12px]">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" />
            {status.conflicted.length} conflicted file
            {status.conflicted.length === 1 ? '' : 's'}
          </span>
          <PillButton className="self-start" onClick={onResolveConflicts}>
            Ask an agent to resolve
          </PillButton>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <PillButton disabled={busy} onClick={onFetch} title="Fetch (f)">
          <Download />
          Fetch
        </PillButton>
        <PillButton disabled={busy} onClick={onPull} title="Pull (p)">
          <ArrowDown />
          Pull
        </PillButton>
        <PillButton disabled={busy} onClick={onPush} title="Push (P)">
          <Upload />
          Push
        </PillButton>
      </div>
    </div>
  );
}

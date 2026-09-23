import type { BoardSyncStatus } from '@dispatch/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

import type { DispatchProjectData } from '../../hooks/useDispatchProject';
import { SettingsGroup, SettingsHint, SettingsRow } from './SettingsGroup';
import { Button } from '@/ui/button';

interface BoardSyncGroupProps {
  data: DispatchProjectData;
}

/** When the last pass ran, as a person reads it. */
export function syncedWhen(status: BoardSyncStatus): string {
  if (!status.enabled) return 'Off';
  if (status.lastSyncAt === null) return 'Not synced yet';
  return `Synced ${new Date(status.lastSyncAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/**
 * Settings → Board sync, top of the page: whether this board is shared with
 * teammates over git, and whether that is working. Everything here
 * is what `dispatch sync status` prints, for someone who does not live in a
 * terminal — including the one thing sync cannot fix alone, a task created
 * separately on two machines under one id.
 */
export function BoardSyncGroup({ data }: BoardSyncGroupProps) {
  const { client } = data;
  const queryClient = useQueryClient();
  const key = ['dispatch-sync-status', client?.baseUrl];
  const [syncing, setSyncing] = useState(false);
  const { data: status } = useQuery({
    queryKey: key,
    queryFn: () => {
      if (client === null) throw new Error('dispatchd client not ready');
      return client.fetchBoardSyncStatus();
    },
    enabled: client !== null,
    // A teammate's change can arrive at any time; keep the line current
    // without anyone pressing anything.
    refetchInterval: 15_000,
  });

  if (status === undefined) return null;

  if (!status.enabled) {
    return (
      <SettingsGroup title="Status" keywords="board sync">
        <SettingsRow
          title="Not sharing"
          subtitle="Turn on sharing below, then restart Dispatch for this project."
          keywords="off sync"
        />
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup title="Status" keywords="board sync">
      <SettingsRow
        title={syncedWhen(status)}
        keywords="sync now last synced"
        subtitle={
          <span className="font-mono">
            {status.branch} on {status.remote}
          </span>
        }
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={client === null || syncing}
            onClick={() => {
              if (client === null) return;
              setSyncing(true);
              void client
                .syncBoardNow()
                .then((next) => queryClient.setQueryData(key, next))
                .finally(() => setSyncing(false));
            }}
          >
            <RefreshCw />
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        }
      >
        {status.paused !== null && (
          <SettingsHint className="text-(--state-waiting-fg)">
            {status.paused}
          </SettingsHint>
        )}
        {status.lastError !== null && (
          <SettingsHint className="text-(--state-waiting-fg)">
            Couldn&rsquo;t reach the remote: {status.lastError}. Your changes
            are safe here and go out on the next successful sync.
          </SettingsHint>
        )}
        {status.pending > 0 && (
          <SettingsHint>
            {status.pending} change{status.pending === 1 ? '' : 's'} waiting to
            be sent.
          </SettingsHint>
        )}
      </SettingsRow>
      {status.problems.map((problem) => (
        <SettingsRow
          key={problem.task}
          title={`Needs your attention: ${problem.task}`}
          subtitle={problem.message}
        />
      ))}
    </SettingsGroup>
  );
}

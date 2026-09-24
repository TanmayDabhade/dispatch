import type { LinearSyncSummary, LinearViewer } from '@dispatch/client';
import { statusModelOf } from '@dispatch/core/browser';
import type { StatusRoles } from '@dispatch/core/browser';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { DispatchProjectData } from '../../hooks/useDispatchProject';
import { formatRelativeTimeFromIso } from '../../lib/format';
import {
  describeFetchFailure,
  describeLinearDelivery,
  formatLinearProgress,
  formatSyncCounts,
  isLinearConfigured,
  linearKeySourceNote,
  STATUS_ROLE_ROWS,
} from '../../lib/linearSettings';
import { SettingsGroup, SettingsHint, SettingsRow } from './SettingsGroup';
import { cn } from '@/lib/utils';
import { PillButton } from '@/ui/ai/pill';
import { Switch } from '@/ui/ai/switch';
import { Button } from '@/ui/button';
import { PanelRow } from '@/ui/chrome';
import { Input } from '@/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select';

const LINEAR_DIRECTIONS: { value: 'both' | 'pull' | 'push'; label: string }[] =
  [
    { value: 'both', label: 'Pull and push' },
    { value: 'pull', label: 'Pull only (Linear → Dispatch)' },
    { value: 'push', label: 'Push only (Dispatch → Linear)' },
  ];

// A select value for "no status": native select values can't be empty.
const NO_STATUS = '__none__';

// Free-typed while focused, snapped back to the saved value on blur if it isn't a valid
// interval (mirrors AgentsSection's concurrency input).
function LinearIntervalRow({
  value,
  onSave,
}: {
  value: number;
  onSave: (intervalSec: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <SettingsRow
      title="Poll interval"
      subtitle="Seconds between sync passes when no webhook delivers changes, minimum 30."
      htmlFor="linear-poll-interval"
      control={
        <Input
          id="linear-poll-interval"
          aria-label="Poll interval"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number(draft);
            if (Number.isInteger(n) && n >= 30 && n !== value) {
              onSave(n);
            } else {
              setDraft(String(value));
            }
          }}
          inputMode="numeric"
          className="w-20 text-right tabular-nums"
        />
      }
    />
  );
}

/** One lifecycle role: which of the team's statuses Dispatch writes for it. */
function StatusRoleRow({
  title,
  subtitle,
  value,
  statuses,
  optional,
  onChange,
}: {
  title: string;
  subtitle: string;
  value: string | null;
  statuses: readonly string[];
  optional: boolean;
  onChange: (status: string | null) => void;
}) {
  return (
    <SettingsRow
      title={title}
      subtitle={subtitle}
      control={
        <Select
          value={value ?? NO_STATUS}
          onValueChange={(next) => onChange(next === NO_STATUS ? null : next)}
        >
          <SelectTrigger aria-label={`${title} status`} className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {optional && <SelectItem value={NO_STATUS}>None</SelectItem>}
            {statuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

/** A failed teams fetch, rendered above the control it starved — the actionable reason
 *  plus a retry, instead of letting the picker sit there empty with no explanation. */
function FetchFailureRow({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <PanelRow className="flex-nowrap gap-3">
      <span className="text-state-failed min-w-0 flex-1 text-[12px]">
        {describeFetchFailure(error)}
      </span>
      <PillButton onClick={onRetry}>Retry</PillButton>
    </PanelRow>
  );
}

/** Linear sync settings: connect a write-only API key, pick the team/direction/interval,
 *  choose which of the team's statuses each lifecycle role writes, and run a sync on demand. */
export function LinearPanel({ data }: { data: DispatchProjectData }) {
  const { linearStatus, linearTeams, config } = data;
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  // Populated only by a fresh connect response — the status endpoint deliberately reports no
  // identity, just where a key was found, so this is the one place a viewer name can come from.
  const [viewer, setViewer] = useState<LinearViewer | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<LinearSyncSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<LinearSyncSummary | null>(
    null
  );

  if (config === null || linearStatus === null) return null;

  async function connect() {
    const key = apiKey.trim();
    if (key === '') return;
    setConnecting(true);
    setConnectError(null);
    try {
      const result = await data.handleConnectLinear(key);
      setViewer(result.viewer);
      setApiKey('');
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      await data.handleDisconnectLinear();
      setViewer(null);
      setSyncResult(null);
    } catch (err) {
      setDisconnectError(err instanceof Error ? err.message : String(err));
    } finally {
      setDisconnecting(false);
    }
  }

  async function importFromLinear() {
    setImporting(true);
    setImportError(null);
    try {
      setImportResult(await data.handleImportLinear());
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setSyncError(null);
    try {
      setSyncResult(await data.handleSyncLinear());
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  const configured = isLinearConfigured(linearStatus);
  const teamChosen =
    config.linear.teamId !== null && config.linear.teamId.trim() !== '';
  const roles = statusModelOf(config).roles;
  function setRole(key: keyof StatusRoles, status: string | null) {
    void data.handleUpdateConfig({ statusRoles: { ...roles, [key]: status } });
  }
  // Whichever summary is freshest: this session's own "Sync now" result, or the last pass the
  // daemon ran (on a timer, on a task edit, or before this window opened).
  const summary = syncResult ?? linearStatus.lastSummary;
  // `lastError` is disk-persisted and outlives a daemon restart, unlike `summary` (in-memory,
  // reset on restart) — shown on its own unless the current summary already carries it.
  const lastErrorInSummary =
    summary !== null &&
    linearStatus.lastError !== null &&
    summary.errors.includes(linearStatus.lastError);
  // The input stays available while an env or shared key is resolving — that is the only way
  // to give this project a key of its own. It disappears once the project has one.
  const keyNote = linearKeySourceNote(linearStatus.keySource);
  const progress = linearStatus.progress ?? null;
  const conflicts = linearStatus.conflicts;

  return (
    <>
      <SettingsGroup
        title="Linear"
        hint="Keeps this project’s tasks and one Linear team as two faithful copies: every field both ways, the team’s projects and initiatives as containers, its workflow states as your statuses, its members as your people, and issue comments as task comments. When both sides change the same field, the newer edit wins and the task’s Activity says so. The API key stays in ~/.dispatch/credentials.json, never in the repo."
      >
        {linearStatus.keySource !== 'project' && (
          <SettingsRow
            title="API key"
            subtitle={keyNote}
            htmlFor="linear-api-key"
            stacked
            control={
              <>
                <Input
                  id="linear-api-key"
                  type="password"
                  autoComplete="off"
                  placeholder="Linear API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="max-w-xs"
                />
                <Button
                  disabled={connecting || apiKey.trim() === ''}
                  onClick={() => void connect()}
                >
                  {connecting ? 'Connecting…' : 'Connect'}
                </Button>
              </>
            }
          >
            {connectError !== null && (
              <span className="text-state-failed text-[12px]">
                {connectError}
              </span>
            )}
          </SettingsRow>
        )}

        {linearStatus.connected && (
          <>
            <SettingsRow
              title={
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="text-state-review size-3.5 shrink-0" />
                  Connected{viewer !== null ? ` as ${viewer.name}` : ''}
                </span>
              }
              control={
                linearStatus.keySource === 'project' ? (
                  <PillButton
                    disabled={disconnecting}
                    onClick={() => void disconnect()}
                  >
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </PillButton>
                ) : undefined
              }
            >
              {disconnectError !== null && (
                <span className="text-state-failed text-[12px]">
                  {disconnectError}
                </span>
              )}
            </SettingsRow>

            <SettingsRow
              title="Sync this project with Linear"
              subtitle={teamChosen ? undefined : 'Choose a team first.'}
              htmlFor="linear-enabled"
              control={
                <Switch
                  id="linear-enabled"
                  checked={config.linear.enabled}
                  disabled={!configured}
                  onCheckedChange={(checked) =>
                    void data.handleUpdateConfig({
                      linear: { enabled: checked },
                    })
                  }
                />
              }
            />

            {data.linearTeamsError !== null && (
              <FetchFailureRow
                error={data.linearTeamsError}
                onRetry={() => data.refetchLinearTeams()}
              />
            )}

            <SettingsRow
              title="Team"
              control={
                <Select
                  value={config.linear.teamId ?? ''}
                  onValueChange={(teamId) =>
                    void data.handleUpdateConfig({ linear: { teamId } })
                  }
                >
                  <SelectTrigger aria-label="Team" className="w-[200px]">
                    <SelectValue placeholder="Choose a team" />
                  </SelectTrigger>
                  <SelectContent>
                    {linearTeams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name} ({team.key})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />

            <SettingsRow
              title="Direction"
              control={
                <Select
                  value={config.linear.direction}
                  onValueChange={(direction) =>
                    void data.handleUpdateConfig({
                      linear: {
                        direction: direction as 'both' | 'pull' | 'push',
                      },
                    })
                  }
                >
                  <SelectTrigger aria-label="Direction" className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINEAR_DIRECTIONS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />

            <LinearIntervalRow
              value={config.linear.intervalSec}
              onSave={(intervalSec) =>
                void data.handleUpdateConfig({ linear: { intervalSec } })
              }
            />

            <SettingsRow
              title="Send Acceptance Criteria to Linear"
              subtitle="Adds it to the issue description as its own section, so teammates see it."
              htmlFor="linear-acceptance"
              control={
                <Switch
                  id="linear-acceptance"
                  checked={config.linear.includeAcceptanceCriteria}
                  onCheckedChange={(checked) =>
                    void data.handleUpdateConfig({
                      linear: { includeAcceptanceCriteria: checked },
                    })
                  }
                />
              }
            />
          </>
        )}
      </SettingsGroup>

      {linearStatus.connected && teamChosen && (
        <SettingsGroup
          title="Status roles"
          hint="Your statuses are the team’s workflow states, kept in step on every sync. Each role picks the one Dispatch writes as work moves; a role you change here is kept across syncs."
        >
          {STATUS_ROLE_ROWS.map((row) => (
            <StatusRoleRow
              key={row.key}
              title={row.title}
              subtitle={row.subtitle}
              value={roles[row.key]}
              statuses={config.statuses}
              optional={row.key === 'landing'}
              onChange={(status) => setRole(row.key, status)}
            />
          ))}
        </SettingsGroup>
      )}

      {linearStatus.connected && (
        <SettingsGroup title="Sync">
          <SettingsRow
            title="Changes"
            subtitle={describeLinearDelivery(linearStatus)}
          />

          <SettingsRow
            title="Import from Linear"
            subtitle="Sync only moves what changes after a task is linked — it never bulk-imports the backlog on its own. Import brings down every issue, project and comment in this team that has no matching task yet."
            control={
              <PillButton
                disabled={importing || !configured}
                onClick={() => void importFromLinear()}
              >
                {importing ? 'Importing…' : 'Import from Linear'}
              </PillButton>
            }
          >
            {progress !== null && (
              <SettingsHint>{formatLinearProgress(progress)}</SettingsHint>
            )}
            {importResult !== null && (
              <SettingsHint>{formatSyncCounts(importResult)}</SettingsHint>
            )}
            {importError !== null && (
              <span className="text-state-failed text-[12px]">
                {importError}
              </span>
            )}
          </SettingsRow>

          <SettingsRow
            title="Sync now"
            subtitle={
              linearStatus.lastSyncAt !== null
                ? `Last sync ${formatRelativeTimeFromIso(linearStatus.lastSyncAt)}.`
                : 'Not synced yet.'
            }
            control={
              <PillButton
                disabled={syncing || linearStatus.syncing || !configured}
                onClick={() => void sync()}
              >
                <RefreshCw
                  className={cn(
                    'size-3.5',
                    (syncing || linearStatus.syncing) &&
                      'animate-spin motion-reduce:animate-none'
                  )}
                />
                {syncing || linearStatus.syncing ? 'Syncing…' : 'Sync now'}
              </PillButton>
            }
          >
            {linearStatus.lastError !== null && !lastErrorInSummary && (
              <span className="text-state-failed text-[12px]">
                {linearStatus.lastError}
              </span>
            )}
            {summary !== null && (
              <div className="flex flex-col gap-1">
                <SettingsHint>{formatSyncCounts(summary)}</SettingsHint>
                {summary.errors.map((message, i) => (
                  <span
                    key={`${message}-${String(i)}`}
                    className="text-state-failed text-[12px]"
                  >
                    {message}
                  </span>
                ))}
                {summary.rateLimited && (
                  <span className="text-state-failed text-[12px]">
                    Linear rate-limited this pass — it will retry on its own.
                  </span>
                )}
              </div>
            )}
            {syncError !== null && (
              <span className="text-state-failed text-[12px]">{syncError}</span>
            )}
          </SettingsRow>

          {conflicts !== undefined && conflicts.total > 0 && (
            <SettingsRow
              title="Conflicts resolved"
              subtitle={`${String(conflicts.total)} field(s) changed on both sides since the link; the newer edit won each, and the task’s Activity notes it.`}
            />
          )}
        </SettingsGroup>
      )}
    </>
  );
}

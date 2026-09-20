import { useQueryClient } from '@tanstack/react-query';
import { Terminal, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { ensureDispatchd } from '../lib/tauri';
import { PageHeader } from '@/ui/ai/page-header';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/chrome';
import { Spinner } from '@/ui/spinner';

/** The `.dispatch/` path chip — a path, so it keeps the code face. */
function PathChip({ children }: { children: string }) {
  return (
    <code className="bg-surface-quaternary rounded-chip border-border-chip border-[0.5px] px-1 py-0.5 font-mono text-[11px] break-all">
      {children}
    </code>
  );
}

interface GetStartedViewProps {
  /** Absolute path of the one project this window is scoped to — shown here specifically
   * because `hasDispatch(projectPath)` came back `false`, i.e. it has no `.dispatch/`
   * tracker yet. */
  projectPath: string;
}

/**
 * First-run / no-tracker screen: shown whenever the app's single active project (see
 * `App.tsx`'s `currentProjectRoot()` resolution) doesn't have a `.dispatch/` tracker yet.
 * The "Initialize project" button drives `ensureDispatchd`, whose Rust sidecar spawns
 * dispatchd with `--init` for a root missing `.dispatch/tasks` (see
 * `sidecar::needs_init`/`BunSpawner::spawn`) — `bin.ts`'s `--init` handling runs
 * `TaskStore.init` before the server starts, so by the time that promise resolves the
 * tracker is already on disk.
 *
 * There is deliberately no copy-paste `dispatch init` command here: a packaged release of
 * this app ships no `dispatch` CLI on `PATH`, so showing one just hands the user a "command
 * not found" dead end. Initialize is the only supported path from this screen.
 */
export function GetStartedView({ projectPath }: GetStartedViewProps) {
  const queryClient = useQueryClient();

  // `initState` tracks the button's own in-flight request; `initError` holds the thrown
  // message (or `null` once cleared by a fresh attempt) — now potentially several lines
  // long (see `ensureDispatchd`'s doc comment on the backend), since a health-wait timeout
  // includes which launch path ran plus a tail of the daemon's own stdout/stderr.
  const [initState, setInitState] = useState<'idle' | 'pending'>('idle');
  const [initError, setInitError] = useState<string | null>(null);

  // Boots dispatchd for this root with `--init` (see this component's doc comment). On
  // success, the daemon has already created `.dispatch/tasks` before `ensureDispatchd`'s
  // promise resolves, so refetching the gate query is sufficient to flip `App` over to the
  // workspace — no extra polling/delay needed.
  async function initialize() {
    setInitState('pending');
    setInitError(null);
    try {
      await ensureDispatchd(projectPath);
      await queryClient.invalidateQueries({
        queryKey: ['has-dispatch', projectPath],
      });
    } catch (err) {
      setInitError(err instanceof Error ? err.message : String(err));
    } finally {
      setInitState('idle');
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumb={['Get started']} />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto px-6 py-4">
        <EmptyState
          className="pt-20"
          illustration={<Terminal aria-hidden />}
          heading="Get started with Dispatch"
          description={
            <>
              Dispatch tracks tasks as files inside a project&rsquo;s own{' '}
              <PathChip>.dispatch/</PathChip> directory. Initialize it below —
              its Board, Tasks, and Plans will take over automatically once
              it&rsquo;s ready.
            </>
          }
          action={
            <Button
              onClick={() => void initialize()}
              disabled={initState === 'pending'}
              className="rounded-pill"
            >
              {initState === 'pending' ? (
                <>
                  <Spinner className="size-3.5" /> Initializing…
                </>
              ) : (
                'Initialize project'
              )}
            </Button>
          }
        />

        {initError !== null && (
          <div className="bg-state-failed-surface text-state-failed rounded-card flex w-full max-w-[540px] items-start gap-2 px-3 py-2.5 text-left text-[13px]">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <pre className="max-h-48 min-w-0 flex-1 overflow-auto font-mono text-[12px] break-words whitespace-pre-wrap">
              {initError}
            </pre>
          </div>
        )}

        <p className="text-muted-foreground font-book max-w-[340px] text-center text-[12px] leading-relaxed">
          Initialize creates a <PathChip>.dispatch/</PathChip> tracker folder in{' '}
          <PathChip>{projectPath}</PathChip>.
        </p>
      </div>
    </div>
  );
}

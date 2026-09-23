import { FolderSearch, SearchIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AgentsSection } from '../components/settings/AgentsSection';
import { DaemonSection } from '../components/settings/DaemonSection';
import { DiffsSection } from '../components/settings/DiffsSection';
import { GeneralSection } from '../components/settings/GeneralSection';
import { IntegrationsSection } from '../components/settings/IntegrationsSection';
import { NotificationsSection } from '../components/settings/NotificationsSection';
import { PolicySection } from '../components/settings/PolicySection';
import { TeamSection } from '../components/settings/TeamSection';
import type { DispatchProjectData } from '../hooks/useDispatchProject';
import type { SettingsPage } from '../lib/appNav';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/ui/ai/page-header';
import {
  SIDEBAR_ROW_ACTIVE_CLASS,
  SIDEBAR_ROW_CLASS,
  SIDEBAR_ROW_INACTIVE_CLASS,
} from '@/ui/ai/sidebar-nav';
import { EmptyState } from '@/ui/chrome';
import { Input } from '@/ui/input';

interface SettingsViewProps {
  /** Just `{ path, name }`, the same minimal shape `App.tsx` derives from
   *  `currentProjectRoot()` — not the full observability-database `ProjectSummary`. */
  activeProject: { path: string; name: string } | null;
  data: DispatchProjectData;
  /** Opens a task's full view — the Autonomy page's receipts link through to
   *  the task ledger that holds each auto-decision. */
  onOpenTask?: (taskId: string) => void;
  /** The page to open on — `navState.settingsPage`, which the rail's Connect Linear and
   *  the strip's gear set to Integrations. A new value while mounted switches the page. */
  initialPage?: SettingsPage;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

/** The settings nav, in order: one `Project` group of pages. The label doubles as the
 * page's H1. */
const SETTINGS_PAGES: { id: SettingsPage; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'team', label: 'Team' },
  { id: 'autonomy', label: 'Autonomy' },
  { id: 'agents', label: 'Agents' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'daemon', label: 'Daemon' },
  { id: 'diffs', label: 'Diffs' },
];

/** Settings for the active project, laid out as Linear's settings shell: a 200px nav of
 *  pages on the left, the selected page as a centred column on the right. Every page but
 *  Diffs saves through the one `save` here and its one indicator beside the page title;
 *  Diffs is a local display preference with its own storage and no save state. */
export function SettingsView({
  activeProject,
  data,
  onOpenTask,
  initialPage,
}: SettingsViewProps) {
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [page, setPage] = useState<SettingsPage>(initialPage ?? 'general');
  const [query, setQuery] = useState('');

  // A request that arrives while Settings is already mounted (the gear pressed from the
  // General page) still lands; the nav rows keep working in between.
  useEffect(() => {
    if (initialPage !== undefined) setPage(initialPage);
  }, [initialPage]);

  // The one save path every config-backed section's onSave goes through, so
  // one indicator covers those pages instead of each section reporting on its own.
  const save = useCallback(
    async (patch: Parameters<DispatchProjectData['handleUpdateConfig']>[0]) => {
      setSaveState({ kind: 'saving' });
      try {
        await data.handleUpdateConfig(patch);
        setSaveState({ kind: 'saved' });
      } catch (err) {
        setSaveState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [data]
  );

  if (activeProject === null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader crumb={['Settings']} />
        <EmptyState
          icon={FolderSearch}
          heading="No project selected"
          description="Pick a project in the sidebar."
          className="flex-1"
        />
      </div>
    );
  }

  // IntegrationsSection only takes `data`, and LinearPanel calls
  // `data.handleUpdateConfig` directly — swap in `save` so it uses the same path.
  const integrationsData: DispatchProjectData = {
    ...data,
    handleUpdateConfig: save,
  };

  const needle = query.trim().toLowerCase();
  const visiblePages =
    needle === ''
      ? SETTINGS_PAGES
      : SETTINGS_PAGES.filter((entry) =>
          entry.label.toLowerCase().includes(needle)
        );
  const title =
    SETTINGS_PAGES.find((entry) => entry.id === page)?.label ?? 'Settings';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumb={['Settings']} />
      <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)]">
        <nav
          aria-label="Settings"
          className="shadow-hairline-right flex min-h-0 flex-col gap-3 overflow-y-auto px-2 py-3"
        >
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
            />
            <Input
              type="search"
              aria-label="Search settings"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-7"
            />
          </div>
          <div>
            <div className="text-muted-foreground flex h-7 items-center px-2 text-[12px] font-medium">
              Project
            </div>
            <div className="flex flex-col gap-px">
              {visiblePages.map((entry) => {
                const active = entry.id === page;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setPage(entry.id)}
                    className={cn(
                      SIDEBAR_ROW_CLASS,
                      active
                        ? SIDEBAR_ROW_ACTIVE_CLASS
                        : SIDEBAR_ROW_INACTIVE_CLASS
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {entry.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        <div className="min-h-0 overflow-y-auto px-6 py-4">
          <div className="mx-auto flex w-full max-w-[540px] flex-col gap-6 pb-8">
            <div className="flex items-baseline gap-3">
              <h1 className="text-foreground text-[24px] leading-8 font-semibold tracking-[-0.16px]">
                {title}
              </h1>
              {page !== 'diffs' && (
                <span
                  className={cn(
                    'font-book text-[12px]',
                    saveState.kind === 'error'
                      ? 'text-state-failed'
                      : 'text-muted-foreground'
                  )}
                >
                  {saveState.kind === 'saving' && 'Saving…'}
                  {saveState.kind === 'saved' &&
                    'Saved to .dispatch/config.yml'}
                  {saveState.kind === 'error' && saveState.message}
                </span>
              )}
            </div>

            {page === 'general' && data.config !== null && (
              <GeneralSection config={data.config} onSave={save} />
            )}
            {page === 'team' && <TeamSection data={data} />}
            {page === 'autonomy' && data.config !== null && (
              <PolicySection
                config={data.config}
                onSave={save}
                client={data.client}
                onOpenTask={onOpenTask}
              />
            )}
            {page === 'agents' && data.config !== null && (
              <AgentsSection config={data.config} onSave={save} />
            )}
            {page === 'integrations' && (
              <IntegrationsSection data={integrationsData} />
            )}
            {page === 'notifications' && data.config !== null && (
              <NotificationsSection config={data.config} onSave={save} />
            )}
            {page === 'daemon' && (
              <DaemonSection activeProject={activeProject} data={data} />
            )}
            {page === 'diffs' && <DiffsSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

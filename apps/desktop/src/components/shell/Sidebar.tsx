import type { DraftRecord } from '@dispatch/client';
import {
  Brain,
  GitBranch,
  GitMerge,
  Inbox,
  LayoutDashboard,
  Link2,
  ListChecks,
  NotebookPen,
  Play,
  Radar,
  Search,
  Shield,
  Sparkles,
  SquarePen,
  Waypoints,
} from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { GlobalView, ProjectView } from '../../lib/appNav';
import type { PaletteView } from '../../lib/paletteEntries';
import { isTauri } from '../../lib/tauri';
import { DraftTrayPopover } from './DraftTray';
import { cn } from '@/lib/utils';
import { IconButton } from '@/ui/ai/icon-button';
import {
  SidebarNav,
  type SidebarNavItem,
  type SidebarNavSection,
} from '@/ui/ai/sidebar-nav';
import { Sidebar as SidebarRoot } from '@/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';

/**
 * The Workspace section, in the order work moves through the app: capture, plan, the
 * agents work, you land it. Inbox is not here — it leads the fixed top group above.
 */
const WORKSPACE_VIEWS: {
  id: ProjectView;
  label: string;
  icon: typeof Inbox;
}[] = [
  { id: 'overview', label: 'Control room', icon: LayoutDashboard },
  { id: 'brain-dump', label: 'Brain dump', icon: Brain },
  { id: 'plans', label: 'Plans', icon: NotebookPen },
  // Board, list and milestones are header view tabs inside Tasks now, not rail rows.
  { id: 'board', label: 'Tasks', icon: ListChecks },
  // Blast radius of a file, run, or task's declared writes.
  { id: 'impact', label: 'Impact', icon: Waypoints },
  { id: 'branches', label: 'Git', icon: GitBranch },
  // Every open PR with its gates plus what already landed.
  { id: 'landing', label: 'Landing', icon: GitMerge },
];

/** Every project destination in rail order — Inbox first, then Workspace — which is also the
 * ⌘N order: ⌘1 is the first row, and so on. App indexes into this for `goto-N`. */
export const PROJECT_NAV_VIEWS: PaletteView[] = [
  { id: 'inbox', label: 'Inbox' },
  ...WORKSPACE_VIEWS.map(({ id, label }) => ({ id, label })),
];

export const PROJECT_VIEW_ORDER: ProjectView[] = PROJECT_NAV_VIEWS.map(
  (v) => v.id
);

const FLEET_VIEWS: { id: GlobalView; label: string; icon: typeof Radar }[] = [
  { id: 'all-agents', label: 'All agents', icon: Radar },
  { id: 'sessions', label: 'Sessions', icon: Play },
];

// Persists whether the rail is hidden, so the choice survives a reload.
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'dispatch:sidebar-collapsed';

function readStoredSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
}

/**
 * The hidden-rail preference, kept here beside the rail it describes but applied by App's
 * `SidebarProvider`, which owns the open/closed state the whole shell reads.
 */
export function useSidebarCollapsed(): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState(readStoredSidebarCollapsed);
  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      collapsed ? '1' : '0'
    );
  }, [collapsed]);
  // A plain setter, not React's raw one: `SidebarProvider` always hands back a resolved
  // open/closed value, so the updater overload is not part of this hook's contract.
  const set = useCallback((next: boolean) => setCollapsed(next), []);
  return [collapsed, set];
}

/** The collapsible sections' ids — also the keys in the persisted map. */
export type SidebarSectionId = 'workspace' | 'fleet' | 'live' | 'try';

// Which sections the user has folded, as a JSON map. The Try block is the one that folds
// itself: it is open on a fresh install and collapses the first time one of its rows is
// used, since by then it has done its job.
const SIDEBAR_SECTIONS_STORAGE_KEY = 'dispatch:sidebar-sections';

type SectionState = Partial<Record<SidebarSectionId, boolean>>;

function readStoredSections(): SectionState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as SectionState)
      : {};
  } catch {
    return {};
  }
}

/** The persisted collapsed/expanded state of each rail section. */
function useSidebarSections(): {
  collapsed: (id: SidebarSectionId) => boolean;
  toggle: (id: SidebarSectionId) => void;
  collapse: (id: SidebarSectionId) => void;
} {
  const [state, setState] = useState<SectionState>(readStoredSections);
  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_SECTIONS_STORAGE_KEY,
      JSON.stringify(state)
    );
  }, [state]);
  const collapsed = useCallback(
    (id: SidebarSectionId) => state[id] === true,
    [state]
  );
  const toggle = useCallback(
    (id: SidebarSectionId) =>
      setState((prev) => ({ ...prev, [id]: prev[id] !== true })),
    []
  );
  const collapse = useCallback(
    (id: SidebarSectionId) => setState((prev) => ({ ...prev, [id]: true })),
    []
  );
  return useMemo(
    () => ({ collapsed, toggle, collapse }),
    [collapsed, toggle, collapse]
  );
}

/** True on the packaged macOS app, where the window uses `titleBarStyle: "Overlay"` and the
 * native traffic lights float over the top-left of the rail, so it needs a left inset. In a
 * plain browser (dev harness) or on Linux there are no overlaid controls to dodge. */
function isMacTauri(): boolean {
  return (
    isTauri() &&
    typeof navigator !== 'undefined' &&
    navigator.userAgent.includes('Macintosh')
  );
}

/** Whether to reserve space for the macOS traffic lights. They auto-hide in native
 * fullscreen, so the inset collapses there; fullscreen is re-checked on every window resize
 * (entering/leaving fullscreen always resizes, and `isFullscreen` is the reliable signal). */
export function useTrafficLightInset(): boolean {
  const [inset, setInset] = useState(() => isMacTauri());

  useEffect(() => {
    if (!isMacTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      const update = async () => {
        const fullscreen = await win.isFullscreen();
        if (!cancelled) setInset(!fullscreen);
      };
      void update();
      const stop = await win.onResized(() => void update());
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return inset;
}

interface SidebarProps {
  hasActiveProject: boolean;
  section: 'project' | 'global';
  projectView: ProjectView;
  globalView: GlobalView;
  /** The rail's top-row switcher (`ProjectSwitcher`) — App wires its lazy project list. */
  switcher: ReactNode;
  /** Leave 76px on the left of the top strip for the macOS traffic lights. */
  trafficLightInset: boolean;
  onOpenPalette: () => void;
  onNewTask: () => void;
  /** Everything waiting on a human — the Inbox row's count and attention dot. */
  inboxCount: number;
  /** Overseer tool calls and queued actions waiting on the human — the Overseer row's count. */
  overseerPendingCount?: number;
  /** Count of non-terminal runs for this project — the All agents row's count. */
  liveAgentCount: number;
  drafts: DraftRecord[];
  onOpenDraft: (id: string) => void;
  onDismissDraft: (id: string) => void;
  onSetProjectView: (view: ProjectView) => void;
  onSetGlobalView: (view: GlobalView) => void;
  /** The `Live agents ▾` section's body (`LiveRail`), or `null` outside project scope. */
  liveRail: ReactNode;
  /** The Try block's "Drop a thought" — the ⌘D quick capture. */
  onQuickCapture: () => void;
}

/**
 * Linear's rail on the `#08080a` frame: a top strip holding the project switcher plus
 * search and new-task icon buttons, a fixed heading-less group (Inbox, Drafts, Overseer),
 * then the collapsible `Workspace ▾`, `Fleet ▾`, `Live agents ▾` and `Try ▾` sections.
 * Built on `SidebarNav` (`ui/ai/sidebar-nav.tsx`) inside the `Sidebar` shell that App's
 * `SidebarProvider` hides entirely on `[`. Settings is not a row: it lives in the
 * switcher's menu, on `G S`, and behind the status strip's `?`.
 */
export function Sidebar({
  hasActiveProject,
  section,
  projectView,
  globalView,
  switcher,
  trafficLightInset,
  onOpenPalette,
  onNewTask,
  inboxCount,
  overseerPendingCount = 0,
  liveAgentCount,
  drafts,
  onOpenDraft,
  onDismissDraft,
  onSetProjectView,
  onSetGlobalView,
  liveRail,
  onQuickCapture,
}: SidebarProps) {
  const sections = useSidebarSections();
  const [draftsOpen, setDraftsOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const draftCount = drafts.filter(
    (d) =>
      d.state === 'running' || d.state === 'ready' || d.questions.length > 0
  ).length;

  const activeId = section === 'project' ? projectView : globalView;

  const topGroup: SidebarNavSection = {
    id: 'top',
    items: [
      {
        id: 'inbox',
        label: 'Inbox',
        icon: <Inbox strokeWidth={2} />,
        count: inboxCount > 0 ? inboxCount : undefined,
        // The one row whose count is "needs a human" — it earns the dot, not just a number.
        state: inboxCount > 0 ? 'attention' : undefined,
        disabled: !hasActiveProject,
      },
      {
        id: 'drafts',
        label: 'Drafts',
        icon: <Sparkles strokeWidth={2} />,
        count: draftCount > 0 ? draftCount : undefined,
        disabled: !hasActiveProject,
      },
      {
        id: 'overseer',
        label: 'Overseer',
        icon: <Shield strokeWidth={2} />,
        count: overseerPendingCount > 0 ? overseerPendingCount : undefined,
        state: overseerPendingCount > 0 ? 'attention' : undefined,
      },
    ],
  };

  const workspace: SidebarNavSection = {
    id: 'workspace',
    label: 'Workspace',
    collapsible: true,
    collapsed: sections.collapsed('workspace'),
    onToggle: () => sections.toggle('workspace'),
    items: WORKSPACE_VIEWS.map((view) => {
      const Icon = view.icon;
      return {
        id: view.id,
        label: view.label,
        icon: <Icon strokeWidth={2} />,
        disabled: !hasActiveProject,
      } satisfies SidebarNavItem;
    }),
  };

  const fleet: SidebarNavSection = {
    id: 'fleet',
    label: 'Fleet',
    collapsible: true,
    collapsed: sections.collapsed('fleet'),
    onToggle: () => sections.toggle('fleet'),
    items: FLEET_VIEWS.map((view) => {
      const Icon = view.icon;
      return {
        id: view.id,
        label: view.label,
        icon: <Icon strokeWidth={2} />,
        count:
          view.id === 'all-agents' && liveAgentCount > 0
            ? liveAgentCount
            : undefined,
      } satisfies SidebarNavItem;
    }),
  };

  const live: SidebarNavSection | null =
    liveRail !== null
      ? {
          id: 'live',
          label: 'Live agents',
          collapsible: true,
          collapsed: sections.collapsed('live'),
          onToggle: () => sections.toggle('live'),
          items: [],
          content: liveRail,
        }
      : null;

  const tryBlock: SidebarNavSection = {
    id: 'try',
    label: 'Try',
    collapsible: true,
    collapsed: sections.collapsed('try'),
    onToggle: () => sections.toggle('try'),
    items: [
      {
        id: 'try-plan',
        label: 'Plan work…',
        icon: <NotebookPen strokeWidth={2} />,
        disabled: !hasActiveProject,
      },
      {
        id: 'try-capture',
        label: 'Drop a thought',
        icon: <Brain strokeWidth={2} />,
        disabled: !hasActiveProject,
      },
      {
        id: 'try-linear',
        label: 'Connect Linear',
        icon: <Link2 strokeWidth={2} />,
      },
    ],
  };

  const navSections: SidebarNavSection[] = [
    topGroup,
    workspace,
    fleet,
    ...(live !== null ? [live] : []),
    tryBlock,
  ];

  const handleSelect = useCallback(
    (id: string) => {
      if (id === 'drafts') {
        setDraftsOpen((open) => !open);
        return;
      }
      if (id.startsWith('try-')) {
        // First use is the last time the block needs to be open by default.
        sections.collapse('try');
        if (id === 'try-plan') onSetProjectView('plans');
        else if (id === 'try-capture') onQuickCapture();
        // Lands on Settings' first page: `SettingsView` keeps its page in local state and
        // has no initial-page prop yet, so Settings › Integrations is not addressable here.
        else onSetGlobalView('settings');
        return;
      }
      if ((PROJECT_VIEW_ORDER as string[]).includes(id)) {
        onSetProjectView(id as ProjectView);
        return;
      }
      onSetGlobalView(id as GlobalView);
    },
    [sections, onSetProjectView, onSetGlobalView, onQuickCapture]
  );

  return (
    <SidebarRoot id="dispatch-sidebar">
      {/* The window's drag strip: with `titleBarStyle: "Overlay"` the native traffic lights
          float over the top-left of this row, so it steps right to clear them. Only elements
          carrying `data-tauri-drag-region` start a window drag, so every control stays
          clickable. */}
      <div
        data-tauri-drag-region
        className={cn(
          'flex h-10 shrink-0 items-center gap-1 pr-2',
          trafficLightInset ? 'pl-[76px]' : 'pl-2'
        )}
      >
        <div className="min-w-0 flex-1">{switcher}</div>
        <Tooltip>
          <TooltipTrigger
            render={<IconButton label="Search" onClick={onOpenPalette} />}
          >
            <Search />
          </TooltipTrigger>
          <TooltipContent side="bottom">Search ⌘K</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <IconButton
                filled
                label="New task"
                onClick={onNewTask}
                disabled={!hasActiveProject}
              />
            }
          >
            <SquarePen />
          </TooltipTrigger>
          <TooltipContent side="bottom">New task C</TooltipContent>
        </Tooltip>
      </div>
      <div ref={navRef} className="min-h-0 flex-1">
        <SidebarNav
          sections={navSections}
          activeId={activeId}
          onSelect={handleSelect}
        />
      </div>
      <DraftTrayPopover
        open={draftsOpen}
        onOpenChange={setDraftsOpen}
        anchor={() =>
          navRef.current?.querySelector('[data-nav-item="drafts"]') ?? null
        }
        drafts={drafts}
        onOpenDraft={onOpenDraft}
        onDismissDraft={onDismissDraft}
      />
    </SidebarRoot>
  );
}

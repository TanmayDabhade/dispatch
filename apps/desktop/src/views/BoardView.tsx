import type { TaskDoc } from '@dispatch/core/browser';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DaemonUnavailable } from '../components/shell/DaemonUnavailable';
import { AppliedFilters } from '../components/tasks/AppliedFilters';
import { DispatchDialog } from '../components/tasks/DispatchDialog';
import { DisplayPopover } from '../components/tasks/DisplayPopover';
import { FilterMenu } from '../components/tasks/FilterMenu';
import { TaskBoard } from '../components/tasks/TaskBoard';
import type { DispatchProjectData } from '../hooks/useDispatchProject';
import { isTypingTarget } from '../hooks/useGlobalKeyboard';
import {
  type BoardLane,
  groupTasksByEpicLane,
  groupTasksByStatus,
  visibleBoardColumns,
  visibleLaneTaskIds,
} from '../lib/boardGrouping';
import {
  COLLAPSED_EPICS_STORAGE_KEY,
  readCollapsedGroups,
  toggleCollapsedGroup,
  writeCollapsedGroups,
} from '../lib/collapsedEpics';
import { resolveListKeyCommand } from '../lib/keyboard';
import { countMergeReady } from '../lib/mergeReady';
import {
  applyTaskFilters,
  type FilterContext,
  hasActiveTaskFilters,
  matchesTaskFilterSet,
  parseTaskFilterSet,
  serializeTaskFilterSet,
  TASK_FILTERS_V2_STORAGE_KEY,
  type TaskFilterSet,
} from '../lib/taskFilters';
import {
  parseTasksDisplay,
  serializeTasksDisplay,
  TASK_FILTERS_STORAGE_KEY,
  TASKS_DISPLAY_STORAGE_KEY,
  type TasksDisplayPrefs,
} from '../lib/tasksPrefs';
import {
  TASKS_VIEW_TABS,
  type TasksViewMode,
  useTasksViewMode,
} from '../lib/tasksViewMode';
import { MilestonesView } from './MilestonesView';
import { TasksListView } from './TasksListView';
import {
  HeaderIconTriad,
  PageHeader,
  SidePanelIconButton,
  ViewTabs,
} from '@/ui/ai/page-header';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/chrome';
import { Skeleton } from '@/ui/skeleton';

/** Session keys for the columns folded to a strip or hidden from a column's `···` menu —
 * the same "out of my way for now" lifetime as collapsed epic lanes. */
const COLLAPSED_COLUMNS_STORAGE_KEY = 'dispatch:board-collapsed-columns';
const HIDDEN_COLUMNS_STORAGE_KEY = 'dispatch:board-hidden-columns';

interface BoardViewProps {
  data: DispatchProjectData;
  /** The layout to open in; the header's view tabs own it from there (and persist it). */
  mode?: TasksViewMode;
  /** The active project's display name, the first crumb segment. */
  projectName?: string | null;
  onSelectTask: (taskId: string) => void;
  /** Opens `CreateTaskModal`, optionally pre-set to a status — the empty state's `New task`. */
  onNewTask: (status?: string) => void;
  onPlanWork: () => void;
}

// Reads a session-scoped collapsed set without touching storage during SSR/tests that
// stub `window` away.
function readSessionSet(key: string): Set<string> {
  return typeof window === 'undefined' ? new Set() : readCollapsedGroups(key);
}

/** Skeleton placeholder for the board while tasks/config load: the column geometry the
 * real board renders (348px columns, 44px headers, 322px cards with 8px corners). */
function BoardSkeleton() {
  return (
    <div
      data-slot="board-skeleton"
      className="flex h-full min-h-0 overflow-hidden px-4 py-3"
    >
      {Array.from({ length: 4 }, (_, columnIndex) => (
        <div
          key={columnIndex}
          className="flex w-[348px] shrink-0 flex-col px-3"
        >
          <div className="flex h-11 items-center gap-2">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }, (_, cardIndex) => (
              <Skeleton
                key={cardIndex}
                className="rounded-card h-[104px] w-[322px]"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// A thin line-art board for the empty state: three columns with a card or two each.
function BoardLineArt() {
  return (
    <svg viewBox="0 0 60 60" fill="none" stroke="currentColor" aria-hidden>
      <rect x="4" y="8" width="15" height="44" rx="2" />
      <rect x="22.5" y="8" width="15" height="44" rx="2" />
      <rect x="41" y="8" width="15" height="44" rx="2" />
      <rect x="7" y="13" width="9" height="6" rx="1" />
      <rect x="7" y="22" width="9" height="6" rx="1" />
      <rect x="25.5" y="13" width="9" height="6" rx="1" />
      <rect x="44" y="13" width="9" height="6" rx="1" />
      <rect x="44" y="22" width="9" height="6" rx="1" />
      <rect x="44" y="31" width="9" height="6" rx="1" />
    </svg>
  );
}

/**
 * The Tasks page: Linear's two-row panel header (`Project › Tasks` with the ghost actions,
 * then the Board | List | Milestones view tabs and the Filter / Display / side-panel
 * triad) over one of three layouts. `board` is the kanban — status columns on the bare
 * panel, optionally grouped into one lane per epic (Display › Grouping, or the side-panel
 * toggle); `list` is the grouped list; `milestones` groups the same tasks by milestone.
 * The Display popover writes the one `TasksDisplayPrefs` every layout reads, and the
 * Filter menu's clauses apply before grouping on all three.
 *
 * j/k/Enter roving focus: the Board's own traversal runs lane by lane and column-major
 * inside a lane over the cards actually on screen (a collapsed epic's cards are skipped) —
 * see `handleBoardKeyDown`; the List's is row-major (see `TasksListView`). `f` opens the
 * filter menu and `⇧V` the Display popover from either.
 */
export function BoardView({
  data,
  mode: initialMode,
  projectName,
  onSelectTask,
  onNewTask,
  onPlanWork,
}: BoardViewProps) {
  const [mode, setMode] = useTasksViewMode(initialMode);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  // Which epic lanes are folded up. Session-scoped (see `collapsedEpics.ts`) and lifted to the
  // view rather than kept inside `TaskBoard` because the j/k cursor below has to skip the cards a
  // collapsed lane is hiding.
  const [collapsedLaneKeys, setCollapsedLaneKeys] = useState<
    ReadonlySet<string>
  >(() => readSessionSet(COLLAPSED_EPICS_STORAGE_KEY));
  const [collapsedColumns, setCollapsedColumns] = useState<ReadonlySet<string>>(
    () => readSessionSet(COLLAPSED_COLUMNS_STORAGE_KEY)
  );
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(() =>
    readSessionSet(HIDDEN_COLUMNS_STORAGE_KEY)
  );
  // Which epic's dispatch is awaiting confirmation, or null when the dialog is closed.
  const [dispatchEpicId, setDispatchEpicId] = useState<string | null>(null);
  // The filter clauses and the display model, persisted across restarts — see
  // `taskFilters.ts` / `tasksPrefs.ts` for the parse/defaults and the v1 filter migration.
  const [filters, setFilters] = useState<TaskFilterSet>(() =>
    parseTaskFilterSet(
      window.localStorage.getItem(TASK_FILTERS_V2_STORAGE_KEY),
      window.localStorage.getItem(TASK_FILTERS_STORAGE_KEY)
    )
  );
  const [prefs, setPrefs] = useState<TasksDisplayPrefs>(() =>
    parseTasksDisplay(window.localStorage.getItem(TASKS_DISPLAY_STORAGE_KEY))
  );
  // The header menus' open state lives here so the list's `f` / `⇧V` can open them.
  const [filterOpen, setFilterOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  // "Merge all ready" action state — the Board's copy of the merge queue's control.
  const [mergeAllPending, setMergeAllPending] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(
      TASK_FILTERS_V2_STORAGE_KEY,
      serializeTaskFilterSet(filters)
    );
  }, [filters]);

  useEffect(() => {
    window.localStorage.setItem(
      TASKS_DISPLAY_STORAGE_KEY,
      serializeTasksDisplay(prefs)
    );
  }, [prefs]);

  useEffect(() => {
    writeCollapsedGroups(COLLAPSED_EPICS_STORAGE_KEY, collapsedLaneKeys);
  }, [collapsedLaneKeys]);

  useEffect(() => {
    writeCollapsedGroups(COLLAPSED_COLUMNS_STORAGE_KEY, collapsedColumns);
  }, [collapsedColumns]);

  useEffect(() => {
    writeCollapsedGroups(HIDDEN_COLUMNS_STORAGE_KEY, hiddenColumns);
  }, [hiddenColumns]);

  // The layout switch keeps `prefs.layout` in step so a reader of the display model alone
  // agrees with the tabs.
  const changeMode = useCallback(
    (next: TasksViewMode) => {
      setMode(next);
      setPrefs((prev) =>
        prev.layout === next ? prev : { ...prev, layout: next }
      );
    },
    [setMode]
  );

  // Board lanes follow Display › Grouping: epic or milestone groups the columns into one
  // lane per epic; anything else is the flat board with an epic crumb per card.
  const groupByEpic =
    prefs.grouping === 'epic' || prefs.grouping === 'milestone';
  const toggleGroupByEpic = () =>
    setPrefs((prev) => ({
      ...prev,
      grouping: groupByEpic ? 'status' : 'epic',
    }));

  // With Display › Show archived on, archived tasks join the board so their (typically done)
  // column shows them dimmed — `data.tasks` stays untouched so every other consumer keeps its
  // archived-excluded meaning.
  const boardTasks = useMemo(
    () =>
      data.showArchived ? [...data.tasks, ...data.archivedTasks] : data.tasks,
    [data.tasks, data.archivedTasks, data.showArchived]
  );
  const archivedTaskIds = useMemo(
    () => new Set(data.archivedTasks.map((t) => t.meta.id)),
    [data.archivedTasks]
  );
  const epicIds = useMemo(
    () => new Set(data.epics.map((e) => e.meta.id)),
    [data.epics]
  );
  const epicTitleById = useMemo(
    () => new Map(data.epics.map((e) => [e.meta.id, e.meta.title])),
    [data.epics]
  );
  const filterContext = useMemo<FilterContext>(
    () => ({
      liveRunStateByTaskId: data.liveRunStateByTaskId,
      epicTitleById,
    }),
    [data.liveRunStateByTaskId, epicTitleById]
  );
  const filtersActive = hasActiveTaskFilters(filters);
  // The clauses as a predicate for the list/milestones — `undefined` when nothing is active
  // so they skip a per-task closure call on the common unfiltered path.
  const taskFilterFn = useMemo(
    () =>
      filtersActive
        ? (doc: TaskDoc) => matchesTaskFilterSet(doc, filters, filterContext)
        : undefined,
    [filtersActive, filters, filterContext]
  );
  const filteredBoardTasks = useMemo(() => {
    const passing = applyTaskFilters(boardTasks, filters, filterContext);
    // A sub-task is a task whose parent is another task (an epic's children are members);
    // Display › Show sub-tasks off hides those, as on the list.
    return prefs.showSubtasks
      ? passing
      : passing.filter(
          (doc) => doc.meta.parent === null || epicIds.has(doc.meta.parent)
        );
  }, [boardTasks, filters, filterContext, prefs.showSubtasks, epicIds]);
  // Card counts per status from the *unfiltered* board set — empty-column visibility is
  // decided from these, so a filter narrows cards without making columns vanish.
  const countByStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const doc of boardTasks) {
      if (doc.meta.kind === 'epic') continue;
      map.set(doc.meta.status, (map.get(doc.meta.status) ?? 0) + 1);
    }
    return map;
  }, [boardTasks]);
  const visibleStatuses = useMemo(
    () =>
      data.config !== null
        ? visibleBoardColumns(
            data.config.statuses,
            countByStatus,
            prefs.showEmptyGroups,
            hiddenColumns
          )
        : [],
    [data.config, countByStatus, prefs.showEmptyGroups, hiddenColumns]
  );
  // The same lanes `TaskBoard` renders, from the same pure functions — this copy exists only
  // to give the j/k cursor an order that matches what is on screen.
  const lanes = useMemo<BoardLane[]>(() => {
    if (data.config === null) return [];
    if (groupByEpic) {
      return groupTasksByEpicLane(
        filteredBoardTasks,
        visibleStatuses,
        data.epics
      );
    }
    const columns = groupTasksByStatus(
      filteredBoardTasks.filter((t) => t.meta.kind !== 'epic'),
      visibleStatuses
    );
    return [
      {
        epicId: null,
        title: '',
        columns,
        total: columns.reduce((n, c) => n + c.tasks.length, 0),
      },
    ];
  }, [
    filteredBoardTasks,
    data.config,
    visibleStatuses,
    data.epics,
    groupByEpic,
  ]);
  const orderedTaskIds = useMemo(
    () =>
      visibleLaneTaskIds(lanes, groupByEpic ? collapsedLaneKeys : new Set()),
    [lanes, collapsedLaneKeys, groupByEpic]
  );
  // Everything the Filter menu can offer values for, from the project's own vocabulary.
  const filterMenuContext = useMemo(() => {
    const labels = new Set<string>();
    const milestones = new Set<string>();
    for (const doc of data.tasks) {
      for (const l of doc.meta.labels) labels.add(l);
      if (doc.meta.milestone !== null) milestones.add(doc.meta.milestone);
    }
    return {
      statuses: data.config?.statuses ?? [],
      epics: data.epics,
      labels: [...labels].sort(),
      milestones: [...milestones].sort(),
    };
  }, [data.tasks, data.config, data.epics]);
  const queuedRunIds = useMemo(
    () => new Set((data.mergeQueue?.entries ?? []).map((e) => e.runId)),
    [data.mergeQueue]
  );
  const mergeReadyCount = useMemo(
    () => countMergeReady(data.runs, data.tasksIncludingArchived, queuedRunIds),
    [data.runs, data.tasksIncludingArchived, queuedRunIds]
  );
  const handleMergeAll = async () => {
    setMergeAllPending(true);
    try {
      await data.handleMergeAllReady();
    } finally {
      setMergeAllPending(false);
    }
  };

  function handleBoardKeyDown(e: React.KeyboardEvent) {
    // A keydown that lands on (or inside) one of the track's own interactive controls — an
    // epic lane header's buttons or pickers, a column's menu, a card's Dispatch button.
    // Task cards are role="button" divs (not real <button>s), so they fall through to the
    // roving-cursor logic as intended.
    const controlEl = (e.target as HTMLElement).closest(
      'button, a, select, input, textarea, [contenteditable="true"]'
    );
    const onControl = controlEl !== null && controlEl !== e.currentTarget;
    const command = resolveListKeyCommand(
      { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey },
      { isTyping: isTypingTarget(e.target) }
    );
    if (command === null) return;
    if (command === 'list-open-filter') {
      e.preventDefault();
      setFilterOpen(true);
      return;
    }
    if (command === 'list-open-display') {
      e.preventDefault();
      setDisplayOpen(true);
      return;
    }
    if (orderedTaskIds.length === 0) return;
    // Enter/Space belong to whatever control has focus — activating it, not opening the card the
    // cursor happens to be on. j/k are nobody's activation key, so they keep steering the board
    // from a control too.
    if (command === 'list-confirm' || command === 'list-open') {
      if (onControl) return;
      e.preventDefault();
      if (focusedTaskId !== null) onSelectTask(focusedTaskId);
      return;
    }
    if (command !== 'list-down' && command !== 'list-up') return;
    e.preventDefault();
    const currentIndex =
      focusedTaskId !== null ? orderedTaskIds.indexOf(focusedTaskId) : -1;
    const nextIndex =
      command === 'list-down'
        ? Math.min(currentIndex + 1, orderedTaskIds.length - 1)
        : Math.max(currentIndex - 1, 0);
    setFocusedTaskId(orderedTaskIds[Math.max(nextIndex, 0)] ?? null);
  }

  if (data.portLoading || data.portError || data.client === null) {
    return (
      <DaemonUnavailable
        starting={data.portLoading}
        errorDetail={data.portErrorDetail}
        onRetry={data.retryEnsureDispatchd}
      />
    );
  }

  const loading = data.tasksLoading || data.config === null;
  const crumb = [
    ...(projectName !== undefined && projectName !== null ? [projectName] : []),
    'Tasks',
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb={crumb}
        actions={
          <>
            <Button variant="ghost" onClick={onPlanWork}>
              Plan work…
            </Button>
            <Button
              variant="ghost"
              disabled={mergeReadyCount === 0 || mergeAllPending}
              onClick={() => void handleMergeAll()}
            >
              Merge all ready ({mergeReadyCount})
            </Button>
          </>
        }
        tabs={
          <ViewTabs
            tabs={TASKS_VIEW_TABS.map((tab) => ({ ...tab }))}
            active={mode}
            onChange={(id) => changeMode(id as TasksViewMode)}
          />
        }
        controls={
          <HeaderIconTriad
            filter={
              <FilterMenu
                filters={filters}
                onChange={setFilters}
                context={filterMenuContext}
                open={filterOpen}
                onOpenChange={setFilterOpen}
              />
            }
            display={
              <DisplayPopover
                mode={mode}
                onModeChange={changeMode}
                prefs={prefs}
                onPrefsChange={setPrefs}
                showArchived={data.showArchived}
                archivedCount={data.archivedTasks.length}
                onShowArchivedChange={data.setShowArchived}
                open={displayOpen}
                onOpenChange={setDisplayOpen}
              />
            }
            sidePanel={
              // Milestones always groups by milestone, so the lane toggle has nothing to do.
              <SidePanelIconButton
                label={groupByEpic ? 'Ungroup epics' : 'Group by epic'}
                active={groupByEpic}
                disabled={mode === 'milestones'}
                onClick={toggleGroupByEpic}
              />
            }
          />
        }
      />
      <AppliedFilters
        filters={filters}
        onChange={setFilters}
        context={filterContext}
        className="shadow-hairline-bottom shrink-0 px-4 py-2"
      />

      {loading ? (
        <BoardSkeleton />
      ) : boardTasks.length === 0 ? (
        <EmptyState
          illustration={<BoardLineArt />}
          heading="No tasks yet"
          description="Create one, or let Plan work… draft a set from a goal."
          primary={{ label: 'New task', hint: 'C', onClick: () => onNewTask() }}
          secondary={{ label: 'Plan work…', onClick: onPlanWork }}
          className="flex-1"
        />
      ) : mode === 'milestones' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <MilestonesView
            data={data}
            onOpenTask={onSelectTask}
            display={prefs}
            onRequestFilter={() => setFilterOpen(true)}
            onRequestDisplay={() => setDisplayOpen(true)}
          />
        </div>
      ) : mode === 'board' ? (
        // `tabIndex={0}` puts the track itself in the natural tab order (so someone can
        // Tab/click into the board and start using j/k immediately) — the individual cards
        // remain the real roving-focus targets once `focusedTaskId` moves onto one of them.
        <div
          className="min-h-0 flex-1 px-4 py-3 outline-none"
          tabIndex={0}
          onKeyDown={handleBoardKeyDown}
        >
          <TaskBoard
            collapsedLaneKeys={collapsedLaneKeys}
            onToggleLane={(key) =>
              setCollapsedLaneKeys((prev) => toggleCollapsedGroup(prev, key))
            }
            collapsedColumns={collapsedColumns}
            onToggleColumnCollapsed={(status) =>
              setCollapsedColumns((prev) => toggleCollapsedGroup(prev, status))
            }
            onHideColumn={(status) =>
              setHiddenColumns((prev) => new Set([...prev, status]))
            }
            hiddenColumnCount={hiddenColumns.size}
            onShowHiddenColumns={() => setHiddenColumns(new Set())}
            onRequestWorkEpic={setDispatchEpicId}
            tasks={filteredBoardTasks}
            archivedTaskIds={archivedTaskIds}
            statuses={visibleStatuses}
            groupByEpic={groupByEpic}
            display={prefs}
            readyIds={data.readyIds}
            blockedIds={data.blockedIds}
            liveRunStateByTaskId={data.liveRunStateByTaskId}
            latestRunByTaskId={data.latestRunByTaskId}
            attentionByTaskId={data.attentionByTaskId}
            epicProgressById={data.epicProgressById}
            epicConcurrencyDefault={
              data.config?.orchestrator.epicConcurrency ?? 3
            }
            epics={data.epics}
            onSelect={onSelectTask}
            onDispatch={data.handleDispatch}
            onWorkEpic={data.handleWorkEpic}
            onStopEpic={data.handleStopEpic}
            onLandEpic={data.handleLandEpic}
            onMoveStatus={data.moveTaskStatus}
            onEditTask={data.handleUpdate}
            focusedTaskId={focusedTaskId}
            onCardFocus={setFocusedTaskId}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <TasksListView
            data={data}
            onSelectTask={onSelectTask}
            taskFilter={taskFilterFn}
            display={prefs}
            onRequestFilter={() => setFilterOpen(true)}
            onRequestDisplay={() => setDisplayOpen(true)}
          />
        </div>
      )}

      {dispatchEpicId !== null && (
        <DispatchDialog
          title="Send agents at this epic"
          tasks={data.tasks.filter((t) => t.meta.parent === dispatchEpicId)}
          readyIds={data.readyIds}
          runningNow={data.liveRunStateByTaskId.size}
          defaultConcurrency={data.config?.orchestrator.epicConcurrency ?? 3}
          onCancel={() => setDispatchEpicId(null)}
          onConfirm={async (concurrency) => {
            await data.handleWorkEpic(dispatchEpicId, concurrency);
            setDispatchEpicId(null);
          }}
        />
      )}
    </div>
  );
}

import type { TaskListItem } from '@dispatch/core/browser';
import {
  DEFAULT_STATUS_MODEL,
  isUnstartedStatus,
  statusModelOf,
} from '@dispatch/core/browser';
import { Users } from 'lucide-react';
import {
  type KeyboardEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  CockpitLane,
  type CockpitRowModel,
  CollapsedLane,
} from '../components/cockpit/CockpitLane';
import { cockpitRowId } from '../components/cockpit/CockpitRow';
import {
  buildFlightPlan,
  type FlightPlan,
} from '../components/flightplan/flightPlan';
import { usePeople } from '../components/people/PeopleContext';
import { DaemonUnavailable } from '../components/shell/DaemonUnavailable';
import { AssigneeAvatar } from '../components/tasks/AssigneeAvatar';
import { TaskPane } from '../components/tasks/TaskPane';
import type { DispatchProjectData } from '../hooks/useDispatchProject';
import { isTypingTarget } from '../hooks/useGlobalKeyboard';
import { useOptimisticDispatch } from '../hooks/useOptimisticDispatch';
import type { TaskTab } from '../lib/appNav';
import {
  buildCockpit,
  COCKPIT_LANES,
  type CockpitItem,
  type CockpitLaneId,
  type CockpitScope,
  groupByOwner,
  indexCockpitTasks,
} from '../lib/cockpit';
import {
  type CockpitCursor,
  moveCockpitCursor,
  resolveCockpitKey,
} from '../lib/cockpitKeys';
import { pendingStarts } from '../lib/optimisticDispatch';
import { isTerminalRunState } from '../lib/runState';
import { flattenGroups } from '../lib/virtualRows';
import { cn } from '@/lib/utils';
import { IconButton } from '@/ui/ai/icon-button';
import { PageHeader, ViewTabs } from '@/ui/ai/page-header';
import { SelectPill } from '@/ui/ai/pill';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

const SCOPE_STORAGE_KEY = 'dispatch:cockpit-scope';
const ROSTER_STORAGE_KEY = 'dispatch:cockpit-roster';

// The persisted scope, tolerating a missing, blocked or malformed store.
function readScope(): CockpitScope {
  try {
    const raw = window.localStorage.getItem(SCOPE_STORAGE_KEY);
    if (raw === 'team') return { kind: 'team' };
    if (raw?.startsWith('person:') === true) {
      return { kind: 'person', ref: raw.slice('person:'.length) };
    }
  } catch {
    // Fall through to the default.
  }
  return { kind: 'me' };
}

function writeScope(scope: CockpitScope): void {
  try {
    window.localStorage.setItem(
      SCOPE_STORAGE_KEY,
      scope.kind === 'person' ? `person:${scope.ref}` : scope.kind
    );
  } catch {
    // A blocked store only forgets the choice.
  }
}

function readRoster(): boolean {
  try {
    return window.localStorage.getItem(ROSTER_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeRoster(on: boolean): void {
  try {
    window.localStorage.setItem(ROSTER_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // A blocked store only forgets the choice.
  }
}

// One lane's items as virtual rows: bare, or grouped under person headers in the roster.
function laneRows(
  items: CockpitItem[],
  roster: boolean,
  people: Parameters<typeof groupByOwner>[1],
  me: string | null
): CockpitRowModel[] {
  const groups = roster
    ? groupByOwner(items, people, me)
    : [{ key: 'all', header: null, items }];
  return flattenGroups(groups, new Set(), (item) => item.key);
}

const NO_ROWS: Record<CockpitLaneId, CockpitRowModel[]> = {
  ready: [],
  flight: [],
  needs: [],
};

interface CockpitViewProps {
  data: DispatchProjectData;
  projectName: string | null;
  /** Dispatches without leaving the Cockpit, rejecting on failure so the optimistic move
   * can roll back. */
  dispatchTask: (taskId: string) => Promise<void>;
  /** A dispatch the daemon refused, after the rollback — App toasts it. */
  onDispatchFailed: (taskId: string, message: string) => void;
  /** The full task page (`o`, the pane's expand). */
  onOpenTask: (taskId: string, tab?: TaskTab, runId?: string) => void;
  /** The peek dialog (Space). */
  onPeekTask: (taskId: string) => void;
}

/**
 * The home view: three lanes in the order work moves — Ready for you, In flight, Needs you —
 * all rendered from the caches the app already holds, so it is up the moment they are.
 * Keyboard-first: j/k within a lane, h/l across, `d` dispatches the focused ready task (it
 * moves into flight at once and comes back if the daemon refuses), Enter opens the task in
 * a split pane beside the lanes, `o` the full page, Space the peek, `t` flips Mine/Team and
 * `g p` groups every lane by person. The split pane follows the cursor.
 */
export function CockpitView({
  data,
  projectName,
  dispatchTask,
  onDispatchFailed,
  onOpenTask,
  onPeekTask,
}: CockpitViewProps) {
  const directory = usePeople();
  const me = data.me ?? directory.me;
  const [scope, setScopeState] = useState<CockpitScope>(readScope);
  const [roster, setRosterState] = useState(readRoster);
  const [cursor, setCursor] = useState<CockpitCursor>({
    lane: 'ready',
    key: null,
  });
  const [paneTaskId, setPaneTaskId] = useState<string | null>(null);
  // The pane catches up with the cursor at a lower priority, so holding j never waits on
  // the task page.
  const deferredPaneTaskId = useDeferredValue(paneTaskId);
  const gArmedAt = useRef<number | null>(null);
  // Where the cursor sat in its lane, so a row leaving (dispatched, landed) hands the
  // cursor to its neighbour instead of the top.
  const cursorIndex = useRef(0);

  const setScope = useCallback((next: CockpitScope) => {
    setScopeState(next);
    writeScope(next);
  }, []);
  const toggleRoster = useCallback(() => {
    setRosterState((prev) => {
      writeRoster(!prev);
      return !prev;
    });
  }, []);

  const model = useMemo(
    () =>
      data.config === null ? DEFAULT_STATUS_MODEL : statusModelOf(data.config),
    [data.config]
  );
  const taskById = useMemo(() => {
    const map = new Map<string, TaskListItem>();
    for (const task of data.tasksIncludingArchived) map.set(task.meta.id, task);
    return map;
  }, [data.tasksIncludingArchived]);
  const liveTaskIds = useMemo(
    () => new Set(data.liveRunStateByTaskId.keys()),
    [data.liveRunStateByTaskId]
  );
  const stillWaiting = useCallback(
    (taskId: string) => {
      const task = taskById.get(taskId);
      return task !== undefined && isUnstartedStatus(task.meta.status, model);
    },
    [taskById, model]
  );
  const optimistic = useOptimisticDispatch(
    dispatchTask,
    liveTaskIds,
    stillWaiting,
    onDispatchFailed
  );
  const pending = useMemo(
    () => pendingStarts(optimistic.pending),
    [optimistic.pending]
  );

  // The per-task half of the lanes, held across scope flips, dispatches and run updates.
  const index = useMemo(
    () => indexCockpitTasks(data.tasksIncludingArchived, model),
    [data.tasksIncludingArchived, model]
  );
  const lanes = useMemo(
    () =>
      buildCockpit({
        index,
        runs: data.runs,
        latestRunByTaskId: data.latestRunByTaskId,
        attentionByTaskId: data.attentionByTaskId,
        liveEpicSessions: data.liveEpicSessions,
        readinessById: data.readinessById,
        me,
        scope,
        pending,
      }),
    [
      index,
      data.runs,
      data.latestRunByTaskId,
      data.attentionByTaskId,
      data.liveEpicSessions,
      data.readinessById,
      me,
      scope,
      pending,
    ]
  );

  // The mini Flight Plan for every container being fanned out.
  const plans = useMemo(() => {
    const out = new Map<string, FlightPlan>();
    if (data.liveEpicSessions.length === 0) return out;
    const childrenOf = new Map<string, TaskListItem[]>();
    for (const task of data.tasksIncludingArchived) {
      const parent = task.meta.parent;
      if (parent === null) continue;
      const bucket = childrenOf.get(parent);
      if (bucket === undefined) childrenOf.set(parent, [task]);
      else bucket.push(task);
    }
    for (const progress of data.liveEpicSessions) {
      out.set(
        progress.epicId,
        buildFlightPlan(childrenOf.get(progress.epicId) ?? [], {
          liveTaskIds,
          model,
          concurrency: progress.session?.concurrency ?? null,
        })
      );
    }
    return out;
  }, [data.liveEpicSessions, data.tasksIncludingArchived, liveTaskIds, model]);

  const rows = useMemo<Record<CockpitLaneId, CockpitRowModel[]>>(
    () =>
      data.tasksReady
        ? {
            ready: laneRows(lanes.ready, roster, directory.people, me),
            flight: laneRows(lanes.flight, roster, directory.people, me),
            needs: laneRows(lanes.needs, roster, directory.people, me),
          }
        : NO_ROWS,
    [lanes, roster, directory.people, me, data.tasksReady]
  );
  // Item keys per lane in row order — what the cursor walks (headers are skipped).
  const laneKeys = useMemo(() => {
    const out = {} as Record<CockpitLaneId, string[]>;
    for (const lane of COCKPIT_LANES) {
      out[lane] = rows[lane].flatMap((row) =>
        row.kind === 'item' ? [row.key] : []
      );
    }
    return out;
  }, [rows]);
  const itemByKey = useMemo(() => {
    const map = new Map<string, { lane: CockpitLaneId; item: CockpitItem }>();
    for (const lane of COCKPIT_LANES) {
      for (const row of rows[lane]) {
        if (row.kind === 'item') map.set(row.key, { lane, item: row.item });
      }
    }
    return map;
  }, [rows]);

  // Keeps the cursor on a real row: a row that left hands over to the one now at its
  // position; an empty lane hands over to the next lane with rows.
  useEffect(() => {
    const keys = laneKeys[cursor.lane];
    if (cursor.key !== null && keys.includes(cursor.key)) {
      cursorIndex.current = keys.indexOf(cursor.key);
      return;
    }
    if (keys.length > 0) {
      const index = Math.min(cursorIndex.current, keys.length - 1);
      setCursor({ lane: cursor.lane, key: keys[index] ?? null });
      return;
    }
    const other = COCKPIT_LANES.find((lane) => laneKeys[lane].length > 0);
    if (other !== undefined)
      setCursor({ lane: other, key: laneKeys[other][0] ?? null });
    else if (cursor.key !== null) setCursor({ lane: cursor.lane, key: null });
  }, [laneKeys, cursor]);

  // The split pane follows the cursor while it is open.
  const cursorTaskId =
    cursor.key === null
      ? null
      : (itemByKey.get(cursor.key)?.item.taskId ?? null);
  useEffect(() => {
    if (
      paneTaskId !== null &&
      cursorTaskId !== null &&
      cursorTaskId !== paneTaskId
    ) {
      setPaneTaskId(cursorTaskId);
    }
  }, [cursorTaskId, paneTaskId]);

  // The lanes take focus once they are on screen (the daemon may still be starting on
  // mount), so j/k work without a click first.
  const gridRef = useRef<HTMLDivElement>(null);
  const daemonReady =
    !data.portLoading && !data.portError && data.client !== null;
  useEffect(() => {
    if (daemonReady) gridRef.current?.focus();
  }, [daemonReady]);

  const openFull = useCallback(
    (item: CockpitItem) => {
      const run =
        item.kind === 'run'
          ? item.run
          : item.kind === 'needs'
            ? item.run
            : undefined;
      if (run === undefined) {
        onOpenTask(item.taskId);
        return;
      }
      onOpenTask(
        item.taskId,
        isTerminalRunState(run.state) ? 'diff' : 'chat',
        run.id
      );
    },
    [onOpenTask]
  );

  const activate = useCallback(
    (key: string) => {
      const entry = itemByKey.get(key);
      if (entry === undefined) return;
      setCursor({ lane: entry.lane, key });
      setPaneTaskId(entry.item.taskId);
      gridRef.current?.focus();
    },
    [itemByKey]
  );

  const dispatchFromRow = useCallback(
    (taskId: string) => void optimistic.dispatch(taskId),
    [optimistic]
  );

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (isTypingTarget(e.target)) return;
    // A keystroke on a control inside a row (its Dispatch button) belongs to that control.
    if (
      e.target !== e.currentTarget &&
      (e.target as HTMLElement).closest(
        'button, a, input, textarea, select'
      ) !== null &&
      (e.key === 'Enter' || e.key === ' ')
    ) {
      return;
    }
    const { command, gArmedAt: armed } = resolveCockpitKey(
      { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, at: Date.now() },
      gArmedAt.current
    );
    gArmedAt.current = armed;
    if (command === null) return;
    const focused =
      cursor.key === null ? undefined : itemByKey.get(cursor.key)?.item;
    switch (command) {
      case 'down':
      case 'up':
      case 'left':
      case 'right':
        e.preventDefault();
        setCursor(moveCockpitCursor(laneKeys, cursor, command));
        return;
      case 'open-split':
        if (focused === undefined) return;
        e.preventDefault();
        setPaneTaskId(focused.taskId);
        return;
      case 'open-full':
        if (focused === undefined) return;
        e.preventDefault();
        openFull(focused);
        return;
      case 'peek':
        if (focused === undefined) return;
        e.preventDefault();
        onPeekTask(focused.taskId);
        return;
      case 'dispatch':
        if (focused?.kind !== 'ready') return;
        e.preventDefault();
        void optimistic.dispatch(focused.taskId);
        return;
      case 'toggle-team':
        e.preventDefault();
        setScope(scope.kind === 'team' ? { kind: 'me' } : { kind: 'team' });
        return;
      case 'roster':
        e.preventDefault();
        toggleRoster();
        return;
      case 'close':
        if (paneTaskId === null) return;
        // The shell's Escape would also navigate back.
        e.preventDefault();
        e.stopPropagation();
        setPaneTaskId(null);
        return;
    }
  }

  if (!daemonReady) {
    return (
      <DaemonUnavailable
        starting={data.portLoading}
        errorDetail={data.portErrorDetail}
        onRetry={data.retryEnsureDispatchd}
      />
    );
  }

  const split = deferredPaneTaskId !== null;
  const scopePerson =
    scope.kind === 'person'
      ? directory.people.find((p) => p.ref === scope.ref)
      : undefined;
  const scopeTabs = [
    { id: 'me', label: 'Mine' },
    { id: 'team', label: 'Team' },
    ...(scope.kind === 'person'
      ? [{ id: 'person', label: scopePerson?.name ?? scope.ref }]
      : []),
  ];
  const crumb = [...(projectName === null ? [] : [projectName]), 'Home'];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb={crumb}
        tabs={
          <ViewTabs
            tabs={scopeTabs}
            active={scope.kind}
            label="Whose work"
            onChange={(id) => {
              if (id === 'me' || id === 'team') setScope({ kind: id });
            }}
          />
        }
        controls={
          <div className="flex items-center gap-1">
            {directory.people.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<SelectPill aria-label="Filter by person" />}
                >
                  {scopePerson !== undefined ? (
                    <span className="flex items-center gap-1.5">
                      <AssigneeAvatar assignee={scopePerson.ref} size={16} />
                      {scopePerson.name}
                    </span>
                  ) : (
                    'Person'
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[200px]">
                  {directory.people.map((person) => (
                    <DropdownMenuItem
                      key={person.ref}
                      onClick={() =>
                        setScope({ kind: 'person', ref: person.ref })
                      }
                    >
                      <AssigneeAvatar assignee={person.ref} size={16} />
                      <span className="truncate">{person.name}</span>
                      {person.ref === me && (
                        <span className="text-muted-foreground ml-auto text-[12px]">
                          You
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <IconButton
              label={
                roster
                  ? 'Stop grouping by person (G P)'
                  : 'Group by person (G P)'
              }
              active={roster}
              onClick={toggleRoster}
            >
              <Users aria-hidden />
            </IconButton>
          </div>
        }
      />
      <div className="flex min-h-0 flex-1">
        <div
          ref={gridRef}
          role="grid"
          aria-label="Home"
          tabIndex={0}
          aria-activedescendant={
            cursor.key === null ? undefined : cockpitRowId(cursor.key)
          }
          onKeyDown={handleKeyDown}
          className={cn(
            'flex min-h-0 outline-none',
            split
              ? 'shadow-hairline-right w-[520px] shrink-0'
              : 'min-w-0 flex-1'
          )}
        >
          {COCKPIT_LANES.map((lane, index) =>
            split && lane !== cursor.lane ? (
              <CollapsedLane
                key={lane}
                lane={lane}
                count={laneKeys[lane].length}
                onOpen={() =>
                  setCursor({ lane, key: laneKeys[lane][0] ?? null })
                }
              />
            ) : (
              <CockpitLane
                key={lane}
                lane={lane}
                rows={rows[lane]}
                count={laneKeys[lane].length}
                focusedKey={cursor.lane === lane ? cursor.key : null}
                plans={plans}
                loading={!data.tasksReady}
                onActivate={activate}
                onDispatch={lane === 'ready' ? dispatchFromRow : undefined}
                className={cn(
                  'min-w-0 flex-1',
                  !split && index > 0 && 'shadow-hairline-left'
                )}
              />
            )
          )}
        </div>
        {split && (
          <div className="min-w-0 flex-1">
            <TaskPane
              taskId={deferredPaneTaskId}
              onClose={() => {
                setPaneTaskId(null);
                gridRef.current?.focus();
              }}
              onExpand={() => {
                const entry =
                  cursor.key === null ? undefined : itemByKey.get(cursor.key);
                if (
                  entry !== undefined &&
                  entry.item.taskId === deferredPaneTaskId
                ) {
                  openFull(entry.item);
                } else {
                  onOpenTask(deferredPaneTaskId);
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

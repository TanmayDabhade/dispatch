import type { EpicProgress, RunMeta, RunState } from '@dispatch/client';
import type { TaskDoc, UpdatePatch } from '@dispatch/core/browser';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronsLeftRight,
  ChevronsRightLeft,
  Ellipsis,
  EyeOff,
  Play,
  Plus,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  type BoardLane,
  countLaneStatuses,
  dropZoneId,
  groupTasksByEpicLane,
  groupTasksByStatus,
  laneKey,
  statusFromDropZoneId,
} from '../../lib/boardGrouping';
import type { TaskAttention } from '../../lib/taskAttention';
import { statusLabel } from '../../lib/taskDisplay';
import {
  DEFAULT_TASKS_DISPLAY,
  type TasksDisplayPrefs,
} from '../../lib/tasksPrefs';
import { useShellActions } from '../shell/ShellActionsContext';
import { EpicLaneHeader } from './EpicLaneHeader';
import { StatusIcon } from './StatusIcon';
import { TaskCardTile } from './TaskCardTile';
import { cn } from '@/lib/utils';
import { IconButton } from '@/ui/ai/icon-button';
import { PillButton } from '@/ui/ai/pill';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

interface TaskBoardProps {
  /** The cards, already in the order a column shows them (`BoardView` sorts once with
   * `sortTasks` so its j/k cursor and these columns walk the same sequence). */
  tasks: TaskDoc[];
  /** The status columns to render, in config order — already narrowed by the Display
   * popover's `Show empty groups` and any session-hidden columns (see `visibleBoardColumns`). */
  statuses: string[];
  readyIds: Set<string>;
  blockedIds: Set<string>;
  /** Live (non-terminal) run state per task id. */
  liveRunStateByTaskId: Map<string, RunState>;
  /** Each task's latest run, if any — feeds the card's run mark and merge-ladder pill. */
  latestRunByTaskId: Map<string, RunMeta>;
  /** Tasks whose latest run needs a human right now (see `deriveTaskAttentionById`) —
   * those cards carry a `Needs you` pill. Optional so a board rendered without live run
   * data simply shows none. */
  attentionByTaskId?: ReadonlyMap<string, TaskAttention>;
  /** Epic dispatch progress per epic id, once fetched. */
  epicProgressById: Map<string, EpicProgress>;
  /** Default concurrency for a fresh epic dispatch session (config's `orchestrator.epicConcurrency`). */
  epicConcurrencyDefault: number;
  /** Every epic in the project — one lane per epic that has children, in this order. */
  epics: TaskDoc[];
  /** One lane per epic (Display › Grouping: Epic) vs one flat set of status columns with
   * an epic crumb on each card (the default). */
  groupByEpic?: boolean;
  /** The Display popover's model — the card properties. Defaults to `DEFAULT_TASKS_DISPLAY`;
   * the ordering is applied by the caller (see `tasks`). */
  display?: TasksDisplayPrefs;
  /** Lane keys (see `laneKey`) whose epic is folded up right now. */
  collapsedLaneKeys: ReadonlySet<string>;
  /** Flips one lane between expanded and collapsed — owned by `BoardView`, which also needs the
   * collapsed set to keep j/k off hidden cards. */
  onToggleLane: (key: string) => void;
  /** Statuses whose column is folded to a narrow strip (a column's `···` › Collapse). */
  collapsedColumns?: ReadonlySet<string>;
  onToggleColumnCollapsed?: (status: string) => void;
  /** A column's `···` › Hide column. */
  onHideColumn?: (status: string) => void;
  /** How many columns are hidden this session, and the way back: a ghost pill at the end
   * of the header row. */
  hiddenColumnCount?: number;
  onShowHiddenColumns?: () => void;
  /** Routes epic dispatch through a confirmation preview. See EpicLaneHeader. */
  onRequestWorkEpic?: (epicId: string) => void;
  onSelect: (id: string) => void;
  /** Dispatches a plain (non-epic) task from its card's Dispatch action, and every ready
   * task in a column from the column's `···` › Dispatch all ready. Optional — omitting it
   * hides both. */
  onDispatch?: (taskId: string) => Promise<void>;
  onWorkEpic: (epicId: string, concurrency: number) => Promise<void>;
  onStopEpic: (epicId: string) => Promise<void>;
  /** Lands a finished epic branch on the default base — see EpicLaneHeader's Land button.
   * Optional for the same reason as `onDispatch`. */
  onLandEpic?: (epicId: string) => Promise<void>;
  /** Moves a task to a different status — wired to the drag-and-drop drop handler below (and
   * the card's status picker); optional so a board rendered without a live project doesn't
   * need to supply a no-op. */
  onMoveStatus?: (taskId: string, status: string) => Promise<void>;
  /** Edits a task's priority/assignee inline from its card. Optional for the same reason
   * as `onMoveStatus`. */
  onEditTask?: (taskId: string, patch: UpdatePatch) => Promise<void>;
  /** Id of the card the Board's j/k roving-focus cursor is currently on, if any. */
  focusedTaskId?: string | null;
  /** Ids of tasks appended to `tasks` because Display › Show archived is on — these cards
   * render dimmed and can't be dragged. Defaults to empty. */
  archivedTaskIds?: ReadonlySet<string>;
  /** Called whenever real DOM focus lands on any card (click, Tab, or the roving-focus
   * effect) — lets `BoardView` sync `focusedTaskId` to wherever focus actually is. */
  onCardFocus?: (taskId: string) => void;
}

// Stable empty-set defaults — no fresh `Set` per render for the common case.
const NO_IDS: ReadonlySet<string> = new Set();

// Linear's column: 348px including 12px of padding either side, so the 322px card sits on
// the 324px inner width. Shared by the sticky header row and every lane's columns.
const COLUMN_CLASS = 'w-[348px] shrink-0 px-3';
// A collapsed column folds to a 44px strip carrying the glyph, a rotated name and the count.
const COLLAPSED_COLUMN_CLASS = 'w-11 shrink-0 px-1';

// A card's draggable id doubles as its task id — plain `useDraggable`, not `useSortable`,
// since the board never persists intra-column order, only which column (status) a card sits
// in. This wrapper is the one place that calls the hook, so `TaskCardTile` stays ignorant of
// @dnd-kit beyond the small `CardDragProps` shape it already accepts.
function DraggableCard({
  id,
  disabled = false,
  children,
}: {
  id: string;
  /** True for an archived card — `useDraggable`'s own `disabled`, so it never lifts. */
  disabled?: boolean;
  children: (drag: {
    setNodeRef: (node: HTMLElement | null) => void;
    style: React.CSSProperties | undefined;
    attributes: ReturnType<typeof useDraggable>['attributes'];
    listeners: ReturnType<typeof useDraggable>['listeners'];
    isDragging: boolean;
  }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id, disabled });
  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;
  return children({ setNodeRef, style, attributes, listeners, isDragging });
}

// One lane+status cell's card stack, droppable by the composite id `dropZoneId` builds (never
// the bare status — see that helper for why). No background and no ring: the only drag-over
// cue is the panel's hover wash.
function DroppableColumn({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-over={isOver}
      data-slot="board-column"
      className="rounded-card data-[over=true]:bg-surface-hover flex min-h-16 flex-1 flex-col gap-2 transition-colors duration-100"
    >
      {children}
    </div>
  );
}

// A column's 44px header: 14px glyph, 12px muted name, plain count, then `···` and `+`.
function ColumnHeader({
  status,
  count,
  readyCount,
  collapsed,
  onToggleCollapsed,
  onHide,
  onDispatchAll,
  onAdd,
}: {
  status: string;
  count: number;
  readyCount: number;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onHide?: () => void;
  onDispatchAll?: () => void;
  onAdd: () => void;
}) {
  const label = statusLabel(status);
  if (collapsed) {
    return (
      <div
        data-slot="board-column-header"
        data-collapsed
        className={cn(
          'flex flex-col items-center gap-2 pt-2',
          COLLAPSED_COLUMN_CLASS
        )}
      >
        <IconButton
          label={`Expand ${label} column`}
          onClick={onToggleCollapsed}
        >
          <StatusIcon status={status} />
        </IconButton>
        <span className="text-muted-foreground text-[12px] font-medium whitespace-nowrap [writing-mode:vertical-rl]">
          {label}
        </span>
        <span className="font-book text-muted-foreground text-[13px] tabular-nums">
          {count}
        </span>
      </div>
    );
  }
  return (
    <div
      data-slot="board-column-header"
      className={cn('flex h-11 items-center gap-2', COLUMN_CLASS)}
    >
      <StatusIcon status={status} />
      <span className="text-muted-foreground min-w-0 truncate text-[12px] font-medium">
        {label}
      </span>
      <span className="font-book text-muted-foreground text-[13px] tabular-nums">
        {count}
      </span>
      <span className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<IconButton label={`${label} column options`} />}
        >
          <Ellipsis aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem
            disabled={onToggleCollapsed === undefined}
            onClick={onToggleCollapsed}
          >
            <ChevronsRightLeft />
            Collapse column
          </DropdownMenuItem>
          <DropdownMenuItem disabled={onHide === undefined} onClick={onHide}>
            <EyeOff />
            Hide column
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={onDispatchAll === undefined || readyCount === 0}
            onClick={onDispatchAll}
          >
            <Play />
            Dispatch all ready{readyCount > 0 ? ` (${readyCount})` : ''}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton label={`New task in ${status}`} onClick={onAdd}>
        <Plus aria-hidden />
      </IconButton>
    </div>
  );
}

/**
 * The board (§5): status columns 348px wide sitting directly on the panel, a shared 44px
 * header row that sticks to the top, and — when grouped by epic — one `EpicLaneHeader`
 * per epic over its own set of columns. Columns come from the project's own
 * `.dispatch/config.yml` order, never a hardcoded status list (grouping itself is
 * `lib/boardGrouping.ts`'s pure, unit-tested `groupTasksByEpicLane`).
 *
 * Epics are containers rather than cards — they head a lane instead of sitting in a status
 * column, so only plain tasks are ever dragged. A `PointerSensor` with a 6px activation
 * distance keeps an ordinary click opening the peek (only real pointer travel lifts a
 * card), plus a `KeyboardSensor` for accessible drag. Dropping onto a different column
 * calls `onMoveStatus`; `DragOverlay` renders a lifted copy so the original fades in place.
 */
export function TaskBoard({
  tasks,
  statuses,
  readyIds,
  blockedIds,
  liveRunStateByTaskId,
  latestRunByTaskId,
  attentionByTaskId,
  epicProgressById,
  epicConcurrencyDefault,
  epics,
  groupByEpic = false,
  display = DEFAULT_TASKS_DISPLAY,
  collapsedLaneKeys,
  onToggleLane,
  collapsedColumns = NO_IDS,
  onToggleColumnCollapsed,
  onHideColumn,
  hiddenColumnCount = 0,
  onShowHiddenColumns,
  onRequestWorkEpic,
  onSelect,
  onDispatch,
  onWorkEpic,
  onStopEpic,
  onLandEpic,
  onMoveStatus,
  onEditTask,
  focusedTaskId = null,
  onCardFocus,
  archivedTaskIds = NO_IDS,
}: TaskBoardProps) {
  const shell = useShellActions();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  // The same lanes `BoardView` derives for its j/k order, from the same pure function and the
  // same (pre-sorted) input — deliberately recomputed here rather than passed down, so the two
  // never have to be kept in sync as a pair of props that could disagree.
  const lanes = useMemo<BoardLane[]>(() => {
    if (groupByEpic) return groupTasksByEpicLane(tasks, statuses, epics);
    // Flat board: one headerless lane holding every task (epics are lane headings in the
    // grouped board, so they have no card to show here either).
    const columns = groupTasksByStatus(
      tasks.filter((t) => t.meta.kind !== 'epic'),
      statuses
    );
    return [
      {
        epicId: null,
        title: '',
        columns,
        total: columns.reduce((n, c) => n + c.tasks.length, 0),
      },
    ];
  }, [tasks, statuses, epics, groupByEpic]);
  const statusCounts = useMemo(
    () => countLaneStatuses(lanes, statuses),
    [lanes, statuses]
  );
  // Ready task ids per status, for `Dispatch all ready` and its count.
  const readyByStatus = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const lane of lanes) {
      for (const column of lane.columns) {
        const ids = map.get(column.status) ?? [];
        for (const doc of column.tasks) {
          if (readyIds.has(doc.meta.id) && !archivedTaskIds.has(doc.meta.id)) {
            ids.push(doc.meta.id);
          }
        }
        map.set(column.status, ids);
      }
    }
    return map;
  }, [lanes, readyIds, archivedTaskIds]);

  const epicById = useMemo(() => {
    const map = new Map<string, TaskDoc>();
    for (const epic of epics) map.set(epic.meta.id, epic);
    return map;
  }, [epics]);

  const taskById = useMemo(() => {
    const map = new Map<string, TaskDoc>();
    for (const doc of tasks) map.set(doc.meta.id, doc);
    return map;
  }, [tasks]);

  // Every epic's children, bucketed in one pass — feeds `EpicLaneHeader`'s rolled-up status
  // and dependency-graph modal, which need the epic's own children, not the whole project.
  const childrenByEpicId = useMemo(() => {
    const map = new Map<string, TaskDoc[]>();
    for (const doc of tasks) {
      if (doc.meta.parent === null) continue;
      const bucket = map.get(doc.meta.parent);
      if (bucket !== undefined) bucket.push(doc);
      else map.set(doc.meta.parent, [doc]);
    }
    return map;
  }, [tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveTaskId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);
    const overId = event.over?.id;
    if (overId === undefined || onMoveStatus === undefined) return;
    const targetStatus = statusFromDropZoneId(String(overId));
    if (targetStatus === null) return;
    const taskId = String(event.active.id);
    const doc = taskById.get(taskId);
    if (doc === undefined || doc.meta.status === targetStatus) return;
    void onMoveStatus(taskId, targetStatus);
  }

  function dispatchAll(status: string) {
    if (onDispatch === undefined) return;
    for (const id of readyByStatus.get(status) ?? []) void onDispatch(id);
  }

  const activeDoc =
    activeTaskId !== null ? taskById.get(activeTaskId) : undefined;
  const columnClass = (status: string) =>
    collapsedColumns.has(status) ? COLLAPSED_COLUMN_CLASS : COLUMN_CLASS;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveTaskId(null)}
    >
      <div
        data-slot="task-board"
        className="flex h-full min-h-0 flex-col overflow-auto pb-2"
      >
        {/* One column header row for the whole board rather than a set per lane: the lanes
            already repeat the same statuses in the same order, and a header that sticks to
            the top stays useful however far down the epics you scroll. */}
        <div className="bg-background sticky top-0 z-10 flex w-max items-start">
          {statuses.map((status) => (
            <ColumnHeader
              key={status}
              status={status}
              count={statusCounts.get(status) ?? 0}
              readyCount={readyByStatus.get(status)?.length ?? 0}
              collapsed={collapsedColumns.has(status)}
              onToggleCollapsed={
                onToggleColumnCollapsed !== undefined
                  ? () => onToggleColumnCollapsed(status)
                  : undefined
              }
              onHide={
                onHideColumn !== undefined
                  ? () => onHideColumn(status)
                  : undefined
              }
              onDispatchAll={
                onDispatch !== undefined ? () => dispatchAll(status) : undefined
              }
              onAdd={() => shell.openCreateTask({ status })}
            />
          ))}
          {hiddenColumnCount > 0 && onShowHiddenColumns !== undefined && (
            <div className="flex h-11 items-center px-3">
              <PillButton onClick={onShowHiddenColumns}>
                <ChevronsLeftRight />
                {hiddenColumnCount} hidden{' '}
                {hiddenColumnCount === 1 ? 'column' : 'columns'}
              </PillButton>
            </div>
          )}
        </div>

        <div className="flex w-max flex-col gap-4">
          {lanes.map((lane, laneIndex) => {
            const key = laneKey(lane.epicId);
            // The flat board's single lane has no header to collapse from — always open.
            const expanded = !groupByEpic || !collapsedLaneKeys.has(key);
            const epic =
              lane.epicId !== null ? (epicById.get(lane.epicId) ?? null) : null;
            return (
              <section key={key} data-lane-key={key}>
                {groupByEpic && (
                  <div className="px-3">
                    <EpicLaneHeader
                      epic={epic}
                      title={lane.title}
                      total={lane.total}
                      expanded={expanded}
                      onToggle={() => onToggleLane(key)}
                      progress={
                        epic !== null
                          ? epicProgressById.get(epic.meta.id)
                          : undefined
                      }
                      concurrencyDefault={epicConcurrencyDefault}
                      childTasks={
                        epic !== null
                          ? (childrenByEpicId.get(epic.meta.id) ?? [])
                          : []
                      }
                      onOpenTask={onSelect}
                      onWork={onWorkEpic}
                      onRequestWork={onRequestWorkEpic}
                      onStop={onStopEpic}
                      onLand={onLandEpic}
                      onAdd={() =>
                        shell.openCreateTask(
                          epic !== null ? { epic: epic.meta.id } : undefined
                        )
                      }
                    />
                  </div>
                )}
                {expanded && (
                  <div className="flex items-start">
                    {lane.columns.map(({ status, tasks: laneTasks }) => (
                      <div
                        key={status}
                        className={cn('flex flex-col', columnClass(status))}
                      >
                        {collapsedColumns.has(status) ? (
                          <div className="min-h-16" />
                        ) : (
                          <DroppableColumn id={dropZoneId(laneIndex, status)}>
                            {laneTasks.map((doc) => (
                              <DraggableCard
                                key={doc.meta.id}
                                id={doc.meta.id}
                                disabled={archivedTaskIds.has(doc.meta.id)}
                              >
                                {(drag) => (
                                  <TaskCardTile
                                    doc={doc}
                                    ready={readyIds.has(doc.meta.id)}
                                    blocked={blockedIds.has(doc.meta.id)}
                                    liveRunState={liveRunStateByTaskId.get(
                                      doc.meta.id
                                    )}
                                    run={latestRunByTaskId.get(doc.meta.id)}
                                    // Grouped board: the lane heading already names the
                                    // epic, so the card skips the crumb. Flat board: the
                                    // crumb is how a card keeps its epic.
                                    epicTitle={
                                      groupByEpic || doc.meta.parent === null
                                        ? undefined
                                        : (epicById.get(doc.meta.parent)?.meta
                                            .title ?? doc.meta.parent)
                                    }
                                    statuses={statuses}
                                    properties={display.properties}
                                    onStatusChange={(next) =>
                                      void onMoveStatus?.(doc.meta.id, next)
                                    }
                                    onEditTask={(patch) =>
                                      void onEditTask?.(doc.meta.id, patch)
                                    }
                                    onClick={() => onSelect(doc.meta.id)}
                                    onDispatch={
                                      readyIds.has(doc.meta.id) &&
                                      onDispatch !== undefined
                                        ? () => onDispatch(doc.meta.id)
                                        : undefined
                                    }
                                    focused={doc.meta.id === focusedTaskId}
                                    onFocus={() => onCardFocus?.(doc.meta.id)}
                                    drag={drag}
                                    archived={archivedTaskIds.has(doc.meta.id)}
                                    needsAttention={
                                      attentionByTaskId?.has(doc.meta.id) ===
                                      true
                                    }
                                  />
                                )}
                              </DraggableCard>
                            ))}
                          </DroppableColumn>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
      <DragOverlay>
        {/* Only plain tasks are draggable, so the lifted ghost is always a task card. */}
        {activeDoc !== undefined && (
          <div className="rounded-card shadow-raised w-[322px] cursor-grabbing">
            <TaskCardTile
              doc={activeDoc}
              ready={readyIds.has(activeDoc.meta.id)}
              blocked={blockedIds.has(activeDoc.meta.id)}
              liveRunState={liveRunStateByTaskId.get(activeDoc.meta.id)}
              run={latestRunByTaskId.get(activeDoc.meta.id)}
              statuses={statuses}
              properties={display.properties}
              onStatusChange={() => {}}
              onEditTask={() => {}}
              onClick={() => {}}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

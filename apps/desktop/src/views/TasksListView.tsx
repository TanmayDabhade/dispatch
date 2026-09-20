import type { Assignee, Priority, TaskDoc } from '@dispatch/core/browser';
import { PRIORITY_ORDER } from '@dispatch/core/browser';
import {
  Archive,
  ArrowUpRight,
  Ban,
  CircleDot,
  Copy,
  Eye,
  Milestone,
  Play,
  SearchX,
  SignalHigh,
  Tag,
  Target,
  User,
  Waypoints,
} from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useShellActions } from '../components/shell/ShellActionsContext';
import { AssigneeAvatar } from '../components/tasks/AssigneeAvatar';
import { DispatchDialog } from '../components/tasks/DispatchDialog';
import { EpicDagModal } from '../components/tasks/EpicDagModal';
import { PriorityIcon } from '../components/tasks/PriorityIcon';
import { StatusIcon } from '../components/tasks/StatusIcon';
import type { DispatchProjectData } from '../hooks/useDispatchProject';
import {
  COLLAPSED_GROUPS_STORAGE_KEY,
  readCollapsedGroups,
  toggleCollapsedGroup,
  writeCollapsedGroups,
} from '../lib/collapsedEpics';
import {
  type GroupIcon,
  groupTasks,
  type ListGroup,
  visibleRowIds,
} from '../lib/listGrouping';
import { colorForEpic } from '../lib/projectColor';
import { assigneeLabel, priorityLabel, statusLabel } from '../lib/taskDisplay';
import {
  DEFAULT_TASKS_DISPLAY,
  type TasksDisplayPrefs,
} from '../lib/tasksPrefs';
import {
  handleTaskListKeyDown,
  type OpenPicker,
  TaskListRow,
} from './TaskListRow';
import { GroupHeader } from '@/ui/ai/group-header';
import { IconButton } from '@/ui/ai/icon-button';
import { PillButton } from '@/ui/ai/pill';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/chrome';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/ui/context-menu';

interface TasksListViewProps {
  data: DispatchProjectData;
  onSelectTask: (taskId: string) => void;
  /** The Tasks page's shared filters (status/priority facets), applied before grouping.
   * Omitted passes everything. */
  taskFilter?: (doc: TaskDoc) => boolean;
  /** The Display popover's model — grouping, ordering, which properties a row shows. */
  display?: TasksDisplayPrefs;
  /** `f` on the list: the page header opens its filter menu. No-op until wired. */
  onRequestFilter?: () => void;
  /** `⇧V` on the list: the page header opens its Display popover. No-op until wired. */
  onRequestDisplay?: () => void;
}

const PRIORITIES = Object.keys(PRIORITY_ORDER) as Priority[];
const ASSIGNEES: Assignee[] = ['agent', 'human', 'none'];

/**
 * Linear's list layout for Tasks: rows straight on the panel (no card, no column header, no
 * dividers), grouped under status-tinted 36px `GroupHeader`s with a `+` each, every row a
 * 36px `ListRow` — priority glyph, sans id, status glyph, title, then the right-aligned pills
 * (labels, epic chip, sub-task count, live run mark, assignee) and the absolute date. The
 * grouping/ordering/properties come from `display` (`groupTasks`), the same model the board
 * and Milestones read. A right-click menu and the single-key shortcuts (`s p a e` pickers,
 * `x` select, `d` dispatch, `o`/Enter open, Space peek, `⌘C` copy id, `j/k`) work on the
 * focused row; bulk selection surfaces a dispatch bar at the bottom. The caller owns the
 * page header, view tabs and filter/display controls; this only renders once the project
 * has tasks, so its own empty state covers "the filter matched nothing".
 */
export function TasksListView({
  data,
  onSelectTask,
  taskFilter,
  display,
  onRequestFilter,
  onRequestDisplay,
}: TasksListViewProps) {
  const shell = useShellActions();
  const prefs = display ?? DEFAULT_TASKS_DISPLAY;

  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    readCollapsedGroups(COLLAPSED_GROUPS_STORAGE_KEY)
  );
  // Which epic's dependency graph is open, or `null`. View-local: nothing outside this list
  // needs to know.
  const [dagEpicId, setDagEpicId] = useState<string | null>(null);
  // Multi-select for bulk actions. Kept here rather than lifted: nothing outside this list
  // needs to know what is ticked, and it should clear when you navigate away.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [picker, setPicker] = useState<OpenPicker | null>(null);
  // The row the context menu was opened on — set by the row's own `onContextMenu` before
  // the (single, list-wide) menu trigger handles the same event.
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const epicById = useMemo(() => {
    const map = new Map<string, TaskDoc>();
    for (const epic of data.epics) map.set(epic.meta.id, epic);
    return map;
  }, [data.epics]);

  // Children per parent, for the epic row's `▶ N` sub-task count.
  const childCountByParent = useMemo(() => {
    const map = new Map<string, number>();
    for (const doc of data.tasks) {
      if (doc.meta.parent === null) continue;
      map.set(doc.meta.parent, (map.get(doc.meta.parent) ?? 0) + 1);
    }
    return map;
  }, [data.tasks]);

  // Every label in use, for the context menu's Labels submenu.
  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const doc of data.tasks) for (const l of doc.meta.labels) set.add(l);
    return [...set].sort();
  }, [data.tasks]);

  const dagEpic = dagEpicId !== null ? (epicById.get(dagEpicId) ?? null) : null;
  // Memoized so the array is stable while the modal is open — a fresh array every render
  // would bust EpicDagView's own `[tasks]` memo.
  const dagTasks = useMemo(
    () =>
      dagEpicId !== null
        ? data.tasks.filter((t) => t.meta.parent === dagEpicId)
        : [],
    [data.tasks, dagEpicId]
  );

  const groups = useMemo<ListGroup[]>(() => {
    if (data.config === null) return [];
    const passes = (doc: TaskDoc) => taskFilter?.(doc) ?? true;
    return groupTasks(data.tasks.filter(passes), prefs, {
      statuses: data.config.statuses,
      epics: data.epics,
      archivedTasks: data.showArchived
        ? data.archivedTasks.filter(passes)
        : undefined,
    });
  }, [
    data.tasks,
    data.config,
    data.epics,
    data.showArchived,
    data.archivedTasks,
    taskFilter,
    prefs,
  ]);

  const docById = useMemo(() => {
    const map = new Map<string, TaskDoc>();
    for (const g of groups)
      for (const r of g.rows) map.set(r.doc.meta.id, r.doc);
    return map;
  }, [groups]);

  const archivedIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      if (g.archived) for (const r of g.rows) set.add(r.doc.meta.id);
    }
    return set;
  }, [groups]);

  // j/k only walks rows in expanded groups — a collapsed group's tasks are no more reachable
  // by keyboard than they are visible.
  const orderedIds = useMemo(
    () => visibleRowIds(groups, collapsed),
    [groups, collapsed]
  );

  const selectedTasks = useMemo(
    () => data.tasks.filter((t) => selectedIds.has(t.meta.id)),
    [data.tasks, selectedIds]
  );
  const selectedReady = useMemo(
    () => selectedTasks.filter((t) => data.readyIds.has(t.meta.id)),
    [selectedTasks, data.readyIds]
  );

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = toggleCollapsedGroup(prev, key);
      writeCollapsedGroups(COLLAPSED_GROUPS_STORAGE_KEY, next);
      return next;
    });
  }

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  // Keeps the cursor on a visible row whenever the filter or grouping changes.
  useEffect(() => {
    if (orderedIds.length === 0) {
      setFocusedTaskId(null);
    } else if (focusedTaskId === null || !orderedIds.includes(focusedTaskId)) {
      setFocusedTaskId(orderedIds[0] ?? null);
    }
  }, [orderedIds, focusedTaskId]);

  function dispatchOne(taskId: string) {
    if (!data.readyIds.has(taskId)) return;
    void data.handleDispatch(taskId);
  }

  // Only a keyboard move scrolls — a hover that set the cursor must not shift the list under
  // the pointer (which would hand the cursor to the next row and scroll again).
  function moveCursor(id: string | null) {
    setFocusedTaskId(id);
    if (id === null) return;
    listRef.current
      ?.querySelector(`[data-row-id="${id}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  function handleListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    handleTaskListKeyDown(e, {
      orderedIds,
      focusedTaskId,
      setFocusedTaskId: moveCursor,
      onOpen: onSelectTask,
      onPeek: shell.peekTask,
      onSelectToggle: toggleSelected,
      onDispatch: dispatchOne,
      onCopyId: shell.copyTaskId,
      setPicker,
      onEscape: () => {
        if (selectedIds.size === 0 && picker === null) return false;
        setSelectedIds(new Set());
        setPicker(null);
        return true;
      },
      onRequestFilter,
      onRequestDisplay,
    });
  }

  const groupIcon = (icon: GroupIcon): ReactNode => {
    if (icon === null) return undefined;
    switch (icon.kind) {
      case 'status':
      case 'milestone':
        return <StatusIcon status={icon.status} />;
      case 'epic':
        return icon.epicId === null ? (
          <Milestone className="text-muted-foreground size-3.5" />
        ) : (
          <span
            aria-hidden
            className="size-2.5 rounded-[3px]"
            style={{ backgroundColor: colorForEpic(icon.epicId) }}
          />
        );
      case 'assignee':
        return <AssigneeAvatar assignee={icon.assignee} size={16} />;
      case 'priority':
        return <PriorityIcon priority={icon.priority} />;
    }
  };

  // Under an epic or milestone header the ` › epic` chip repeats the header.
  const showEpicChip =
    prefs.grouping !== 'epic' && prefs.grouping !== 'milestone';

  const menuDoc = menuTaskId !== null ? docById.get(menuTaskId) : undefined;
  const menuEditable =
    menuDoc !== undefined && !archivedIds.has(menuDoc.meta.id);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Keyed on the groups, not the visible rows: collapsing every group must leave the
          headers (and their chevrons) in place. */}
      {groups.length === 0 ? (
        <EmptyState
          icon={SearchX}
          heading="No tasks match"
          description="Nothing passes the current filter. Clear it to see the project's tasks."
          className="flex-1"
        />
      ) : (
        <ContextMenu
          onOpenChange={(open) => {
            if (!open) setMenuTaskId(null);
          }}
        >
          <ContextMenuTrigger
            render={
              <div
                ref={listRef}
                tabIndex={0}
                role="grid"
                aria-label="Tasks"
                onKeyDown={handleListKeyDown}
                className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 outline-none"
              />
            }
          >
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.key);
              const knownEpic =
                group.epicId !== null && epicById.has(group.epicId);
              return (
                <div key={group.key} data-group-key={group.key}>
                  {group.kind !== 'none' && (
                    <GroupHeader
                      tint={group.tint ?? undefined}
                      icon={groupIcon(group.icon)}
                      name={group.label}
                      count={group.rows.length}
                      collapsed={isCollapsed}
                      onToggle={() => toggleGroup(group.key)}
                      onAdd={
                        group.archived
                          ? undefined
                          : () => shell.openCreateTask(group.preset)
                      }
                      addLabel={`New task in ${group.label}`}
                      actions={
                        knownEpic ? (
                          <IconButton
                            label={`View dependency graph for ${group.label}`}
                            onClick={() => setDagEpicId(group.epicId)}
                          >
                            <Waypoints aria-hidden />
                          </IconButton>
                        ) : undefined
                      }
                    />
                  )}
                  {!isCollapsed &&
                    group.rows.map((row) => {
                      const id = row.doc.meta.id;
                      return (
                        <TaskListRow
                          key={id}
                          doc={row.doc}
                          data={data}
                          prefs={prefs}
                          indent={row.indent}
                          archived={group.archived}
                          epic={
                            row.doc.meta.parent !== null
                              ? epicById.get(row.doc.meta.parent)
                              : undefined
                          }
                          childCount={childCountByParent.get(id) ?? 0}
                          showEpicChip={showEpicChip}
                          picker={picker}
                          onPickerChange={setPicker}
                          selected={selectedIds.has(id)}
                          focused={focusedTaskId === id}
                          onOpen={() => onSelectTask(id)}
                          onFocus={() => setFocusedTaskId(id)}
                          onContextMenu={() => {
                            setMenuTaskId(id);
                            setFocusedTaskId(id);
                          }}
                          onSelectToggle={() => toggleSelected(id)}
                        />
                      );
                    })}
                </div>
              );
            })}
          </ContextMenuTrigger>
          {menuDoc !== undefined && (
            <ContextMenuContent className="min-w-[180px]">
              {menuEditable && (
                <>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <CircleDot />
                      Status
                      <ContextMenuShortcut>S</ContextMenuShortcut>
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {(data.config?.statuses ?? []).map((status) => (
                        <ContextMenuItem
                          key={status}
                          onClick={() =>
                            void data.moveTaskStatus(menuDoc.meta.id, status)
                          }
                        >
                          <StatusIcon status={status} />
                          {statusLabel(status)}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <SignalHigh />
                      Priority
                      <ContextMenuShortcut>P</ContextMenuShortcut>
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {PRIORITIES.map((priority) => (
                        <ContextMenuItem
                          key={priority}
                          onClick={() =>
                            void data.handleUpdate(menuDoc.meta.id, {
                              priority,
                            })
                          }
                        >
                          <PriorityIcon priority={priority} />
                          {priorityLabel(priority)}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <User />
                      Assignee
                      <ContextMenuShortcut>A</ContextMenuShortcut>
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {ASSIGNEES.map((assignee) => (
                        <ContextMenuItem
                          key={assignee}
                          onClick={() =>
                            void data.handleUpdate(menuDoc.meta.id, {
                              assignee,
                            })
                          }
                        >
                          <AssigneeAvatar assignee={assignee} size={16} />
                          {assigneeLabel(assignee)}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <Tag />
                      Labels
                      <ContextMenuShortcut>L</ContextMenuShortcut>
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {allLabels.length === 0 ? (
                        <ContextMenuItem disabled>
                          No labels yet
                        </ContextMenuItem>
                      ) : (
                        allLabels.map((label) => (
                          <ContextMenuCheckboxItem
                            key={label}
                            checked={menuDoc.meta.labels.includes(label)}
                            onCheckedChange={(checked) =>
                              void data.handleUpdate(menuDoc.meta.id, {
                                labels: checked
                                  ? [...menuDoc.meta.labels, label]
                                  : menuDoc.meta.labels.filter(
                                      (l) => l !== label
                                    ),
                              })
                            }
                          >
                            {label}
                          </ContextMenuCheckboxItem>
                        ))
                      )}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <Milestone />
                      Epic
                      <ContextMenuShortcut>E</ContextMenuShortcut>
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      <ContextMenuItem
                        onClick={() =>
                          void data.handleUpdate(menuDoc.meta.id, {
                            parent: null,
                          })
                        }
                      >
                        No epic
                      </ContextMenuItem>
                      {data.epics.map((epic) => (
                        <ContextMenuItem
                          key={epic.meta.id}
                          onClick={() =>
                            void data.handleUpdate(menuDoc.meta.id, {
                              parent: epic.meta.id,
                            })
                          }
                        >
                          {epic.meta.title}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  {/* Milestone = epic today (e-be4827): the same choices, the same field. */}
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <Target />
                      Milestone
                      <ContextMenuShortcut>M</ContextMenuShortcut>
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {data.epics.map((epic) => (
                        <ContextMenuItem
                          key={epic.meta.id}
                          onClick={() =>
                            void data.handleUpdate(menuDoc.meta.id, {
                              parent: epic.meta.id,
                            })
                          }
                        >
                          {epic.meta.title}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                </>
              )}
              <ContextMenuItem onClick={() => onSelectTask(menuDoc.meta.id)}>
                <ArrowUpRight />
                Open
                <ContextMenuShortcut>O</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem onClick={() => shell.peekTask(menuDoc.meta.id)}>
                <Eye />
                Peek
                <ContextMenuShortcut>Space</ContextMenuShortcut>
              </ContextMenuItem>
              {menuEditable && (
                <ContextMenuItem
                  disabled={!data.readyIds.has(menuDoc.meta.id)}
                  onClick={() => dispatchOne(menuDoc.meta.id)}
                >
                  <Play />
                  Dispatch
                  <ContextMenuShortcut>D</ContextMenuShortcut>
                </ContextMenuItem>
              )}
              <ContextMenuItem
                onClick={() => shell.copyTaskId(menuDoc.meta.id)}
              >
                <Copy />
                Copy id
                <ContextMenuShortcut>⌘C</ContextMenuShortcut>
              </ContextMenuItem>
              {menuEditable && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() =>
                      void data.handleUpdate(menuDoc.meta.id, {
                        archivedAt: new Date().toISOString(),
                      })
                    }
                  >
                    <Archive />
                    Archive
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() =>
                      void data.moveTaskStatus(menuDoc.meta.id, 'dropped')
                    }
                  >
                    <Ban />
                    Drop
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          )}
        </ContextMenu>
      )}

      {/* Only appears once something is ticked, so the list is not permanently wearing a
          toolbar for an action most visits never take. */}
      {selectedIds.size > 0 && (
        <div className="bg-surface-quaternary rounded-card border-border-strong sticky bottom-0 mx-2 mb-2 flex h-9 items-center gap-2 border-[0.5px] px-3">
          <span className="text-[13px] font-medium">
            {selectedIds.size} selected
          </span>
          <span className="font-book text-muted-foreground text-[12px]">
            {selectedReady.length} ready to dispatch
          </span>
          <span className="flex-1" />
          <Button
            disabled={selectedReady.length === 0}
            onClick={() => setDispatchOpen(true)}
          >
            Dispatch {selectedReady.length}
          </Button>
          <PillButton onClick={() => setSelectedIds(new Set())}>
            Clear
          </PillButton>
        </div>
      )}

      {dispatchOpen && (
        <DispatchDialog
          title={`Send agents at ${selectedIds.size} selected ${
            selectedIds.size === 1 ? 'task' : 'tasks'
          }`}
          tasks={selectedTasks}
          readyIds={data.readyIds}
          runningNow={data.liveRunStateByTaskId.size}
          defaultConcurrency={data.config?.orchestrator.epicConcurrency ?? 3}
          onCancel={() => setDispatchOpen(false)}
          onConfirm={async ({ concurrency }) => {
            // Dispatched one at a time up to the chosen concurrency, matching what the preview
            // promised — the per-task endpoint is the only one that takes an arbitrary set.
            const starting = selectedReady.slice(0, concurrency);
            // Marking a real batch keeps the app in the list instead of following each run
            // in turn as the loop creates it (see DispatchOptions). Starting exactly one is
            // an ordinary single dispatch and still jumps to its Chat.
            const batch = starting.length > 1;
            for (const task of starting) {
              await data.handleDispatch(task.meta.id, undefined, undefined, {
                batch,
              });
            }
            setDispatchOpen(false);
            setSelectedIds(new Set());
          }}
        />
      )}

      <EpicDagModal
        epic={dagEpic}
        tasks={dagTasks}
        onOpenTask={onSelectTask}
        onClose={() => setDagEpicId(null)}
      />
    </div>
  );
}

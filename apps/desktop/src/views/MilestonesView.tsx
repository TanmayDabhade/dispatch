import type { TaskDoc } from '@dispatch/core/browser';
import { Target } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { DaemonUnavailable } from '../components/shell/DaemonUnavailable';
import { useShellActions } from '../components/shell/ShellActionsContext';
import { pieDashOffset, StatusIcon } from '../components/tasks/StatusIcon';
import type { DispatchProjectData } from '../hooks/useDispatchProject';
import {
  readCollapsedGroups,
  toggleCollapsedGroup,
  TOGGLED_MILESTONES_STORAGE_KEY,
  writeCollapsedGroups,
} from '../lib/collapsedEpics';
import { groupTasks, visibleRowIds } from '../lib/listGrouping';
import {
  deriveMilestoneStatus,
  milestoneHealthPill,
} from '../lib/milestoneRisk';
import { isMilestoneFinished } from '../lib/milestoneRollup';
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
import { LabelPill } from '@/ui/ai/pill';
import { EmptyState } from '@/ui/chrome';

interface MilestonesViewProps {
  data: DispatchProjectData;
  onOpenTask: (taskId: string) => void;
  /** The Display popover's model; the milestones layout reads its ordering and row
   * properties and always groups by milestone. */
  display?: TasksDisplayPrefs;
  onRequestFilter?: () => void;
  onRequestDisplay?: () => void;
}

// The pie's full arc is `StatusIcon`'s (Linear's) dash length — `pieDashOffset(0)` hides all
// of it, so it is that length; reading it back keeps the two glyphs on one recipe.
const PIE_DASH = pieDashOffset(0);
const PIE_DASHARRAY = `${PIE_DASH} ${PIE_DASH * 2}`;

// A milestone's progress glyph at 12px: `StatusIcon`'s r=6 ring and r=2 pie, the pie filled
// to `fraction` by the same dashoffset the status icons use — the `◔ 2/5` Linear draws in a
// sub-issues header.
function ProgressGlyph({ fraction }: { fraction: number }) {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      className="size-3 shrink-0 text-(--text-secondary)"
    >
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
      <circle
        cx="7"
        cy="7"
        r="2"
        stroke="currentColor"
        strokeWidth="4"
        strokeDasharray={PIE_DASHARRAY}
        strokeDashoffset={pieDashOffset(fraction)}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

/**
 * Milestones: every milestone is a status-tinted `GroupHeader` — the rolled-up status glyph
 * (the same vocabulary its tasks use), the title, a `◔ n/m` progress glyph and, when there
 * is something to say, one `At risk` / `N running` pill — over the same 36px `TaskListRow`s
 * the Tasks list renders, with the same pickers and single-key shortcuts. A finished
 * milestone (every child landed/dropped) reads as landed and sinks to the bottom, starting
 * collapsed. Milestone = epic here, front-running the epic→milestone rename (e-be4827).
 */
export function MilestonesView({
  data,
  onOpenTask,
  display,
  onRequestFilter,
  onRequestDisplay,
}: MilestonesViewProps) {
  const shell = useShellActions();
  const prefs = useMemo<TasksDisplayPrefs>(
    () => ({ ...(display ?? DEFAULT_TASKS_DISPLAY), grouping: 'milestone' }),
    [display]
  );
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [picker, setPicker] = useState<OpenPicker | null>(null);
  // Milestones the user has flipped away from their default fold (unfinished start open,
  // finished start collapsed). Session-scoped under this page's own key so the fold survives
  // a view switch; the list's key stores "collapsed", which would read backwards here.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() =>
    readCollapsedGroups(TOGGLED_MILESTONES_STORAGE_KEY)
  );
  const listRef = useRef<HTMLDivElement>(null);

  const epicById = useMemo(() => {
    const map = new Map<string, TaskDoc>();
    for (const epic of data.epics) map.set(epic.meta.id, epic);
    return map;
  }, [data.epics]);

  // Every milestone, empty ones included — a milestone with no tasks yet is still a plan.
  const groups = useMemo(
    () =>
      groupTasks(
        data.tasks,
        { ...prefs, showEmptyGroups: true },
        {
          statuses: data.config?.statuses ?? [],
          epics: data.epics,
        }
      ).filter((g) => g.epicId !== null),
    [data.tasks, data.config, data.epics, prefs]
  );

  // A finished milestone's default is folded, so its key in `toggled` means "opened".
  const collapsed = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      const finished = isMilestoneFinished(g.rows.map((r) => r.doc));
      if (finished !== toggled.has(g.key)) set.add(g.key);
    }
    return set;
  }, [groups, toggled]);

  const orderedIds = useMemo(
    () => visibleRowIds(groups, collapsed),
    [groups, collapsed]
  );

  useEffect(() => {
    if (orderedIds.length === 0) {
      setFocusedTaskId(null);
    } else if (focusedTaskId === null || !orderedIds.includes(focusedTaskId)) {
      setFocusedTaskId(orderedIds[0] ?? null);
    }
  }, [orderedIds, focusedTaskId]);

  const daemonReady =
    !data.portLoading && !data.portError && data.client !== null;
  const showList = daemonReady && groups.length > 0;

  // The grid takes focus once it is on screen so j/k/s/p work without a click first.
  useEffect(() => {
    if (showList) listRef.current?.focus();
  }, [showList]);

  if (!daemonReady) {
    return (
      <DaemonUnavailable
        starting={data.portLoading}
        errorDetail={data.portErrorDetail}
        onRetry={data.retryEnsureDispatchd}
      />
    );
  }

  function toggle(key: string) {
    setToggled((prev) => {
      const next = toggleCollapsedGroup(prev, key);
      writeCollapsedGroups(TOGGLED_MILESTONES_STORAGE_KEY, next);
      return next;
    });
  }

  // Only a keyboard move scrolls — a hover that set the cursor must not shift the list under
  // the pointer.
  function moveCursor(id: string | null) {
    setFocusedTaskId(id);
    if (id === null) return;
    listRef.current
      ?.querySelector(`[data-row-id="${id}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    handleTaskListKeyDown(e, {
      orderedIds,
      focusedTaskId,
      setFocusedTaskId: moveCursor,
      onOpen: onOpenTask,
      onPeek: shell.peekTask,
      onDispatch: (id) => {
        if (data.readyIds.has(id)) void data.handleDispatch(id);
      },
      onCopyId: shell.copyTaskId,
      setPicker,
      onEscape: () => {
        if (picker === null) return false;
        setPicker(null);
        return true;
      },
      onRequestFilter,
      onRequestDisplay,
    });
  }

  if (!showList) {
    return (
      <EmptyState
        icon={Target}
        heading="No milestones yet"
        description="A milestone is an epic with its tasks under it. Plan work… drafts one for you."
        primary={{
          label: 'Plan work…',
          onClick: () => shell.setProjectView('plans'),
        }}
        secondary={{
          label: 'New task',
          onClick: () => shell.openCreateTask(),
        }}
        className="h-full"
      />
    );
  }

  return (
    <div
      ref={listRef}
      tabIndex={0}
      role="grid"
      aria-label="Milestones"
      onKeyDown={handleKeyDown}
      className="flex h-full min-h-0 flex-col overflow-y-auto px-2 pb-2 outline-none"
    >
      {groups.map((group) => {
        const children = group.rows.map((r) => r.doc);
        const done = children.filter(
          (t) => t.meta.status === 'landed' || t.meta.status === 'dropped'
        ).length;
        const finished = isMilestoneFinished(children);
        const status = deriveMilestoneStatus(
          children,
          data.latestRunByTaskId,
          finished
        );
        const health = milestoneHealthPill(status);
        const isCollapsed = collapsed.has(group.key);
        const epicId = group.epicId ?? '';
        return (
          <div key={group.key} data-group-key={group.key}>
            <GroupHeader
              tint={group.tint ?? undefined}
              icon={
                group.icon?.kind === 'milestone' ? (
                  <StatusIcon status={group.icon.status} />
                ) : undefined
              }
              name={group.label}
              collapsed={isCollapsed}
              onToggle={() => toggle(group.key)}
              onAdd={() => shell.openCreateTask(group.preset)}
              addLabel={`New task in ${group.label}`}
              actions={
                <>
                  <span
                    data-slot="milestone-progress"
                    aria-label={`${done} of ${children.length} landed`}
                    className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-(--text-secondary)"
                  >
                    <ProgressGlyph
                      fraction={
                        children.length === 0 ? 0 : done / children.length
                      }
                    />
                    {done}/{children.length}
                  </span>
                  {health !== null && (
                    <LabelPill
                      color={health.tint}
                      title={status.reason ?? undefined}
                    >
                      {health.label}
                    </LabelPill>
                  )}
                  {epicById.has(epicId) && (
                    <IconButton
                      label={`Open ${group.label}`}
                      onClick={() => onOpenTask(epicId)}
                    >
                      <Target aria-hidden />
                    </IconButton>
                  )}
                </>
              }
            />
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
                    showEpicChip={false}
                    picker={picker}
                    onPickerChange={setPicker}
                    selected={false}
                    focused={focusedTaskId === id}
                    onOpen={() => onOpenTask(id)}
                    onFocus={() => setFocusedTaskId(id)}
                  />
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

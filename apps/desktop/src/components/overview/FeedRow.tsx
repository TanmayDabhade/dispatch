import {
  Ban,
  CircleAlert,
  ExternalLink,
  Eye,
  Gavel,
  Hand,
  MessageCircleQuestion,
  RotateCw,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { PriorityIcon } from '../tasks/PriorityIcon';
import type { FeedRowModel } from '@/lib/controlRoom';
import { feedTier, isUrgentState } from '@/lib/feedState';
import { formatRelativeTimeFromIso } from '@/lib/format';
import { cn } from '@/lib/utils';
import { InitialsAvatar } from '@/ui/ai/initials-avatar';
import { ListRow } from '@/ui/ai/list-row';
import { LabelPill, Pill, PillButton } from '@/ui/ai/pill';
import { StateMark } from '@/ui/chrome/state-mark';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/ui/context-menu';

export interface FeedRowActions {
  onOpen: (row: FeedRowModel) => void;
  onApprove: (row: FeedRowModel, allow: boolean) => void;
  onRetry: (row: FeedRowModel) => void;
  onReview: (row: FeedRowModel) => void;
  onCancelLanding: (row: FeedRowModel) => void;
  /** Opens the task itself — a ruling happens in the task detail's findings
   * panel, not on a run surface. */
  onRule: (row: FeedRowModel) => void;
  /** Caps the task's fix loop where it stands — offered while it is actively
   * implementing or reviewing. */
  onStopFixLoop: (row: FeedRowModel) => void;
}

/** Whether the row's loop is actually running rounds — the only time a Stop
 * button has anything to stop. */
function fixLoopActive(row: FeedRowModel): boolean {
  return (
    row.fixLoop !== null &&
    (row.fixLoop.state === 'implementing' || row.fixLoop.state === 'reviewing')
  );
}

/** The activity cell's loop phrasing — pass position plus the findings trace,
 * so a cycling task reads as a countdown ("Pass 3/5 · 9→4→1") rather than a
 * treadmill. Active loops name their phase; settled ones just say where the
 * loop stands. A loop that never opened a round says nothing. */
function fixLoopActivity(row: FeedRowModel): string | null {
  const loop = row.fixLoop;
  if (loop === null || loop.round === 0) return null;
  const trace = (loop.findingsTrace ?? []).join('→');
  const suffix = trace === '' ? '' : ` · ${trace}`;
  if (fixLoopActive(row)) {
    return `Fix round ${loop.round}/${loop.cap} · ${loop.state}${suffix}`;
  }
  if (loop.state === 'complete') return null;
  return `Pass ${loop.round}/${loop.cap}${suffix}`;
}

/** One menu entry: the label, the verb it fires, and the icon before it. */
interface RowAction {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
}

/** Every verb the row offers, in menu order. The first one marked `primary` is also the
 * hover-revealed pill at the row's right. A question's answer is free text, so it can only
 * be given on the Session tab; approving, retrying, reviewing and cancelling happen here. */
export function rowActions(
  row: FeedRowModel,
  actions: FeedRowActions
): { primary: RowAction | null; menu: RowAction[] } {
  const menu: RowAction[] = [];
  let primary: RowAction | null = null;
  const add = (action: RowAction, isPrimary = false) => {
    menu.push(action);
    if (isPrimary && primary === null) primary = action;
  };
  switch (row.state) {
    case 'answer':
      add(
        {
          id: 'answer',
          label: 'Answer',
          icon: <MessageCircleQuestion />,
          run: () => actions.onOpen(row),
        },
        true
      );
      break;
    case 'approve':
      add(
        {
          id: 'approve',
          label: 'Approve',
          icon: <ShieldCheck />,
          run: () => actions.onApprove(row, true),
        },
        true
      );
      add({
        id: 'deny',
        label: 'Deny',
        icon: <ShieldX />,
        run: () => actions.onApprove(row, false),
      });
      break;
    case 'ruling':
      add(
        {
          id: 'rule',
          label: 'Rule on findings',
          icon: <Gavel />,
          run: () => actions.onRule(row),
        },
        true
      );
      break;
    case 'failed':
      add(
        {
          id: 'retry',
          label: 'Retry',
          icon: <RotateCw />,
          run: () => actions.onRetry(row),
        },
        true
      );
      add({
        id: 'read-error',
        label: 'Read the error',
        icon: <CircleAlert />,
        run: () => actions.onOpen(row),
      });
      break;
    case 'review':
      add(
        {
          id: 'review',
          label: 'Review',
          icon: <Eye />,
          run: () => actions.onReview(row),
        },
        true
      );
      break;
    case 'landing':
      add({
        id: 'cancel-landing',
        label: 'Cancel landing',
        icon: <Ban />,
        run: () => actions.onCancelLanding(row),
      });
      break;
    default:
      break;
  }
  if (fixLoopActive(row)) {
    add({
      id: 'stop-loop',
      label: 'Stop loop',
      icon: <Hand />,
      run: () => actions.onStopFixLoop(row),
    });
  }
  return { primary, menu };
}

interface FeedRowProps {
  row: FeedRowModel;
  actions: FeedRowActions;
  /** The keyboard cursor: a neutral wash, never the accent. */
  focused?: boolean;
}

/**
 * One row of the Control room feed on Linear's 36px `ListRow`: priority glyph, sans task
 * id, the 14px state glyph, the title, then what the run is doing as a muted crumb and the
 * right-aligned pills — `Needs you` (amber dot) or `Broken` (red dot) when the row is
 * waiting on a human, the epic chip, the elapsed time and the agent's avatar. The verbs
 * live in the right-click menu; the one that matters most is also a hover-revealed pill,
 * so approving or retrying from here means never opening the run at all.
 */
export function FeedRow({ row, actions, focused = false }: FeedRowProps) {
  const urgent = isUrgentState(row.state);
  const tier = feedTier(row.state);
  const { primary, menu } = rowActions(row, actions);
  const activity = fixLoopActivity(row) ?? row.activity;
  const attention = row.attention?.reason ?? null;

  const listRow = (
    <ListRow
      data-run-id={row.runId}
      data-state={row.state}
      leading={<PriorityIcon priority={row.priority ?? 'none'} />}
      id={row.taskId}
      status={<StateMark state={row.state} />}
      title={row.title}
      crumb={attention ?? activity ?? undefined}
      focused={focused}
      onClick={() => actions.onOpen(row)}
      trailing={
        <>
          {primary !== null && (
            <PillButton
              onClick={(event) => {
                // Inside a clickable row: the pill must not also open the run behind it.
                event.stopPropagation();
                primary.run();
              }}
              className={cn(
                'opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 focus-visible:opacity-100',
                focused && 'opacity-100'
              )}
            >
              {primary.label}
            </PillButton>
          )}
          {urgent && (
            <LabelPill
              color={
                tier === 'you'
                  ? 'var(--state-waiting-fg)'
                  : 'var(--state-failed-fg)'
              }
              title={attention ?? undefined}
            >
              {tier === 'you' ? 'Needs you' : 'Broken'}
            </LabelPill>
          )}
          {row.epicTitle !== null && (
            <Pill className="max-w-40">
              <span className="truncate">{row.epicTitle}</span>
            </Pill>
          )}
          <InitialsAvatar name="Agent" />
        </>
      }
      date={formatRelativeTimeFromIso(row.since)}
    />
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div data-slot="feed-row" />}>
        {listRow}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[180px]">
        <ContextMenuItem onClick={() => actions.onOpen(row)}>
          <ExternalLink />
          Open run
        </ContextMenuItem>
        {menu.length > 0 && <ContextMenuSeparator />}
        {menu.map((action) => (
          <ContextMenuItem key={action.id} onClick={action.run}>
            {action.icon}
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

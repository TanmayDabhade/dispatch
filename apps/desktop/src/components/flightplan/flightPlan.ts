import type { StatusModel, TaskListItem } from '@dispatch/core/browser';
import {
  hasStatusRole,
  isDoneStatus,
  isSatisfiedForDispatchStatus,
  isStartedStatus,
  isUnstartedStatus,
} from '@dispatch/core/browser';

import { dagTaskFromDoc, dagWaves } from '../../lib/dagLayout';
import { assigneeRef } from '../../lib/taskDisplay';

// The Flight Plan's model: where each child of a fanned-out container stands, and the
// waves they run in. The Cockpit's mini (wave bar, slots, running count) and the full
// Flight Plan on a container's page both read this, so the two can never disagree about
// which wave a fan-out is on.

/**
 * One child's state in the plan.
 * - `done`: landed or dropped — finished either way.
 * - `running`: an agent is on it now.
 * - `teammate`: a person owns it and has started it; the fan-out never auto-picks it.
 * - `review`: the agent is done and it waits in review or landing — its dependents may
 *   already start (the server stacks them on its branch).
 * - `queued`: unstarted and unblocked — next when a slot frees.
 * - `blocked`: waiting on something: a blocker in the container, a spec (backlog), a
 *   hand dispatch (critical risk), or a failed run.
 */
export type FlightNodeState =
  | 'done'
  | 'running'
  | 'teammate'
  | 'review'
  | 'queued'
  | 'blocked';

export interface FlightNode {
  task: TaskListItem;
  state: FlightNodeState;
  /** 0-based wave (`dagWaves`). */
  wave: number;
  /** Ids of this child's blockers inside the container that still hold its dispatch
   * (not yet in review, landing or done — the server's rule). */
  waitingOn: string[];
  /** The child is itself a container: it fans out on its own plan, never this one's. */
  subPlan: boolean;
}

/** One wave's tally, for the bar. */
export interface FlightWave {
  /** 0-based. */
  index: number;
  total: number;
  done: number;
  running: number;
}

export interface FlightPlan {
  nodes: FlightNode[];
  waves: FlightWave[];
  /** The 0-based wave being worked: the first with anything unfinished; null once all is. */
  currentWave: number | null;
  total: number;
  done: number;
  running: number;
  queued: number;
  /** Agent slots: runs in use against the session's concurrency (null = no session). */
  slots: { used: number; total: number | null };
}

export interface FlightPlanOptions {
  /** Task ids with a live run. */
  liveTaskIds: ReadonlySet<string>;
  model: StatusModel;
  /** The fan-out session's concurrency, or null when nothing is fanning out. */
  concurrency: number | null;
  /** Ids that are containers themselves (`parentIdsOf`); omitted treats none as one. */
  containerIds?: ReadonlySet<string>;
  /** Precomputed waves for `children` — the full view keeps them with its layout. */
  waves?: ReadonlyMap<string, number>;
}

// A person (not an agent, not nobody) owns the task.
function ownedByPerson(task: TaskListItem): boolean {
  return assigneeRef(task.meta.assignee)?.kind === 'human';
}

/** Each child's wave by id — structure only, so a caller can hold it across state changes. */
export function flightWaves(
  children: readonly TaskListItem[]
): Map<string, number> {
  return dagWaves(children.map(dagTaskFromDoc));
}

// One child's state, first match wins: finished, a live run, a teammate's hands, the
// review/landing roles, then the unstarted ready/blocked split.
function stateOf(
  task: TaskListItem,
  waitingOn: readonly string[],
  subPlan: boolean,
  live: boolean,
  model: StatusModel
): FlightNodeState {
  const status = task.meta.status;
  if (isDoneStatus(status, model)) return 'done';
  if (live) return 'running';
  if (ownedByPerson(task) && isStartedStatus(status, model)) return 'teammate';
  if (
    hasStatusRole(status, 'review', model) ||
    hasStatusRole(status, 'landing', model)
  ) {
    return 'review';
  }
  if (
    !subPlan &&
    waitingOn.length === 0 &&
    task.meta.risk !== 'critical' &&
    isUnstartedStatus(status, model)
  ) {
    return 'queued';
  }
  return 'blocked';
}

/**
 * Where every child of a container stands, and the waves they form. `children` are the
 * container's direct children; blockers outside them never hold a wave (they are the
 * container's inputs, not its plan).
 */
export function buildFlightPlan(
  children: readonly TaskListItem[],
  {
    liveTaskIds,
    model,
    concurrency,
    containerIds,
    waves: knownWaves,
  }: FlightPlanOptions
): FlightPlan {
  const waveOf = knownWaves ?? flightWaves(children);
  const byId = new Map(children.map((c) => [c.meta.id, c]));
  const nodes: FlightNode[] = children.map((task) => {
    const id = task.meta.id;
    const waitingOn = task.meta.blockedBy.filter((blocker) => {
      const b = byId.get(blocker);
      return (
        b !== undefined &&
        blocker !== id &&
        !isSatisfiedForDispatchStatus(b.meta.status, model)
      );
    });
    const subPlan = containerIds?.has(id) ?? false;
    return {
      task,
      state: stateOf(task, waitingOn, subPlan, liveTaskIds.has(id), model),
      wave: waveOf.get(id) ?? 0,
      waitingOn,
      subPlan,
    };
  });

  const waveCount = nodes.reduce((max, n) => Math.max(max, n.wave + 1), 0);
  const waves: FlightWave[] = Array.from({ length: waveCount }, (_, index) => ({
    index,
    total: 0,
    done: 0,
    running: 0,
  }));
  let done = 0;
  let running = 0;
  let queued = 0;
  for (const node of nodes) {
    const wave = waves[node.wave];
    if (wave === undefined) continue;
    wave.total++;
    if (node.state === 'done') {
      wave.done++;
      done++;
    } else if (node.state === 'running') {
      wave.running++;
      running++;
    } else if (node.state === 'queued') {
      queued++;
    }
  }
  const current = waves.find((w) => w.done < w.total);
  return {
    nodes,
    waves,
    currentWave: current === undefined ? null : current.index,
    total: nodes.length,
    done,
    running,
    queued,
    slots: { used: running, total: concurrency },
  };
}

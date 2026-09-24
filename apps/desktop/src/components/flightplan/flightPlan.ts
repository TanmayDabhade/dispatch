import type { StatusModel, TaskListItem } from '@dispatch/core/browser';
import {
  isDoneStatus,
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
 * - `queued`: unstarted and unblocked — next when a slot frees.
 * - `blocked`: waiting on something in the container that has not landed.
 */
type FlightNodeState = 'done' | 'running' | 'teammate' | 'queued' | 'blocked';

interface FlightNode {
  task: TaskListItem;
  state: FlightNodeState;
  /** 0-based wave (`dagWaves`). */
  wave: number;
  /** Ids of this child's blockers inside the container that have not finished. */
  waitingOn: string[];
}

/** One wave's tally, for the bar. */
interface FlightWave {
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
}

// A person (not an agent, not nobody) owns the task.
function ownedByPerson(task: TaskListItem): boolean {
  return assigneeRef(task.meta.assignee)?.kind === 'human';
}

/**
 * Where every child of a container stands, and the waves they form. `children` are the
 * container's direct children; blockers outside them never hold a wave (they are the
 * container's inputs, not its plan).
 */
export function buildFlightPlan(
  children: readonly TaskListItem[],
  { liveTaskIds, model, concurrency }: FlightPlanOptions
): FlightPlan {
  const waveOf = dagWaves(children.map(dagTaskFromDoc));
  const byId = new Map(children.map((c) => [c.meta.id, c]));
  const nodes: FlightNode[] = children.map((task) => {
    const id = task.meta.id;
    const waitingOn = task.meta.blockedBy.filter((blocker) => {
      const b = byId.get(blocker);
      return (
        b !== undefined && blocker !== id && !isDoneStatus(b.meta.status, model)
      );
    });
    let state: FlightNodeState;
    if (isDoneStatus(task.meta.status, model)) state = 'done';
    else if (liveTaskIds.has(id)) state = 'running';
    else if (ownedByPerson(task) && isStartedStatus(task.meta.status, model))
      state = 'teammate';
    else if (
      waitingOn.length === 0 &&
      isUnstartedStatus(task.meta.status, model)
    )
      state = 'queued';
    else state = 'blocked';
    return { task, state, wave: waveOf.get(id) ?? 0, waitingOn };
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

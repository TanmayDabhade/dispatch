import type { TaskDoc } from '@dispatch/core/browser';

import { formatUsd } from './epicSession';

/**
 * What a bulk dispatch is actually about to do.
 *
 * The mockup framed this as "5 of 8 slots are busy, so 3 start now" — a fixed global cap. There
 * isn't one: dispatch concurrency is chosen per call (see `handleWorkEpic(epicId, { concurrency, … })`
 * and the stepper in EpicLaneHeader), not configured once for the project. So the honest preview
 * is computed against the concurrency the user is about to pick, not an imaginary ceiling.
 *
 * The rule the dialog exists to enforce: nothing is ever silently dropped. Every selected task
 * appears in the preview, either starting now or explicitly queued.
 */

type DispatchDisposition = 'starts-now' | 'queued' | 'not-ready';

interface DispatchPreviewRow {
  taskId: string;
  title: string;
  disposition: DispatchDisposition;
}

export interface DispatchPreview {
  rows: DispatchPreviewRow[];
  startsNow: number;
  queued: number;
  /** Selected tasks that cannot be dispatched at all — blocked, or already running. */
  notReady: number;
  /** How many agents are already working, which is what eats into the concurrency budget. */
  runningNow: number;
  /** One sentence stating the arithmetic, so the dialog never makes the user do it. */
  summary: string;
  /** Just the estimate and ceiling clauses of `summary` — what a paused session's raise
   * dialog prints, where "N start now" no longer applies. */
  costSummary: string;
  /** The dollar range the runs about to start (now or queued) will settle at. */
  estimateUsd: { low: number; high: number };
  /** Tasks about to run (now or queued) that declare no `writes` — the fan-out serialises
   * those, one at a time, because an undeclared write conflicts with every live claim. */
  undeclaredWrites: number;
  /** Whether even the low estimate clears the spend ceiling, so the session would pause
   * before every task has run. */
  overCeiling: boolean;
}

export interface BuildDispatchPreviewInput {
  /** The tasks the user selected, in the order they should start. */
  tasks: TaskDoc[];
  /** Ids that are dependency-clear and have no live run. */
  readyIds: ReadonlySet<string>;
  /** How many agents are already running for this project. */
  runningNow: number;
  /** The concurrency the user is about to dispatch with. */
  concurrency: number;
  /** The per-run midpoint the estimate range is built around (`$10` → `$5–15`). */
  runCostEstimateUsd?: number;
  /** The spend ceiling the dispatch will carry; `null` or absent means none. */
  ceilingUsd?: number | null;
}

// The estimate is a range around the midpoint — half to one-and-a-half — since a run's
// cost swings with how much the agent has to read before it can write.
const ESTIMATE_LOW_FACTOR = 0.5;
const ESTIMATE_HIGH_FACTOR = 1.5;
/** The per-run midpoint the estimate and the default spend ceiling are built around. */
export const DEFAULT_RUN_COST_USD = 10;

// `$5–15`: one dollar sign for the range, as a price tag would print it.
function usdRange(low: number, high: number): string {
  return `${formatUsd(low)}–${formatUsd(high).slice(1)}`;
}

// `~$60–$180 at $5–15 per run · ceiling $120`: the clauses that price the plan.
function costClauses(
  estimate: { low: number; high: number },
  perRun: { low: number; high: number },
  ceilingUsd: number | null
): string[] {
  const parts = [
    `~${formatUsd(estimate.low)}–${formatUsd(estimate.high)} at ${usdRange(perRun.low, perRun.high)} per run`,
  ];
  if (ceilingUsd !== null) parts.push(`ceiling ${formatUsd(ceilingUsd)}`);
  return parts;
}

function sentence(
  startsNow: number,
  queued: number,
  notReady: number,
  runningNow: number,
  concurrency: number,
  cost: string[]
): string {
  if (startsNow === 0 && queued === 0) {
    return notReady > 0
      ? 'Nothing can start. Everything is blocked or already running.'
      : 'Nothing selected.';
  }
  const parts = [
    `${runningNow} already running, ${concurrency} at a time`,
    `${startsNow} start${startsNow === 1 ? 's' : ''} now`,
  ];
  if (queued > 0) parts.push(`${queued} queue${queued === 1 ? 's' : ''}`);
  if (notReady > 0) {
    parts.push(`${notReady} cannot start yet`);
  }
  return [...parts, ...cost].join(' · ');
}

export function buildDispatchPreview(
  input: BuildDispatchPreviewInput
): DispatchPreview {
  const {
    tasks,
    readyIds,
    runningNow,
    concurrency,
    runCostEstimateUsd = DEFAULT_RUN_COST_USD,
    ceilingUsd = null,
  } = input;
  // A concurrency of 0 or less would silently start nothing; treat it as at least one so the
  // preview and the dispatch agree about what the button will do.
  const limit = Math.max(1, Math.round(concurrency));
  const free = Math.max(0, limit - runningNow);

  let started = 0;
  const rows: DispatchPreviewRow[] = tasks.map((task) => {
    const id = task.meta.id;
    if (!readyIds.has(id)) {
      return { taskId: id, title: task.meta.title, disposition: 'not-ready' };
    }
    if (started < free) {
      started += 1;
      return { taskId: id, title: task.meta.title, disposition: 'starts-now' };
    }
    return { taskId: id, title: task.meta.title, disposition: 'queued' };
  });

  const startsNow = rows.filter((r) => r.disposition === 'starts-now').length;
  const queued = rows.filter((r) => r.disposition === 'queued').length;
  const notReady = rows.filter((r) => r.disposition === 'not-ready').length;

  const perRun = {
    low: runCostEstimateUsd * ESTIMATE_LOW_FACTOR,
    high: runCostEstimateUsd * ESTIMATE_HIGH_FACTOR,
  };
  const runs = startsNow + queued;
  const estimateUsd = { low: runs * perRun.low, high: runs * perRun.high };
  // Only the tasks that will run get serialised, so a blocked or landed task with no
  // writes is not counted against the fan-out.
  const undeclaredWrites = tasks.filter(
    (task, i) =>
      rows[i]?.disposition !== 'not-ready' && task.meta.writes.length === 0
  ).length;
  const cost = costClauses(estimateUsd, perRun, ceilingUsd);

  return {
    rows,
    startsNow,
    queued,
    notReady,
    runningNow,
    summary: sentence(startsNow, queued, notReady, runningNow, limit, cost),
    costSummary: cost.join(' · '),
    estimateUsd,
    undeclaredWrites,
    overCeiling: ceilingUsd !== null && estimateUsd.low > ceilingUsd,
  };
}

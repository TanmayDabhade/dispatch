import type { ApiClient, ReadinessReading } from '@dispatch/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

type Readings = Record<string, ReadinessReading>;

interface JudgeDelays {
  /** The first judge waits for the list's first render to have settled. */
  first: number;
  /** A task change re-judges this long after it, and changes meanwhile ride along — an
   * import or a sync pass costs one judging request per window, never one per task. */
  debounce: number;
}

const JUDGE_DELAYS: JudgeDelays = { first: 1_500, debounce: 5_000 };

export function readinessKey(port: number | undefined) {
  return ['dispatch-readiness', port] as const;
}

/** The readings carried by a `/api/tasks/ready` response — full docs or meta-only
 * items alike, since only the id and the reading are read. */
export function readingsOf(
  ready: readonly { meta: { id: string }; readiness?: ReadinessReading }[]
): Readings {
  const out: Readings = {};
  for (const task of ready) {
    if (task.readiness !== undefined) out[task.meta.id] = task.readiness;
  }
  return out;
}

/** `readings` narrowed to the ready set: a reading describes a task waiting to start. */
export function readinessFor(
  readings: Readings | undefined,
  readyIds: ReadonlySet<string>
): Map<string, ReadinessReading> {
  const map = new Map<string, ReadinessReading>();
  if (readings === undefined) return map;
  for (const [id, reading] of Object.entries(readings)) {
    if (readyIds.has(id)) map.set(id, reading);
  }
  return map;
}

interface Readiness {
  readinessById: ReadonlyMap<string, ReadinessReading>;
  /** A ready task may have changed: judge again shortly. A no-op when the daemon has
   * no judgment client. */
  scheduleJudge: () => void;
}

/**
 * The readiness readings without re-sending ready bodies on every event. The cached
 * readings (`/api/tasks/readiness`, a small id → reading map) paint first; the judging
 * route (`/api/tasks/ready`, which re-judges stale specs) runs once per connection after
 * the list is in, then at most once per window while tasks change, and never again once
 * it shows the daemon judges nothing.
 */
export function useReadiness(
  client: ApiClient | null,
  port: number | undefined,
  listLoaded: boolean,
  readyIds: ReadonlySet<string>,
  delays: JudgeDelays = JUDGE_DELAYS
): Readiness {
  const queryClient = useQueryClient();
  const key = useMemo(() => readinessKey(port), [port]);
  const { data: readings } = useQuery({
    queryKey: key,
    queryFn: () => {
      if (client === null) throw new Error('dispatchd client not ready');
      return client.fetchReadiness();
    },
    enabled: client !== null && listLoaded,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // 'unknown' until a judge answers with ready tasks; 'off' once one came back unjudged.
  const judging = useRef<'unknown' | 'on' | 'off'>('unknown');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const judge = useCallback(async () => {
    if (client === null) return;
    const ready = await client.fetchReadyTasks();
    const fresh = readingsOf(ready);
    if (ready.length > 0) {
      judging.current = Object.keys(fresh).length > 0 ? 'on' : 'off';
    }
    queryClient.setQueryData<Readings>(key, (old) => ({ ...old, ...fresh }));
  }, [client, queryClient, key]);

  const schedule = useCallback(
    (delay: number) => {
      if (judging.current === 'off' || timer.current !== null) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        judge().catch(() => {});
      }, delay);
    },
    [judge]
  );

  // A new connection judges afresh.
  useEffect(() => {
    judging.current = 'unknown';
    if (!listLoaded) return;
    schedule(delays.first);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [listLoaded, schedule, delays.first]);

  const scheduleJudge = useCallback(
    () => schedule(delays.debounce),
    [schedule, delays.debounce]
  );
  const readinessById = useMemo(
    () => readinessFor(readings, readyIds),
    [readings, readyIds]
  );
  return { readinessById, scheduleJudge };
}

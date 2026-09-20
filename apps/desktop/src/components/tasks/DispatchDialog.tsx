import { MAX_CONCURRENCY_HARD_CAP, type TaskDoc } from '@dispatch/core/browser';
import { Zap } from 'lucide-react';
import { useMemo, useState } from 'react';

import { buildDispatchPreview } from '@/lib/dispatchPreview';
import { concurrencyChoices } from '@/lib/epicConcurrency';
import {
  defaultMaxRuns,
  defaultSpendCeiling,
  type WorkEpicOptions,
} from '@/lib/epicSession';
import { cn } from '@/lib/utils';
import { ListRow } from '@/ui/ai/list-row';
import { Pill, PillButton } from '@/ui/ai/pill';
import { Button } from '@/ui/button';
import { HintText } from '@/ui/chrome';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { ScrollArea } from '@/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select';

interface DispatchDialogProps {
  /** What the user selected — every one of these appears in the preview. */
  tasks: TaskDoc[];
  readyIds: ReadonlySet<string>;
  /** Agents already working, which is what eats into the concurrency budget. */
  runningNow: number;
  /** Starting concurrency, from the project's config. */
  defaultConcurrency: number;
  /** The most agents the picker offers — the project's `orchestrator.maxConcurrency`.
   * Never above the hard cap, even when a caller forgets the config. */
  maxConcurrency?: number;
  /** The per-run midpoint the `$5–15` estimate line is built around. */
  runCostEstimateUsd?: number;
  /** The project's `fixLoop.auto`; when given, the dialog says whether review rounds
   * will share the slots or wait for a hand. */
  fixLoopAuto?: boolean;
  /** `raise` edits the ceilings of a paused session: no task list, and the button only
   * enables once a ceiling has changed. */
  mode?: 'start' | 'raise';
  /** Values to open with — a paused session's current ceilings in `raise` mode. */
  initial?: {
    concurrency?: number;
    maxSpendUsd?: number | null;
    maxRuns?: number | null;
  };
  confirmLabel?: string;
  title: string;
  onConfirm: (opts: WorkEpicOptions) => Promise<void>;
  onCancel: () => void;
}

const DISPOSITION_LABEL = {
  'starts-now': 'Starts now',
  queued: 'Queued',
  'not-ready': 'Cannot start',
} as const;

const DEFAULT_RUN_COST_USD = 10;
// From here the ceiling is what ends the fan-out, not the task list, and the hint says so.
const LARGE_FANOUT_TASKS = 100;

// A ceiling input's text as the option it sends: empty lifts the ceiling (`null`), a
// number stands, and anything unparseable counts as empty rather than as zero.
function parseCeiling(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

// The starting text of a ceiling input: an explicit `null` opens it empty.
function ceilingText(value: number | null | undefined, fallback: number) {
  if (value === null) return '';
  return String(value ?? fallback);
}

function clampConcurrency(value: number, cap: number): number {
  return Math.min(cap, Math.max(1, Math.floor(value) || 1));
}

/**
 * Confirms a fan-out by showing exactly what it will do.
 *
 * The reason this is a dialog rather than a button: concurrency is bounded, so dispatching
 * twelve tasks at a concurrency of eight does not start twelve agents. Every selected task is
 * listed and badged — starting now, queued, or un-startable — because the failure this exists to
 * prevent is silently dropping four of them and reporting success. The spend and run
 * ceilings sit next to the concurrency because together they bound what the session may
 * cost, and the estimate line prices the plan against them before anything starts.
 *
 * The concurrency is editable here rather than fixed, since it is chosen per dispatch (see
 * handleWorkEpic); changing it updates the preview live, which is the fastest way to understand
 * what the number actually does.
 */
export function DispatchDialog({
  tasks,
  readyIds,
  runningNow,
  defaultConcurrency,
  maxConcurrency = MAX_CONCURRENCY_HARD_CAP,
  runCostEstimateUsd = DEFAULT_RUN_COST_USD,
  fixLoopAuto,
  mode = 'start',
  initial,
  confirmLabel,
  title,
  onConfirm,
  onCancel,
}: DispatchDialogProps) {
  const cap = Math.min(maxConcurrency, MAX_CONCURRENCY_HARD_CAP);
  const [concurrency, setConcurrency] = useState(() =>
    clampConcurrency(initial?.concurrency ?? defaultConcurrency, cap)
  );
  const initialSpend = ceilingText(
    initial?.maxSpendUsd,
    defaultSpendCeiling(tasks.length, runCostEstimateUsd)
  );
  const initialRuns = ceilingText(
    initial?.maxRuns,
    defaultMaxRuns(tasks.length)
  );
  const [spendText, setSpendText] = useState(initialSpend);
  const [runsText, setRunsText] = useState(initialRuns);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1…cap, stretched to include a configured default above that so it stays selectable —
  // keyed on the default, not the current pick, so choosing a lower value can't drop it.
  const concurrencyOptions = useMemo(
    () => concurrencyChoices(clampConcurrency(defaultConcurrency, cap), cap),
    [defaultConcurrency, cap]
  );

  const maxSpendUsd = parseCeiling(spendText);
  const maxRuns = parseCeiling(runsText);

  const preview = useMemo(
    () =>
      buildDispatchPreview({
        tasks,
        readyIds,
        runningNow,
        concurrency,
        runCostEstimateUsd,
        ceilingUsd: maxSpendUsd,
      }),
    [tasks, readyIds, runningNow, concurrency, runCostEstimateUsd, maxSpendUsd]
  );

  const agents = preview.startsNow + preview.queued;
  const raising = mode === 'raise';
  const ceilingChanged =
    spendText.trim() !== initialSpend.trim() ||
    runsText.trim() !== initialRuns.trim();
  const canConfirm = raising ? ceilingChanged : agents > 0;
  const label =
    confirmLabel ?? (raising ? 'Raise ceiling' : `Send ${agents} agents`);

  const hints: string[] = [];
  if (preview.undeclaredWrites > 0) {
    const n = preview.undeclaredWrites;
    hints.push(
      `${n} task${n === 1 ? ' declares' : 's declare'} no writes — ${n === 1 ? 'it' : 'they'} will run one at a time`
    );
  }
  if (fixLoopAuto !== undefined) {
    hints.push(
      fixLoopAuto
        ? 'Review rounds share these slots (fixLoop.auto is on)'
        : 'Reviews start by hand (fixLoop.auto is off)'
    );
  }
  if (tasks.length >= LARGE_FANOUT_TASKS) {
    hints.push('Large fan-out — the ceiling pauses it, Resume raises it');
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-[min(560px,92vw)] max-w-none sm:max-w-none"
      >
        <DialogHeader className="pt-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription
            data-over-ceiling={preview.overCeiling || undefined}
            className={cn(preview.overCeiling && 'text-(--state-waiting-fg)')}
          >
            {preview.summary}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 px-4 py-2">
          <span className="font-book text-muted-foreground text-[13px]">
            Run at most
          </span>
          <Select
            value={String(concurrency)}
            onValueChange={(value) => setConcurrency(Number(value) || 1)}
          >
            <SelectTrigger aria-label="Concurrency" className="min-w-14">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {concurrencyOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {String(n)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="font-book text-muted-foreground text-[13px]">
            at a time
          </span>
        </div>

        <div className="flex items-center gap-2 px-4 pb-2">
          <label className="flex items-center gap-2">
            <span className="font-book text-muted-foreground text-[13px]">
              Spend ceiling $
            </span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={10}
              aria-label="Spend ceiling"
              className="w-24"
              value={spendText}
              onChange={(event) => setSpendText(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="font-book text-muted-foreground text-[13px]">
              Max runs
            </span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              aria-label="Max runs"
              className="w-20"
              value={runsText}
              onChange={(event) => setRunsText(event.target.value)}
            />
          </label>
        </div>

        {hints.length > 0 && (
          <div className="flex flex-col gap-0.5 px-4 pb-2">
            {hints.map((hint) => (
              <HintText key={hint}>{hint}</HintText>
            ))}
          </div>
        )}

        {!raising && (
          <ScrollArea className="max-h-72 px-1">
            <div role="table" aria-label="Tasks to dispatch">
              {preview.rows.map((row) => (
                <ListRow
                  key={row.taskId}
                  id={row.taskId}
                  title={
                    <span
                      className={cn(
                        row.disposition !== 'starts-now' &&
                          'text-muted-foreground'
                      )}
                    >
                      {row.title}
                    </span>
                  }
                  trailing={
                    <Pill
                      data-disposition={row.disposition}
                      className={cn(
                        row.disposition === 'not-ready' && 'text-status-blocked'
                      )}
                    >
                      {DISPOSITION_LABEL[row.disposition]}
                    </Pill>
                  }
                />
              ))}
            </div>
          </ScrollArea>
        )}

        {error !== null && (
          <p role="alert" className="text-red px-4 pt-2 text-[12px]">
            {error}
          </p>
        )}

        <DialogFooter>
          <PillButton onClick={onCancel}>Cancel</PillButton>
          <Button
            disabled={busy || !canConfirm}
            onClick={() => {
              setBusy(true);
              setError(null);
              void onConfirm({ concurrency, maxSpendUsd, maxRuns })
                .catch((err: unknown) => {
                  // Only an Error carries a message worth showing; anything else stringifies
                  // to "[object Object]", which tells the reader nothing.
                  setError(
                    err instanceof Error ? err.message : 'Dispatch failed.'
                  );
                })
                .finally(() => setBusy(false));
            }}
          >
            <Zap />
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

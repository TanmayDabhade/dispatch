import type { TaskDoc } from '@dispatch/core/browser';
import { Zap } from 'lucide-react';
import { useMemo, useState } from 'react';

import { buildDispatchPreview } from '@/lib/dispatchPreview';
import { cn } from '@/lib/utils';
import { ListRow } from '@/ui/ai/list-row';
import { Pill, PillButton } from '@/ui/ai/pill';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
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
  title: string;
  onConfirm: (concurrency: number) => Promise<void>;
  onCancel: () => void;
}

const DISPOSITION_LABEL = {
  'starts-now': 'Starts now',
  queued: 'Queued',
  'not-ready': 'Cannot start',
} as const;

const CONCURRENCY_MAX = 10;

/**
 * Confirms a bulk dispatch by showing exactly what it will do.
 *
 * The reason this is a dialog rather than a button: concurrency is bounded, so dispatching
 * twelve tasks at a concurrency of eight does not start twelve agents. Every selected task is
 * listed and badged — starting now, queued, or un-startable — because the failure this exists to
 * prevent is silently dropping four of them and reporting success.
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
  title,
  onConfirm,
  onCancel,
}: DispatchDialogProps) {
  const [concurrency, setConcurrency] = useState(
    Math.max(1, Math.floor(defaultConcurrency) || 1)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1…10, stretched to include a configured default above that so it stays selectable.
  const concurrencyOptions = useMemo(() => {
    const top = Math.max(CONCURRENCY_MAX, concurrency);
    return Array.from({ length: top }, (_, i) => i + 1);
  }, [concurrency]);

  const preview = useMemo(
    () =>
      buildDispatchPreview({
        tasks,
        readyIds,
        runningNow,
        concurrency,
      }),
    [tasks, readyIds, runningNow, concurrency]
  );

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
          <DialogDescription>{preview.summary}</DialogDescription>
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

        {error !== null && (
          <p role="alert" className="text-red px-4 pt-2 text-[12px]">
            {error}
          </p>
        )}

        <DialogFooter>
          <PillButton onClick={onCancel}>Cancel</PillButton>
          <Button
            disabled={busy || preview.startsNow + preview.queued === 0}
            onClick={() => {
              setBusy(true);
              setError(null);
              void onConfirm(concurrency)
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
            Dispatch {preview.startsNow + preview.queued}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

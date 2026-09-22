import type { ApiClient, WorkspaceSearchHit } from '@dispatch/client';
import { useEffect, useRef, useState } from 'react';

import { runsFromPositions } from '../../lib/highlight';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';

/**
 * Quick open: type a few letters, get the file.
 *
 * Matching and ranking happen on the daemon (see packages/server/src/fuzzy.ts)
 * because that is where the file list already is — shipping thousands of paths
 * to the renderer on every keystroke would cost more than the search does.
 * The reply carries the matched character positions, which is what lets the
 * highlighting show *why* a result matched.
 */

interface QuickOpenDialogProps {
  client: ApiClient;
  runId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (path: string) => void;
}

// Renders a path with its matched characters emphasised. The offsets come
// from the daemon's matcher as UTF-16 indices, which is exactly what
// `runsFromPositions` expects.
function Highlighted({ hit }: { hit: WorkspaceSearchHit }) {
  return (
    <span className="truncate font-mono text-xs">
      {runsFromPositions(hit.path, hit.positions).map((run, index) => (
        <span
          key={index}
          className={run.hit ? 'font-semibold text-[var(--color-primary)]' : ''}
        >
          {run.text}
        </span>
      ))}
    </span>
  );
}

export function QuickOpenDialog({
  client,
  runId,
  open,
  onOpenChange,
  onPick,
}: QuickOpenDialogProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<WorkspaceSearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Debounced: a keystroke should not queue a search per character while the
    // previous one is still running.
    const timer = setTimeout(() => {
      void client
        .searchWorkspace(query, { runId, limit: 40 })
        .then((result) => {
          if (cancelled) return;
          setHits(result.results);
          setActive(0);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, runId, query, open]);

  const choose = (path: string | undefined): void => {
    if (path === undefined) return;
    onPick(path);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0">
        <DialogTitle className="sr-only">Quick open</DialogTitle>
        <div className="border-b border-[var(--color-border)] p-2">
          <Input
            ref={inputRef}
            value={query}
            placeholder="Go to file"
            className="h-8"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Arrow keys move the selection rather than the text cursor, and
              // Enter opens — the whole dialog is driven from this one field.
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((value) => Math.min(value + 1, hits.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((value) => Math.max(value - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(hits[active]?.path);
              }
            }}
          />
        </div>
        <div className="max-h-80 overflow-auto py-1">
          {hits.length === 0 && (
            <p className="px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
              No matching files.
            </p>
          )}
          {hits.map((hit, index) => (
            <button
              key={hit.path}
              type="button"
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(hit.path)}
              className={`flex w-full px-3 py-1 text-left ${
                index === active ? 'bg-[var(--color-accent)]' : ''
              }`}
            >
              <Highlighted hit={hit} />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

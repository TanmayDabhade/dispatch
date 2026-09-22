import type { ApiClient, WorkspaceEntry } from '@dispatch/client';
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

/**
 * A lazily expanded directory tree.
 *
 * Each directory is fetched the first time it opens and cached after, so
 * browsing a large repo costs one request per directory actually looked at
 * rather than a recursive crawl of the whole checkout up front.
 */

interface FileTreeProps {
  client: ApiClient;
  runId: string | null;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

// Children by directory path; '' is the root. Absent means "not loaded yet",
// which is what distinguishes a directory nobody has opened from an empty one.
type Loaded = Record<string, WorkspaceEntry[]>;

function TreeRow({
  entry,
  depth,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  entry: WorkspaceEntry;
  depth: number;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const isDir = entry.kind === 'directory';
  return (
    <button
      type="button"
      onClick={isDir ? onToggle : onSelect}
      className={`flex w-full items-center gap-1 px-1 py-[2px] text-left text-xs hover:bg-[var(--color-muted)] ${
        selected ? 'bg-[var(--color-accent)]' : ''
      }`}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
    >
      {isDir ? (
        expanded ? (
          <ChevronDown className="size-3 shrink-0 opacity-70" />
        ) : (
          <ChevronRight className="size-3 shrink-0 opacity-70" />
        )
      ) : (
        <span className="w-3 shrink-0" />
      )}
      {isDir ? (
        <Folder className="size-3 shrink-0 opacity-70" />
      ) : (
        <FileIcon className="size-3 shrink-0 opacity-70" />
      )}
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

export function FileTree({
  client,
  runId,
  selectedPath,
  onSelect,
}: FileTreeProps) {
  const [loaded, setLoaded] = useState<Loaded>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (path: string) => {
      try {
        const tree = await client.fetchWorkspaceTree(path, { runId });
        setLoaded((prev) => ({ ...prev, [path]: tree.entries }));
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'could not read the directory'
        );
      }
    },
    [client, runId]
  );

  // The scope's root, reloaded whenever the scope changes — switching from the
  // repo to a run's worktree must not show the previous checkout's tree.
  useEffect(() => {
    setLoaded({});
    setExpanded(new Set());
    void load('');
  }, [load]);

  const toggle = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else {
          next.add(path);
          if (loaded[path] === undefined) void load(path);
        }
        return next;
      });
    },
    [loaded, load]
  );

  // Walks the loaded map into flat rows. Flat rather than nested components so
  // one pass renders the whole visible tree and depth stays explicit.
  const rows: { entry: WorkspaceEntry; depth: number }[] = [];
  const push = (path: string, depth: number): void => {
    for (const entry of loaded[path] ?? []) {
      rows.push({ entry, depth });
      if (entry.kind === 'directory' && expanded.has(entry.path)) {
        push(entry.path, depth + 1);
      }
    }
  };
  push('', 0);

  return (
    <div className="h-full overflow-auto">
      {error !== null && (
        <p className="px-2 py-1 text-xs text-[var(--color-destructive)]">
          {error}
        </p>
      )}
      {rows.map(({ entry, depth }) => (
        <TreeRow
          key={entry.path}
          entry={entry}
          depth={depth}
          expanded={expanded.has(entry.path)}
          selected={selectedPath === entry.path}
          onToggle={() => toggle(entry.path)}
          onSelect={() => onSelect(entry.path)}
        />
      ))}
    </div>
  );
}

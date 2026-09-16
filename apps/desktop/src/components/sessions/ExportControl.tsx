import { Download, FolderOpen } from 'lucide-react';
import { useState } from 'react';

import { revealInFinder } from '../../lib/tauri';
import { Button } from '@/ui/button';

type ExportState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; path: string }
  | { status: 'error'; message: string };

interface ExportControlProps {
  /** Button label while idle, e.g. "Export transcript" or "Export as Markdown". */
  label: string;
  /** Button label while the export is in flight. Defaults to "Exporting…". */
  savingLabel?: string;
  /** Runs the export and resolves to the saved file's path. */
  onExport: () => Promise<string>;
  /** `ghost` is the page-header action (12px muted text, no fill); `pill` the in-body
   * secondary button. */
  variant?: 'ghost' | 'pill';
}

/**
 * "Export … / Exporting… / Saved to &lt;path&gt; [Reveal in Finder] / &lt;error&gt;" control
 * shared by `SessionDetailModal` (exports one session's transcript) and `SessionsHubView`
 * (exports the aggregate spend report from its header) — both call an async export fn and
 * would otherwise re-implement the same idle/saving/saved/error state machine around it. Owns
 * that state itself so neither caller has to.
 */
export function ExportControl({
  label,
  savingLabel = 'Exporting…',
  onExport,
  variant = 'pill',
}: ExportControlProps) {
  const [state, setState] = useState<ExportState>({ status: 'idle' });

  async function handleExport() {
    setState({ status: 'saving' });
    try {
      const path = await onExport();
      setState({ status: 'saved', path });
    } catch (e) {
      setState({ status: 'error', message: String(e) });
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      {state.status === 'saved' && (
        <span className="text-muted-foreground font-book inline-flex min-w-0 items-center gap-2 text-[12px]">
          <span className="truncate">Saved to {state.path}</span>
          <Button
            variant="link"
            size="xs"
            onClick={() => void revealInFinder(state.path)}
            className="h-auto gap-1 p-0 text-[12px] whitespace-nowrap has-[>svg]:px-0"
          >
            <FolderOpen className="size-3" />
            Reveal in Finder
          </Button>
        </span>
      )}
      {state.status === 'error' && (
        <span className="text-state-failed truncate text-[12px]">
          {state.message}
        </span>
      )}
      <Button
        variant={variant === 'ghost' ? 'ghost' : 'secondary'}
        size="sm"
        onClick={() => void handleExport()}
        disabled={state.status === 'saving'}
      >
        <Download className="size-3.5" />
        {state.status === 'saving' ? savingLabel : label}
      </Button>
    </div>
  );
}

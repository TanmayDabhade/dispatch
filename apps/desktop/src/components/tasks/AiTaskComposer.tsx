import type { DraftRecord } from '@dispatch/client';
import { PanelTopOpen, Sparkles } from 'lucide-react';
import { useState } from 'react';

import type { DispatchProjectData } from '../../hooks/useDispatchProject';
import { DaemonUnavailable } from '../shell/DaemonUnavailable';
import { Pill } from '@/ui/ai/pill';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogBody,
  DialogChrome,
  DialogContent,
  DialogFooter,
} from '@/ui/dialog';
import { Kbd } from '@/ui/kbd';
import { Spinner } from '@/ui/spinner';
import { Textarea } from '@/ui/textarea';

interface AiTaskComposerProps {
  data: DispatchProjectData;
  /** The unwrapped start call — rejects on failure (unlike `data.handleStartDraft`) so the
   * composer can keep the typed prompt on screen with an inline error instead of losing it. */
  onStartDraft: (prompt: string) => Promise<DraftRecord>;
  /** Opens `CreateTaskModal` instead — the structured quick-add fallback for when you already
   * know the exact fields and don't want to spend an agent round-trip describing them. */
  onQuickAdd: () => void;
  onClose: () => void;
}

/** Describe-what-you-want task starter on the new-issue dialog's grammar (§9): the same
 * ~1024px sheet near the top, a borderless 15px prompt, and a single primary `Draft task`.
 * Submitting starts a background draft and closes right away — the drafts tray picks up its
 * progress, and review/save happens later from there. */
export function AiTaskComposer({
  data,
  onStartDraft,
  onQuickAdd,
  onClose,
}: AiTaskComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (prompt.trim() === '' || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onStartDraft(prompt.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const daemonDown = data.portLoading || data.portError || data.client === null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-label="New task"
        showCloseButton={false}
        className="top-[12%] w-[min(1024px,92vw)] max-w-none translate-y-0 sm:max-w-none"
      >
        <DialogChrome>
          <Pill>Dispatch</Pill>
          <span aria-hidden>›</span>
          <span className="text-(--text-secondary)">New task</span>
        </DialogChrome>

        {daemonDown ? (
          <DialogBody className="pb-4">
            <DaemonUnavailable
              starting={data.portLoading}
              errorDetail={data.portErrorDetail}
              onRetry={data.retryEnsureDispatchd}
            />
          </DialogBody>
        ) : (
          <>
            <DialogBody className="gap-3 pt-1 pb-4">
              <Textarea
                variant="borderless"
                autoFocus
                placeholder="What should change, and how you'll know it's done…"
                aria-label="Describe the task"
                value={prompt}
                disabled={submitting}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  // Cmd/Ctrl+Enter submits — a bare Enter has to stay a newline here.
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                className="min-h-[120px] text-[15px] leading-6"
              />
              {error !== null && (
                <p role="alert" className="text-red text-[12px]">
                  {error}
                </p>
              )}
              <p className="font-book text-muted-foreground flex items-center gap-1.5 text-[12px]">
                <Kbd>⌘⏎</Kbd>
                to draft — nothing is created until you review it.
              </p>
            </DialogBody>

            <DialogFooter
              className="shadow-hairline-top"
              leading={
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onQuickAdd}
                  disabled={submitting}
                >
                  <PanelTopOpen />
                  Quick add…
                </Button>
              }
            >
              <Button
                disabled={submitting || prompt.trim() === ''}
                onClick={() => void submit()}
              >
                {submitting ? (
                  <>
                    <Spinner className="size-3.5" /> Starting…
                  </>
                ) : (
                  <>
                    <Sparkles /> Draft task
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

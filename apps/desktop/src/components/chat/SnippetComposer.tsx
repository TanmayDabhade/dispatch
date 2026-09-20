import type { Snippet } from '@dispatch/client';
import { X } from 'lucide-react';
import { useState } from 'react';

import { snippetLabel } from '../../lib/conversation';
import { Pill } from '@/ui/ai/pill';
import { Button } from '@/ui/button';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { Textarea } from '@/ui/textarea';

/** A conversation target the composer can send to. `canAct` is the whole reason to pick one
 * target over another — whether the recipient can change the branch or only discuss it. */
export interface ChatTarget {
  id: string;
  label: string;
  canAct: boolean;
  hint?: string;
}

interface SnippetComposerProps {
  targets: ChatTarget[];
  attachments: Snippet[];
  onRemoveAttachment: (index: number) => void;
  onSend: (
    body: string,
    attachments: Snippet[],
    targetId: string
  ) => Promise<void>;
}

/**
 * Controlled chat composer for review conversations. It is deliberately target-agnostic: it
 * never fetches, never persists, and never learns what a target actually *is* — the caller owns
 * `targets`/`attachments` and receives the composed message via `onSend`. That keeps this file
 * renderable with no server, no run, and no Pierre.
 *
 * Not rebuilt on the `ui/ai/prompt-bar` primitive despite otherwise being the closest fit in
 * this codebase: the primitive has no slot for the target select, and `ReviewChatPanel.test.tsx`
 * (plus `PierreReviewDiff.test.tsx` and `RunReviewView.test.tsx`) read the offered targets as
 * `role="option"` straight after mount. So this keeps its own `Textarea`, target select and
 * button, on the primitive's frame — a quaternary card with a half-pixel border.
 */
export function SnippetComposer({
  targets,
  attachments,
  onRemoveAttachment,
  onSend,
}: SnippetComposerProps) {
  const [body, setBody] = useState('');
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [sending, setSending] = useState(false);

  const selectedTarget = targets.find((t) => t.id === targetId) ?? targets[0];

  async function submit() {
    if (body.trim() === '' || sending || selectedTarget === undefined) return;
    setSending(true);
    try {
      await onSend(body.trim(), attachments, selectedTarget.id);
      setBody('');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-surface-quaternary rounded-card focus-within:ring-ring flex flex-col gap-1.5 border-[0.5px] border-(--border-strong) p-1.5 transition-[box-shadow] duration-100 focus-within:ring-1">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-0.5 pt-0.5">
          {attachments.map((snippet, index) => {
            const label = snippetLabel(snippet);
            return (
              <Pill key={`${label}-${String(index)}`} className="pr-1">
                {/* A file path and a line range — a path keeps the code face. */}
                <span className="font-mono text-[11px]">{label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => onRemoveAttachment(index)}
                  className="text-muted-foreground hover:bg-surface-active hover:text-foreground rounded-pill flex size-4 shrink-0 items-center justify-center transition-colors duration-100"
                >
                  <X className="size-3" />
                </button>
              </Pill>
            );
          })}
        </div>
      )}

      <Textarea
        variant="borderless"
        rows={3}
        placeholder="Ask about the selected code…"
        aria-label="Message"
        value={body}
        disabled={sending}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        className="min-h-0 resize-y px-1 py-[5px] leading-[18px]"
      />

      <div className="flex items-center justify-between gap-3 px-0.5 pb-0.5">
        {/* `NativeSelect`, not the Base UI-backed `@/ui/select`: that primitive mounts its
            options only once opened, which breaks
            `ReviewChatPanel`'s coverage of which targets are offered — it reads
            `role="option"` right after mount, never opening the dropdown. A real `<select>`
            keeps that assertion honest while still landing on a shared primitive. */}
        <NativeSelect
          aria-label="Send to"
          size="sm"
          value={selectedTarget?.id}
          disabled={sending}
          onChange={(e) => setTargetId(e.target.value)}
          className="pl-2 text-[12px]"
        >
          {targets.map((target) => (
            <NativeSelectOption key={target.id} value={target.id}>
              {target.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <Button
          type="button"
          disabled={body.trim() === '' || sending}
          onClick={() => void submit()}
        >
          Send
        </Button>
      </div>

      {selectedTarget !== undefined && (
        <p className="text-muted-foreground font-book px-0.5 pb-0.5 text-[12px]">
          {selectedTarget.canAct
            ? 'This target can edit this branch.'
            : "Read-only. It explains, it doesn't edit."}
        </p>
      )}
    </div>
  );
}

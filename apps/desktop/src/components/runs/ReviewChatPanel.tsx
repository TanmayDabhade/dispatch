import type { ApiClient, ChatMessage, Snippet } from '@dispatch/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, MessageSquare } from 'lucide-react';
import type { Ref } from 'react';
import { useCallback, useImperativeHandle, useMemo, useState } from 'react';

import type { ChatTarget } from '../chat/SnippetComposer';
import { SnippetComposer } from '../chat/SnippetComposer';
import { snippetLabel } from '@/lib/conversation';
import { reviewTargetKey } from '@/lib/reviewTarget';
import { Button } from '@/ui/button';
import { Panel } from '@/ui/chrome';

const META_CLASS = 'text-[12px] font-book text-muted-foreground tabular-nums';

/** How the diff hands a selection to the dock. Imperative because the two sit side by side in
 * the review page and the pending attachments belong to the dock, not to the page. */
export interface ReviewChatHandle {
  attach(snippet: Snippet): void;
}

interface ReviewChatPanelProps {
  client: ApiClient;
  runId: string;
  /**
   * Whether this run's own agent could still be resumed on its branch. False — a run still
   * going, or one already reviewed — withholds the acting target entirely rather than offering
   * a recipient that cannot act, the same rule the pencil and the gutter "+" already follow.
   */
  canResumeAgent: boolean;
  ref?: Ref<ReviewChatHandle>;
}

/**
 * The review's chat dock: everything about *this run* that the composer, the selection bar and
 * the conversation store deliberately do not know.
 *
 * It is the only place that turns a run into a subject (`reviewTargetKey`) and into targets, which
 * is what lets the same composer and the same selection bar serve a Git-page diff or a GitHub PR
 * unchanged — they never learn what a run is.
 *
 * Sending stores the message against the subject and nothing more: no agent is resumed and no
 * reply is produced. That is stated in the dock rather than implied, because a message that
 * looks sent but was only filed is the worse failure.
 */
export function ReviewChatPanel({
  client,
  runId,
  canResumeAgent,
  ref,
}: ReviewChatPanelProps) {
  const queryClient = useQueryClient();
  const subject = reviewTargetKey({ kind: 'run', runId });
  // Keyed on the subject and the daemon it came from — never on the run id, so a subject that
  // is not a run reads from exactly the same cache entry shape.
  const queryKey = useMemo(
    () => ['dispatch-conversation', client.baseUrl, subject],
    [client, subject]
  );
  const { data: messages } = useQuery({
    queryKey,
    queryFn: () => client.fetchConversation(subject),
    retry: false,
  });

  // The pending attachments live here, not in `SnippetComposer`: that component is controlled
  // by contract, and the selection bar that pushes onto this list is in another subtree.
  const [attachments, setAttachments] = useState<Snippet[]>([]);
  const [open, setOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    attach(snippet: Snippet) {
      setAttachments((prev) => [...prev, snippet]);
      // Attaching into a collapsed dock would drop the chip out of sight, which reads as the
      // action having done nothing.
      setOpen(true);
    },
  }));

  const targets = useMemo<ChatTarget[]>(
    () => [
      ...(canResumeAgent
        ? [
            {
              id: 'run-agent',
              label: "This run's agent",
              canAct: true,
              hint: 'Resumes the session. It can edit code.',
            },
          ]
        : []),
      {
        id: 'side',
        label: 'Side conversation',
        canAct: false,
        hint: 'A fresh agent with the diff as context. It explains; it does not edit.',
      },
    ],
    [canResumeAgent]
  );

  const handleSend = useCallback(
    async (body: string, snippets: Snippet[], targetId: string) => {
      const created = await client.addChatMessage({
        subject,
        role: 'human',
        body,
        snippets,
        target: targetId,
      });
      // A first fetch still in flight would resolve *after* this write and overwrite it with a
      // list that predates the message — sending into a dock opened a moment ago would then
      // look like a send that vanished.
      await queryClient.cancelQueries({ queryKey });
      // The POST returns the stored message, so it goes straight into the cache rather than
      // costing a refetch — same one-round-trip pattern as the PR review calls.
      queryClient.setQueryData<ChatMessage[]>(queryKey, (prev) => [
        ...(prev ?? []),
        created,
      ]);
      setAttachments([]);
    },
    [client, subject, queryClient, queryKey]
  );

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const count = messages?.length ?? 0;

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="bg-surface-quaternary hover:bg-surface-active rounded-card border-border font-book mt-2 h-9 w-full justify-start gap-2 border-[0.5px] px-3 text-left text-[13px]"
      >
        <MessageSquare className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">Ask about this diff…</span>
        {count > 0 && <span className={`${META_CLASS} shrink-0`}>{count}</span>}
      </Button>
    );
  }

  return (
    <Panel className="mt-2 flex max-h-[45%] shrink-0 flex-col gap-2 p-2">
      <div className="flex h-7 items-center gap-2">
        <MessageSquare className="text-muted-foreground size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 text-[13px] font-medium text-(--text-secondary)">
          Chat about this diff
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Collapse the chat"
          onClick={() => setOpen(false)}
        >
          <ChevronDown />
        </Button>
      </div>

      {count > 0 && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {messages?.map((m) => (
            <Message key={m.id} message={m} />
          ))}
        </div>
      )}

      <SnippetComposer
        targets={targets}
        attachments={attachments}
        onRemoveAttachment={handleRemoveAttachment}
        onSend={handleSend}
      />

      <p className="text-muted-foreground font-book text-[12px]">
        Saved with this review — nothing is dispatched to an agent yet.
      </p>
    </Panel>
  );
}

/** One stored message: who wrote it, what it said, and which code it pointed at. */
function Message({ message }: { message: ChatMessage }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[12px] font-medium">
        {message.role === 'human' ? 'You' : 'Agent'}
        {message.target === undefined ? '' : ` → ${message.target}`}
      </span>
      {message.snippets.length > 0 && (
        <div className="text-muted-foreground flex flex-wrap gap-1 font-mono text-[12px]">
          {message.snippets.map((snippet, index) => (
            <span key={`${snippet.file}-${index}`}>
              {snippetLabel(snippet)}
            </span>
          ))}
        </div>
      )}
      <p className="font-book text-[13px] leading-snug whitespace-pre-wrap">
        {message.body}
      </p>
    </div>
  );
}

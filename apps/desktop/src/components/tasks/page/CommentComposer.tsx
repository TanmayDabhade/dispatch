import { ArrowUp, Paperclip } from 'lucide-react';
import { useState } from 'react';

import { isSubmitChord, noteFromDraft } from '../../../lib/noteDraft';
import { IconButton } from '@/ui/ai/icon-button';
import { Textarea } from '@/ui/textarea';

// The `Leave a comment…` card at the foot of the activity feed: a comment-card surface
// holding a borderless multi-line textarea, an attach button on the left (disabled — there
// is no attachment model yet) and a send button on the right. Enter is a newline; `⌘⏎`
// sends, as does the button. The draft is cleared once `onSubmit` is handed the text.
export function CommentComposer({
  onSubmit,
}: {
  onSubmit: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const text = noteFromDraft(draft);

  function submit() {
    if (text === null) return;
    onSubmit(text);
    setDraft('');
  }

  return (
    <div
      data-slot="comment-composer"
      className="bg-surface-quaternary rounded-card border-border-strong focus-within:ring-ring flex flex-col gap-2 border-[0.5px] p-3 focus-within:ring-1"
    >
      <Textarea
        variant="borderless"
        rows={1}
        aria-label="Leave a comment"
        placeholder="Leave a comment…"
        className="min-h-6 resize-none text-[15px] leading-6"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitChord(e)) {
            e.preventDefault();
            // The peek's own ⌘⏎ (expand to the full page) listens on `document`; a
            // send from inside the composer must not also expand the dialog.
            e.stopPropagation();
            submit();
          }
        }}
      />
      <div className="flex items-center justify-between">
        <IconButton label="Attach a file" disabled>
          <Paperclip />
        </IconButton>
        <IconButton
          label="Send comment"
          filled
          disabled={text === null}
          onClick={submit}
          className="data-[ready]:bg-primary data-[ready]:text-white"
          data-ready={text !== null || undefined}
        >
          <ArrowUp />
        </IconButton>
      </div>
    </div>
  );
}

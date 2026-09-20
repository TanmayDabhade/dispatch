import type { KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';

import { Textarea } from '@/ui/textarea';

// The task's title as Linear draws it: 24px/600 directly on the panel, with no box, no
// hover fill and no edit mode — it is a borderless textarea that grows with its text.
// Commits through `onCommit` on blur, Enter and Escape (every control on this page saves
// rather than discards), and only when the trimmed title changed and is not empty, so a
// stray keystroke can never blank a task's name.
export function TaskTitle({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (title: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  function commit() {
    const next = draft.trim();
    if (next !== '' && next !== value) onCommit(next);
    else if (next === '') setDraft(value);
  }

  // Escape is left to bubble so the peek dialog still closes on it — after this commit.
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter') {
      // A title is one line: Enter commits rather than wrapping.
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.currentTarget.blur();
    }
  }

  return (
    <Textarea
      variant="borderless"
      rows={1}
      aria-label="Task title"
      data-slot="task-title"
      className="text-foreground min-h-8 resize-none text-[24px] leading-8 font-semibold tracking-[-0.16px]"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}

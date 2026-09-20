import { Sparkles } from 'lucide-react';

import { PillButton } from '@/ui/ai/pill';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Label } from '@/ui/label';
import { Spinner } from '@/ui/spinner';
import { Textarea } from '@/ui/textarea';

interface CommitComposerProps {
  message: string;
  onMessageChange: (message: string) => void;
  stagedCount: number;
  amend: boolean;
  onAmendChange: (amend: boolean) => void;
  busy: boolean;
  generating: boolean;
  onGenerate: () => void;
  onCommit: () => void;
}

/** The bottom bar: commit message, Generate (AI commit-message), and Commit/Amend. The
 * keymap lives behind `?` (see GitKeymapDialog), not as a permanent footer of copy. */
export function CommitComposer({
  message,
  onMessageChange,
  stagedCount,
  amend,
  onAmendChange,
  busy,
  generating,
  onGenerate,
  onCommit,
}: CommitComposerProps) {
  const canCommit =
    message.trim() !== '' && (stagedCount > 0 || amend) && !busy;

  return (
    <div className="shadow-hairline-top flex shrink-0 flex-col gap-1.5 px-4 py-3">
      <div className="flex items-end gap-2">
        <Textarea
          id="git-commit-message"
          rows={2}
          placeholder={
            stagedCount > 0
              ? `Commit message for ${stagedCount} staged file${stagedCount === 1 ? '' : 's'}…`
              : 'Commit message…'
          }
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          aria-label="Commit message"
          className="min-h-0 flex-1 text-[13px]"
        />
        <div className="flex flex-col gap-1.5">
          <PillButton
            disabled={stagedCount === 0 || generating}
            onClick={onGenerate}
            title="Generate a commit message from the staged diff"
          >
            {generating ? (
              <Spinner className="size-3.5" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Generate
          </PillButton>
          <Button size="sm" disabled={!canCommit} onClick={onCommit}>
            {amend ? 'Amend' : 'Commit'}
          </Button>
          <Label className="text-muted-foreground font-book flex items-center gap-1.5 px-1 text-[12px]">
            <Checkbox
              checked={amend}
              onCheckedChange={(checked) => onAmendChange(checked === true)}
            />
            Amend
          </Label>
        </div>
      </div>
    </div>
  );
}

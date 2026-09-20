import { Button } from '@/ui/button';

/** The sections an "Add detail" pass proposes — structurally `EnrichDraft`, but
 * inline here so this component depends on neither caller's module. */
interface EnrichReviewDraft {
  description: string;
  acceptanceCriteria: string[];
}

/**
 * A drafted "Add detail" proposal, shown read-only for a yes/no before anything
 * is written, as a comment card (§8): 12px sentence-case headings over 15px prose.
 * Used by the task detail dialog — the brain dump row's own "Add detail" is a plain
 * inline edit now, with nothing to review.
 */
export function EnrichReview({
  draft,
  applying,
  onApply,
  onDiscard,
  applyLabel = 'Apply to task',
  discardLabel = 'Discard',
  note = 'Applying replaces the description and acceptance criteria below.',
}: {
  draft: EnrichReviewDraft;
  applying: boolean;
  onApply: () => void;
  onDiscard: () => void;
  applyLabel?: string;
  discardLabel?: string;
  note?: string;
}) {
  return (
    <div
      data-slot="enrich-review"
      className="bg-surface-quaternary rounded-card border-border-strong flex flex-col gap-3 border-[0.5px] p-3"
    >
      <div className="flex flex-wrap items-baseline gap-2 text-[12px]">
        <span className="text-muted-foreground font-medium">
          Proposed detail
        </span>
        <span className="font-book text-muted-foreground">{note}</span>
      </div>

      {draft.description !== '' && (
        <div className="flex flex-col gap-1">
          <h4 className="text-muted-foreground text-[12px] font-medium">
            Description
          </h4>
          <p className="font-book text-[15px] leading-6 whitespace-pre-wrap text-(--text-secondary)">
            {draft.description}
          </p>
        </div>
      )}

      {draft.acceptanceCriteria.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-muted-foreground text-[12px] font-medium">
            Acceptance criteria
          </h4>
          <ul className="font-book flex list-disc flex-col gap-1 pl-4 text-[15px] leading-6 text-(--text-secondary)">
            {draft.acceptanceCriteria.map((criterion, i) => (
              <li key={`${i}-${criterion}`}>{criterion}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button disabled={applying} onClick={onApply}>
          {applying ? 'Applying…' : applyLabel}
        </Button>
        <Button variant="ghost" disabled={applying} onClick={onDiscard}>
          {discardLabel}
        </Button>
      </div>
    </div>
  );
}

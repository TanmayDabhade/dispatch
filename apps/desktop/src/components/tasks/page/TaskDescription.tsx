import { Markdown } from '../../runs/Markdown';
import { EditableBodySection } from '../detail/EditableBodySection';
import { MainSection } from '../detail/MainSection';

/**
 * Acceptance criteria as GFM task-list markdown, so the section renders as a checklist
 * whatever shape it was written in: one criterion per line, a leading bullet or an
 * existing `[ ]`/`[x]` box preserved, blank lines dropped. Lines that are already list
 * items with a box pass through untouched.
 */
function toChecklistMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const unbulleted = line.replace(/^[-*]\s+/, '');
      if (/^\[[ xX]\]\s/.test(unbulleted)) return `- ${unbulleted}`;
      return `- [ ] ${unbulleted}`;
    })
    .join('\n');
}

// The prose half of the task page: the description as rendered markdown under the title
// with no heading of its own (Linear's `Add description…`), then Acceptance criteria as a
// checklist under a sentence-case heading. Both are click-to-edit through
// `EditableBodySection`, writing whole-section replacements via `onUpdate`'s
// `description`/`acceptanceCriteria` (see core's setSection).
export function TaskDescription({
  description,
  acceptance,
  onSaveDescription,
  onSaveAcceptance,
}: {
  description: string;
  acceptance: string;
  onSaveDescription: (next: string) => void;
  onSaveAcceptance: (next: string) => void;
}) {
  return (
    <>
      <EditableBodySection
        label="Description"
        value={description}
        placeholder="Add description…"
        onSave={onSaveDescription}
      >
        <Markdown content={description} variant="prose" />
      </EditableBodySection>

      <MainSection title="Acceptance criteria">
        <EditableBodySection
          label="Acceptance criteria"
          value={acceptance}
          placeholder="Add acceptance criteria…"
          onSave={onSaveAcceptance}
        >
          <Markdown content={toChecklistMarkdown(acceptance)} variant="prose" />
        </EditableBodySection>
      </MainSection>
    </>
  );
}

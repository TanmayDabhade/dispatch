import type { AdjudicateFindingInput, Finding } from '@dispatch/client';
import { useState } from 'react';

import {
  countOpenFindings,
  groupOpenFindingsBySeverity,
  severityColor,
  severityLabel,
} from '../../../lib/findings';
import { MainSection } from './MainSection';
import { LabelPill, PillButton } from '@/ui/ai/pill';
import { Textarea } from '@/ui/textarea';

// Two explicit actions, never a bare "submit" — both disabled until a
// reason is actually typed, so the ruling requirement can't be missed. Laid
// out as a composer card: a borderless textarea over a row of pill buttons,
// `Block` in red text rather than a filled destructive button.
function AdjudicateFindingForm({
  onSubmit,
}: {
  onSubmit: (input: AdjudicateFindingInput) => Promise<void>;
}) {
  const [ruling, setRuling] = useState('');
  const [pending, setPending] = useState<'parked' | 'blocked' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const empty = ruling.trim() === '';

  async function submit(verdict: 'parked' | 'blocked') {
    setPending(verdict);
    setError(null);
    try {
      await onSubmit({ verdict, ruling: ruling.trim() });
      setRuling('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      data-slot="adjudicate-form"
      className="bg-field rounded-card border-border-strong focus-within:ring-ring mt-3 flex flex-col gap-2 border-[0.5px] p-2.5 focus-within:ring-1"
    >
      <Textarea
        variant="borderless"
        rows={1}
        aria-label="Ruling"
        value={ruling}
        onChange={(e) => setRuling(e.target.value)}
        placeholder="Ruling (required to park or block)"
        className="min-h-5 resize-none text-[13px] leading-5"
      />
      {error !== null && (
        <div className="text-red font-book text-[12px]">{error}</div>
      )}
      <div className="flex items-center gap-2">
        <PillButton
          disabled={empty || pending !== null}
          onClick={() => void submit('parked')}
        >
          {pending === 'parked' ? 'Parking…' : 'Park'}
        </PillButton>
        <PillButton
          className="text-red"
          disabled={empty || pending !== null}
          onClick={() => void submit('blocked')}
        >
          {pending === 'blocked' ? 'Blocking…' : 'Block'}
        </PillButton>
      </div>
    </div>
  );
}

// The adjudication form only attaches while the fix loop is capped — that
// is the one moment a ruling actually does anything.
export function FindingsPanel({
  findings,
  needsRuling,
  onAdjudicate,
}: {
  findings: Finding[];
  needsRuling: boolean;
  onAdjudicate: (
    findingId: string,
    input: AdjudicateFindingInput
  ) => Promise<void>;
}) {
  const groups = groupOpenFindingsBySeverity(findings);
  const counts = countOpenFindings(findings);
  if (groups.length === 0) return null;
  // The heading's trailing text names the severity mix so it's visible
  // without scrolling the grouped body below — e.g. "3 open (1 critical, 2 minor)".
  const bySeverity = [
    counts.critical > 0 ? `${counts.critical} critical` : null,
    counts.important > 0 ? `${counts.important} important` : null,
    counts.minor > 0 ? `${counts.minor} minor` : null,
  ]
    .filter((s): s is string => s !== null)
    .join(', ');
  const summary =
    bySeverity === ''
      ? `${counts.open} open`
      : `${counts.open} open (${bySeverity})`;
  return (
    <MainSection
      title="Findings"
      trailing={
        <span
          data-slot="findings-summary"
          className="text-muted-foreground font-book text-[12px] tabular-nums"
        >
          {summary}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div
            key={group.severity}
            data-slot="findings-group"
            className="flex flex-col gap-1.5"
          >
            <div className="flex items-center gap-2">
              <LabelPill color={severityColor(group.severity)}>
                {severityLabel(group.severity)}
              </LabelPill>
              <span className="text-muted-foreground font-book text-[12px] tabular-nums">
                {group.findings.length}
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {group.findings.map((finding) => (
                <li
                  key={finding.id}
                  data-slot="finding-card"
                  className="bg-surface-quaternary rounded-card border-border-strong border-[0.5px] p-3"
                >
                  <div className="text-foreground text-[13px] font-medium">
                    {finding.title}
                  </div>
                  {finding.file !== null && (
                    <div className="text-muted-foreground mt-0.5 font-mono text-[12px] break-all">
                      {finding.file}
                      {finding.line !== null ? `:${finding.line}` : ''}
                    </div>
                  )}
                  <p className="text-muted-foreground font-book mt-1 text-[13px] whitespace-pre-wrap">
                    {finding.detail}
                  </p>
                  {needsRuling && (
                    <AdjudicateFindingForm
                      onSubmit={(input) => onAdjudicate(finding.id, input)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </MainSection>
  );
}

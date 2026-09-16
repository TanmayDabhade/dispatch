import type {
  DispatchConfig,
  EscalationStep,
  ModelConfig,
} from '@dispatch/core/browser';
import { MODEL_ROLES } from '@dispatch/core/browser';
import { useEffect, useState } from 'react';

import { MODELS } from '../../lib/models';
import { EscalationEditor } from './EscalationEditor';
import { SettingsGroup, SettingsHint, SettingsRow } from './SettingsGroup';
import { Input } from '@/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select';

interface AgentsSectionProps {
  config: DispatchConfig;
  onSave: (patch: {
    epicConcurrency?: number;
    permissionMode?: string;
    models?: Partial<ModelConfig>;
    maxTurns?: number | null;
    maxBudgetUsd?: number | null;
    fixLoop?: { cap?: number; escalation?: EscalationStep[] };
  }) => Promise<void>;
}

// One row per config.models role, mirroring ModelConfig's doc comments in
// packages/core/src/config.ts so the schema doesn't have to be read.
const ROLE_INFO: Record<keyof ModelConfig, { label: string; hint: string }> = {
  execute: { label: 'Coding runs', hint: 'The agent that edits the repo.' },
  overseer: {
    label: 'Overseer',
    hint: 'The overseer chat: a full agent session in the checkout that also holds the project controls.',
  },
  plan: { label: 'Planning', hint: 'Multi-turn planning conversations.' },
  draft: {
    label: 'Task drafting',
    hint: 'One-shot natural-language task drafting.',
  },
  enrich: {
    label: 'Enrichment',
    hint: 'Filling in description / acceptance criteria for a task or inbox item.',
  },
  cluster: {
    label: 'Inbox clustering',
    hint: 'Grouping inbox captures into suggested epics.',
  },
  summarize: {
    label: 'Summaries',
    hint: 'Short mechanical text: titles, summaries, commit messages.',
  },
};

// Four of the six modes config.ts accepts; `plan` and `bypassPermissions`
// fall through to the escape-hatch line below instead of a radio.
const PERMISSION_MODES = [
  ['auto', 'Let the classifier decide (default)'],
  ['default', 'Always ask me first'],
  ['acceptEdits', 'Let it edit files, ask before anything else'],
  ['dontAsk', 'Never ask, let it run'],
] as const;

const OFFERED_MODES: readonly string[] = PERMISSION_MODES.map(([mode]) => mode);

// Reads a cap field as the string an input shows: absent stays empty rather
// than rendering the literal word "undefined".
function capToInput(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

/** How agents run: models, concurrency, permission mode, turn/budget caps.
 *  Save feedback lives in the shell, not here — this only calls `onSave`. */
export function AgentsSection({ config, onSave }: AgentsSectionProps) {
  const [concurrency, setConcurrency] = useState('3');
  const [maxTurns, setMaxTurns] = useState('');
  const [maxBudgetUsd, setMaxBudgetUsd] = useState('');
  const [fixLoopCap, setFixLoopCap] = useState('5');

  // Re-seeds when config changes underneath (another window, a hand edit) —
  // keyed on config values, so a field mid-edit isn't clobbered every render.
  useEffect(() => {
    setConcurrency(String(config.orchestrator.epicConcurrency));
    setMaxTurns(capToInput(config.orchestrator.maxTurns));
    setMaxBudgetUsd(capToInput(config.orchestrator.maxBudgetUsd));
    setFixLoopCap(String(config.fixLoop.cap));
  }, [config]);

  // Optional-valued, unlike every other numeric field here: empty clears via
  // null, a finite positive number saves, anything else snaps back.
  function saveCap(
    key: 'maxTurns' | 'maxBudgetUsd',
    raw: string,
    current: number | undefined,
    setDraft: (value: string) => void
  ) {
    const trimmed = raw.trim();
    if (trimmed === '') {
      if (current !== undefined) void onSave({ [key]: null });
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n > 0) {
      if (n !== current) void onSave({ [key]: n });
    } else {
      setDraft(capToInput(current));
    }
  }

  return (
    <>
      <SettingsGroup title="Models">
        {MODEL_ROLES.map((role) => {
          const info = ROLE_INFO[role];
          return (
            <SettingsRow
              key={role}
              title={info.label}
              subtitle={info.hint}
              control={
                <Select
                  value={config.models[role]}
                  onValueChange={(id) =>
                    void onSave({ models: { [role]: id } })
                  }
                >
                  <SelectTrigger
                    aria-label={`${info.label} model`}
                    className="w-[140px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
          );
        })}
      </SettingsGroup>

      <SettingsGroup title="How agents run">
        <SettingsRow
          title="How many run at once when you dispatch an epic"
          htmlFor="how-many-run-at-once-when-you-dispatch-an-epic"
          control={
            <Input
              id="how-many-run-at-once-when-you-dispatch-an-epic"
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
              onBlur={() => {
                const n = Number(concurrency);
                if (
                  Number.isInteger(n) &&
                  n >= 1 &&
                  n !== config.orchestrator.epicConcurrency
                ) {
                  void onSave({ epicConcurrency: n });
                } else {
                  setConcurrency(String(config.orchestrator.epicConcurrency));
                }
              }}
              inputMode="numeric"
              className="w-20 text-right tabular-nums"
            />
          }
        />

        <SettingsRow
          title="When an agent wants to do something consequential"
          subtitle="Auto lets the SDK’s own classifier approve every tool, so a dispatched agent proceeds unattended instead of stalling on the first Bash call."
          stacked
        >
          {/* Native radios rather than the Radio primitive: these are styled
              with `accent-*` as real inputs anyway, and a real input is what
              keeps `getByLabelText(...).checked` meaningful in the tests. */}
          <div
            role="radiogroup"
            aria-label="When an agent wants to do something consequential"
            className="grid gap-1.5"
          >
            {PERMISSION_MODES.map(([mode, label]) => (
              <label
                key={mode}
                className="font-book flex items-center gap-2 text-[13px] text-(--text-secondary)"
              >
                <input
                  type="radio"
                  name="permission-mode"
                  value={mode}
                  checked={config.orchestrator.permissionMode === mode}
                  onChange={() => void onSave({ permissionMode: mode })}
                  className="accent-accent size-3.5"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {!OFFERED_MODES.includes(config.orchestrator.permissionMode) && (
            <SettingsHint>
              Currently &ldquo;{config.orchestrator.permissionMode}&rdquo;, set
              in .dispatch/config.yml
            </SettingsHint>
          )}
        </SettingsRow>

        <SettingsRow
          title="Turn cap"
          subtitle="Ceiling on turns for one run. Leave empty for no cap."
          htmlFor="turn-cap"
          control={
            <Input
              id="turn-cap"
              value={maxTurns}
              onChange={(e) => setMaxTurns(e.target.value)}
              onBlur={() =>
                saveCap(
                  'maxTurns',
                  maxTurns,
                  config.orchestrator.maxTurns,
                  setMaxTurns
                )
              }
              inputMode="numeric"
              placeholder="No cap"
              className="w-24 text-right tabular-nums"
            />
          }
        />

        <SettingsRow
          title="Budget cap per run"
          subtitle="Dollar ceiling on one run’s spend. Leave empty for no cap."
          htmlFor="budget-cap-per-run"
          control={
            <Input
              id="budget-cap-per-run"
              value={maxBudgetUsd}
              onChange={(e) => setMaxBudgetUsd(e.target.value)}
              onBlur={() =>
                saveCap(
                  'maxBudgetUsd',
                  maxBudgetUsd,
                  config.orchestrator.maxBudgetUsd,
                  setMaxBudgetUsd
                )
              }
              inputMode="decimal"
              placeholder="No cap"
              className="w-24 text-right tabular-nums"
            />
          }
        />

        <SettingsRow
          title="Fix-loop round cap"
          subtitle="Last round the fix loop may dispatch before demanding a ruling."
          htmlFor="fix-loop-round-cap"
          control={
            <Input
              id="fix-loop-round-cap"
              value={fixLoopCap}
              onChange={(e) => setFixLoopCap(e.target.value)}
              onBlur={() => {
                const n = Number(fixLoopCap);
                if (Number.isInteger(n) && n >= 1 && n !== config.fixLoop.cap) {
                  void onSave({ fixLoop: { cap: n } });
                } else {
                  setFixLoopCap(String(config.fixLoop.cap));
                }
              }}
              inputMode="numeric"
              className="w-20 text-right tabular-nums"
            />
          }
        />
      </SettingsGroup>

      <EscalationEditor
        steps={config.fixLoop.escalation}
        onChange={(escalation) => void onSave({ fixLoop: { escalation } })}
      />
    </>
  );
}

import type { DispatchConfig, VerifyConfig } from '@dispatch/core/browser';
import { useEffect, useState } from 'react';

import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { Switch } from '@/ui/ai/switch';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';

interface GeneralSectionProps {
  config: DispatchConfig;
  onSave: (patch: {
    verifyCommand?: string | null;
    autoCommit?: boolean;
    verifyTimeoutSec?: number;
    verify?: Partial<VerifyConfig>;
  }) => Promise<void>;
}

/** Before-anything-lands settings: verify command, auto-commit, verify timeout.
 *  Save feedback lives in the shell, not here — this only calls `onSave`. */
export function GeneralSection({ config, onSave }: GeneralSectionProps) {
  const [verify, setVerify] = useState('');
  const [timeoutSec, setTimeoutSec] = useState('600');
  const [runCommand, setRunCommand] = useState('');
  const [runUrl, setRunUrl] = useState('');
  const [runNotes, setRunNotes] = useState('');

  // Re-seeds when config changes underneath (another window, a hand edit) —
  // keyed on config values, so a field mid-edit isn't clobbered every render.
  useEffect(() => {
    setVerify(config.verifyCommand ?? '');
    setTimeoutSec(String(config.orchestrator.verifyTimeoutSec));
    setRunCommand(config.verify?.command ?? '');
    setRunUrl(config.verify?.url ?? '');
    setRunNotes(config.verify?.notes ?? '');
  }, [config]);

  // Shared blur handler for the three verify-recipe fields. Core rejects an empty
  // string for verify.command/url/notes and offers no patch shape to clear one
  // (unlike verifyCommand's `null`), so an emptied field reverts to the saved
  // value instead of sending a string the server would 400 on.
  function saveRunField(
    field: keyof VerifyConfig,
    raw: string,
    current: string | undefined,
    setDraft: (value: string) => void
  ) {
    const trimmed = raw.trim();
    if (trimmed === '') {
      setDraft(current ?? '');
      return;
    }
    if (trimmed !== (current ?? '')) {
      void onSave({ verify: { [field]: trimmed } });
    }
  }

  return (
    <>
      <SettingsGroup title="Before anything lands">
        <SettingsRow
          title="Verify command"
          subtitle="Runs in the merge queue before a branch lands. Leave empty to skip verification entirely."
          htmlFor="verify-command"
          stacked
          control={
            <Input
              id="verify-command"
              value={verify}
              onChange={(e) => setVerify(e.target.value)}
              onBlur={() => {
                const next = verify.trim();
                if (next !== (config.verifyCommand ?? '')) {
                  // Empty clears the key rather than storing an empty command — no verify and a
                  // verify that runs nothing are different things to the merge queue.
                  void onSave({ verifyCommand: next === '' ? null : next });
                }
              }}
              placeholder="bun run verify"
            />
          }
        />

        <SettingsRow
          title="Let an agent commit its own work as it goes"
          htmlFor="auto-commit"
          control={
            <Switch
              id="auto-commit"
              checked={config.autoCommit}
              onCheckedChange={(checked) =>
                void onSave({ autoCommit: checked })
              }
            />
          }
        />

        <SettingsRow
          title="Verify timeout"
          subtitle="Ceiling on one verify run, in seconds. The merge queue is serial, so a verify that never returns holds up every entry behind it."
          htmlFor="verify-timeout"
          control={
            <Input
              id="verify-timeout"
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(e.target.value)}
              onBlur={() => {
                const n = Number(timeoutSec);
                if (
                  Number.isInteger(n) &&
                  n >= 1 &&
                  n !== config.orchestrator.verifyTimeoutSec
                ) {
                  void onSave({ verifyTimeoutSec: n });
                } else {
                  // Snap a nonsense value back rather than leaving the field showing something the
                  // config does not actually say.
                  setTimeoutSec(String(config.orchestrator.verifyTimeoutSec));
                }
              }}
              inputMode="numeric"
              className="w-20 text-right tabular-nums"
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="How to run this project"
        hint="The recipe a verify run follows to exercise the project by hand — separate from “Verify command” above, which the merge queue runs automatically before a branch lands."
      >
        <SettingsRow
          title="Run command"
          subtitle="Starts the project so a verify run has something to exercise. Not the merge-queue gate above."
          htmlFor="run-command"
          stacked
          control={
            <Input
              id="run-command"
              value={runCommand}
              onChange={(e) => setRunCommand(e.target.value)}
              onBlur={() =>
                saveRunField(
                  'command',
                  runCommand,
                  config.verify?.command,
                  setRunCommand
                )
              }
              placeholder="bun run dev"
            />
          }
        />

        <SettingsRow
          title="URL"
          subtitle="Where a verify run should look once the project is running."
          htmlFor="url"
          stacked
          control={
            <Input
              id="url"
              value={runUrl}
              onChange={(e) => setRunUrl(e.target.value)}
              onBlur={() =>
                saveRunField('url', runUrl, config.verify?.url, setRunUrl)
              }
              placeholder="http://localhost:3000"
            />
          }
        />

        <SettingsRow
          title="Notes"
          subtitle="Anything else a verify run needs to know to exercise the project."
          htmlFor="notes"
          stacked
          control={
            <Textarea
              id="notes"
              value={runNotes}
              onChange={(e) => setRunNotes(e.target.value)}
              onBlur={() =>
                saveRunField(
                  'notes',
                  runNotes,
                  config.verify?.notes,
                  setRunNotes
                )
              }
              placeholder="Login steps, seed data, ports…"
            />
          }
        />
      </SettingsGroup>
    </>
  );
}

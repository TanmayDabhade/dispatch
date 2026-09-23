import type { ExecutorsResponse } from '@dispatch/client';
import type { ConfigPatch, DispatchConfig } from '@dispatch/core/browser';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  ChoiceSetting,
  NumberSetting,
  OPERATOR_ONLY,
  SwitchSetting,
} from './fields';
import { SettingsGroup, SettingsHint, SettingsRow } from './SettingsGroup';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';

interface Props {
  config: DispatchConfig;
  executors: ExecutorsResponse | null;
  onSave: (patch: ConfigPatch) => Promise<void>;
  canOperate: boolean;
}

/**
 * The rest of Settings → Agents: which agent a dispatch runs on by default,
 * how many may run at once, the cost estimate the budget math uses, whether
 * the fix loop starts on its own, and the CLI agents a project declares.
 */
export function AgentsMoreGroups({
  config,
  executors,
  onSave,
  canOperate,
}: Props) {
  const names = [
    ...new Set([
      ...(executors?.executors.map((e) => e.name) ?? []),
      ...Object.keys(config.executors ?? {}),
      config.orchestrator.executor,
    ]),
  ];
  return (
    <>
      <SettingsGroup title="Runs">
        <ChoiceSetting
          id="default-executor"
          title="Default agent"
          subtitle="What a dispatch runs on when it does not name one."
          value={config.orchestrator.executor}
          choices={names.map((name) => ({ value: name, label: name }))}
          onSave={(executor) => void onSave({ executor })}
        />
        <NumberSetting
          id="max-concurrency"
          title="Most runs at once"
          subtitle="Across everything on this project: epics, fix loops and single dispatches."
          value={config.orchestrator.maxConcurrency}
          onSave={(n) => n !== null && void onSave({ maxConcurrency: n })}
        />
        <NumberSetting
          id="run-cost-estimate"
          title="Cost estimate per run"
          subtitle="What the budget math assumes a run costs before it reports its own."
          value={config.orchestrator.runCostEstimateUsd}
          min={0.01}
          integer={false}
          suffix="USD"
          onSave={(n) => n !== null && void onSave({ runCostEstimateUsd: n })}
        />
        <SwitchSetting
          id="fix-loop-auto"
          title="Start the fix loop by itself"
          subtitle="When a review finds problems, send the run back without waiting to be asked."
          checked={config.fixLoop.auto}
          onSave={(auto) => void onSave({ fixLoop: { auto } })}
        />
      </SettingsGroup>
      <CliAgents config={config} onSave={onSave} canOperate={canOperate} />
    </>
  );
}

/** One argument per line, blank lines dropped — how the command is written. */
export function argvFromLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * CLI agents: any coding agent that takes a prompt on the command line,
 * declared as the arguments to run it with. `{prompt}` and `{model}` are
 * filled in when a run starts.
 */
function CliAgents({ config, onSave, canOperate }: Omit<Props, 'executors'>) {
  const declared = Object.entries(config.executors ?? {}).filter(
    ([, e]) => e.command !== undefined
  );
  const [name, setName] = useState('');
  const [argv, setArgv] = useState('');
  const [model, setModel] = useState('');

  async function add() {
    const run = argvFromLines(argv);
    const id = name.trim();
    if (id === '' || run.length === 0 || model.trim() === '') return;
    await onSave({
      executors: {
        [id]: { command: { run }, models: { execute: model.trim() } },
      },
    });
    setName('');
    setArgv('');
    setModel('');
  }

  return (
    <SettingsGroup
      title="CLI agents"
      hint="Any coding agent with a command line. Write one argument per line; {prompt} and {model} are filled in when a run starts, and with no {prompt} the prompt arrives on stdin."
    >
      {declared.length === 0 && (
        <SettingsRow
          title="None declared"
          subtitle="Claude and Codex are built in."
        />
      )}
      {declared.map(([id, e]) => (
        <SettingsRow
          key={id}
          title={id}
          subtitle={
            <span className="font-mono">{e.command?.run.join(' ')}</span>
          }
          control={
            canOperate ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${id}`}
                onClick={() => void onSave({ executors: { [id]: null } })}
              >
                <Trash2 />
              </Button>
            ) : undefined
          }
        />
      ))}
      {canOperate ? (
        <SettingsRow title="Add an agent" htmlFor="cli-agent-name" stacked>
          <div className="flex flex-col gap-2">
            <Input
              id="cli-agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="gemini"
            />
            <Textarea
              aria-label="Command, one argument per line"
              value={argv}
              onChange={(e) => setArgv(e.target.value)}
              placeholder={'gemini\n-p\n{prompt}'}
              rows={3}
              className="font-mono"
              spellCheck={false}
            />
            <Input
              aria-label="Model for coding runs"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gemini-2.5-pro"
            />
            <Button
              className="self-start"
              disabled={
                name.trim() === '' ||
                argvFromLines(argv).length === 0 ||
                model.trim() === ''
              }
              onClick={() => void add()}
            >
              <Plus />
              Add agent
            </Button>
          </div>
        </SettingsRow>
      ) : (
        <SettingsRow title="Adding or removing agents">
          <SettingsHint>{OPERATOR_ONLY}</SettingsHint>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}

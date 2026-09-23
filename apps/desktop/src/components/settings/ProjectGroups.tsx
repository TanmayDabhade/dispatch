import type {
  ConfigPatch,
  DispatchConfig,
  VerifyStep,
} from '@dispatch/core/browser';
import { statusLabel } from '@dispatch/core/browser';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { OPERATOR_ONLY, TextSetting } from './fields';
import { SettingsGroup, SettingsHint, SettingsRow } from './SettingsGroup';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

interface Props {
  config: DispatchConfig;
  onSave: (patch: ConfigPatch) => Promise<void>;
  canOperate: boolean;
}

/** `list` with the entry at `from` moved one place up or down. */
export function moved<T>(list: T[], from: number, by: -1 | 1): T[] {
  const to = from + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/**
 * The project's shape, on Settings → General: the board's statuses, the
 * named checks a branch must pass before it lands, and where pull-request
 * checkouts go.
 */
export function ProjectGroups({ config, onSave, canOperate }: Props) {
  return (
    <>
      <StatusesGroup config={config} onSave={onSave} />
      <VerifyStepsGroup
        config={config}
        onSave={onSave}
        canOperate={canOperate}
      />
      <SettingsGroup title="Pull requests">
        <TextSetting
          id="pr-worktree-dir"
          title="Where pull-request checkouts go"
          subtitle="Reviewing someone's PR checks it out here. Empty keeps the default under the Dispatch home."
          value={config.prWorktreeDir}
          placeholder="../pr-worktrees"
          mono
          locked={canOperate ? undefined : OPERATOR_ONLY}
          onSave={(prWorktreeDir) => void onSave({ prWorktreeDir })}
        />
      </SettingsGroup>
    </>
  );
}

function StatusesGroup({ config, onSave }: Omit<Props, 'canOperate'>) {
  const [draft, setDraft] = useState('');
  const statuses = config.statuses;
  const add = () => {
    const name = draft.trim().toLowerCase();
    if (name === '' || statuses.includes(name)) return;
    // New ones go before the last, which is where work ends.
    void onSave({
      statuses: [...statuses.slice(0, -1), name, ...statuses.slice(-1)],
    }).then(() => setDraft(''));
  };
  return (
    <SettingsGroup
      title="Statuses"
      hint="The board's columns, in order. A status some task is still in cannot be removed: move those tasks first."
    >
      {statuses.map((status, i) => (
        <SettingsRow
          key={status}
          title={statusLabel(status)}
          control={
            <span className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Move ${status} up`}
                disabled={i === 0}
                onClick={() =>
                  void onSave({ statuses: moved(statuses, i, -1) })
                }
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Move ${status} down`}
                disabled={i === statuses.length - 1}
                onClick={() => void onSave({ statuses: moved(statuses, i, 1) })}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${status}`}
                disabled={statuses.length === 1}
                onClick={() =>
                  void onSave({
                    statuses: statuses.filter((s) => s !== status),
                  })
                }
              >
                <Trash2 />
              </Button>
            </span>
          }
        />
      ))}
      <SettingsRow title="Add a status" htmlFor="status-new">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            id="status-new"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="qa"
            className="w-48"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={draft.trim() === ''}
          >
            <Plus />
            Add status
          </Button>
        </form>
      </SettingsRow>
    </SettingsGroup>
  );
}

function VerifyStepsGroup({ config, onSave, canOperate }: Props) {
  const steps = config.verifySteps ?? [];
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const save = (next: VerifyStep[]) =>
    onSave({ verifySteps: next.length === 0 ? null : next });
  return (
    <SettingsGroup
      title="Verify steps"
      hint="Named checks a branch must pass before it lands, run in order, each reported on its own. Set, these replace the single verify command."
    >
      {steps.length === 0 && (
        <SettingsRow
          title="None"
          subtitle="The verify command above is the only gate."
        />
      )}
      {steps.map((step, i) => (
        <SettingsRow
          key={`${step.name}-${i}`}
          title={step.name}
          subtitle={<span className="font-mono">{step.command}</span>}
          control={
            canOperate ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${step.name}`}
                onClick={() => void save(steps.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            ) : undefined
          }
        />
      ))}
      {canOperate ? (
        <SettingsRow title="Add a step" htmlFor="verify-step-name">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() === '' || command.trim() === '') return;
              void save([
                ...steps,
                { name: name.trim(), command: command.trim() },
              ]).then(() => {
                setName('');
                setCommand('');
              });
            }}
          >
            <Input
              id="verify-step-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="tests"
              className="w-32"
            />
            <Input
              aria-label="Command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="pnpm test"
              className="min-w-[200px] flex-1 font-mono"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={name.trim() === '' || command.trim() === ''}
            >
              <Plus />
              Add step
            </Button>
          </form>
        </SettingsRow>
      ) : (
        <SettingsRow title="Changing steps">
          <SettingsHint>{OPERATOR_ONLY}</SettingsHint>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}

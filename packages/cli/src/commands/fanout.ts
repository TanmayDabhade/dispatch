import type { Command } from 'commander';

import { createApiClient } from '../apiClient.js';
import type { CliContext } from '../context.js';
import { CliError } from '../context.js';
import { attachToRunningDaemon } from './appToken.js';

/**
 * `dispatch fanout` — try the same work on several agents at once.
 *
 * Each agent gets its own clone of the task, its own worktree and its own
 * branch, so the results are compared the way any other work is: one diff
 * each, and you merge the one you want. See packages/server/src/fanout.ts for
 * why it clones rather than racing several runs on one task.
 */

/**
 * Reads `--executors claude,codex` and `--model codex=gpt-5.5` into variants.
 *
 * The model syntax is `executor=model` rather than a positional pair because
 * the two lists are not necessarily the same length — pinning a model for one
 * agent should not mean naming one for all of them.
 */
export function parseFanoutArgs(
  executors: string,
  models: string[]
): { executor: string; model?: string }[] {
  const names = executors
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  if (names.length === 0) {
    throw new CliError('--executors needs at least one agent name');
  }

  const byExecutor = new Map<string, string>();
  for (const entry of models) {
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      throw new CliError(`--model expects executor=model, got "${entry}"`);
    }
    byExecutor.set(entry.slice(0, eq).trim(), entry.slice(eq + 1).trim());
  }
  for (const name of byExecutor.keys()) {
    if (!names.includes(name)) {
      throw new CliError(
        `--model names "${name}", which is not in --executors`
      );
    }
  }

  return names.map((executor) => {
    const model = byExecutor.get(executor);
    return { executor, ...(model === undefined ? {} : { model }) };
  });
}

export function registerFanoutCommand(program: Command, ctx: CliContext): void {
  program
    .command('fanout <taskId>')
    .description('Run one task on several agents at once and compare')
    .requiredOption(
      '--executors <names>',
      'comma-separated agents to try, e.g. claude,codex'
    )
    .option(
      '--model <executor=model>',
      'pin one agent’s model; repeatable',
      (value: string, previous: string[]) => [...previous, value],
      [] as string[]
    )
    .option('--json')
    .action(
      async (
        taskId: string,
        opts: { executors: string; model: string[]; json?: boolean }
      ) => {
        const variants = parseFanoutArgs(opts.executors, opts.model);
        const { baseUrl, agentToken } = await attachToRunningDaemon(ctx);
        const result = await createApiClient(baseUrl, agentToken).fanoutTask(
          taskId,
          variants
        );

        if (opts.json === true) {
          ctx.log(JSON.stringify(result, null, 2));
          return;
        }
        ctx.log(`fanout ${result.label}`);
        for (const variant of result.variants) {
          // A variant that failed to start is reported rather than omitted:
          // the whole point is knowing which agents are actually running.
          ctx.log(
            variant.run === null
              ? `  ${variant.executor}  ${variant.task.meta.id}  not started: ${variant.error ?? 'unknown reason'}`
              : `  ${variant.executor}  ${variant.task.meta.id}  ${variant.run.branch}`
          );
        }
      }
    );
}

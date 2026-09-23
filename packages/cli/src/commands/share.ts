import type { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createApiClient } from '../apiClient.js';
import type { CliContext } from '../context.js';
import { CliError } from '../context.js';
import type { RunPacket } from '../sharePage.js';
import { renderSharePage } from '../sharePage.js';
import { attachToRunningDaemon } from './appToken.js';

/** Default filename for a run's page: the run id, so a directory of them
 *  sorts and greps sensibly. */
function defaultOut(runId: string): string {
  return `${runId}.html`;
}

/**
 * Assembles one run's page from the daemon's own endpoints.
 *
 * Findings and the ledger are fetched per run rather than stored on it,
 * because that is where they live: findings hang off the task, and the ledger
 * is project-wide. The ledger is narrowed to entries that name this run's task
 * (or apply to everything) so the page carries the decisions that governed
 * this work and not every decision the project ever made.
 *
 * Each fetch is independent, so they go out together — on a long transcript
 * the diff and the findings are not worth waiting in line for.
 */
export async function buildPacket(
  client: ReturnType<typeof createApiClient>,
  runId: string,
  now: () => Date
): Promise<RunPacket> {
  const detail = await client.getRun(runId);
  const [diff, findings, ledger] = await Promise.all([
    client.getRunDiff(runId),
    client.getTaskFindings(detail.meta.taskId),
    client.getLedger(),
  ]);
  return {
    generatedAt: now().toISOString(),
    run: detail.meta,
    diff,
    entries: detail.entries,
    evidence: detail.evidence,
    findings,
    ledger: ledger.filter(
      (entry) =>
        entry.appliesTo.length === 0 ||
        entry.appliesTo.includes(detail.meta.taskId)
    ),
  };
}

export function registerShareCommands(program: Command, ctx: CliContext): void {
  program
    .command('share <runId>')
    .description(
      'Write a self-contained HTML page of a run — diff, findings, decisions, evidence and transcript'
    )
    .option('--out <path>', 'where to write it (default: <runId>.html)')
    .option('--json', 'print the assembled data instead of rendering a page')
    .action(async (runId: string, opts: { out?: string; json?: boolean }) => {
      const { baseUrl, agentToken } = await attachToRunningDaemon(ctx);
      const client = createApiClient(baseUrl, agentToken);
      const packet = await buildPacket(client, runId, () => new Date());

      // `--json` exists so the same assembly can feed something other than
      // this page — a different template, a ticket, another tool.
      if (opts.json === true) {
        ctx.log(JSON.stringify(packet, null, 2));
        return;
      }

      const out = resolve(ctx.cwd, opts.out ?? defaultOut(runId));
      try {
        writeFileSync(out, renderSharePage(packet));
      } catch (err) {
        throw new CliError(`could not write ${out}: ${(err as Error).message}`);
      }
      ctx.log(`wrote ${out}`);
    });
}

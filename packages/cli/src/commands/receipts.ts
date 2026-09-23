import {
  absoluteGitLocation,
  DEFAULT_RECEIPTS_BRANCH,
  formatMigrationReport,
  initProjectStores,
  restoreReceipts,
  writeProjectBackend,
} from '@dispatch/core';
import type { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CliContext } from '../context.js';
import { CliError } from '../context.js';
import { projectRoot } from '../projectRoot.js';
import { findRunningDaemon } from './daemon.js';

/**
 * The location a `--from` names, absolute: one of this project's remotes when
 * it is one (a relative URL on it read from the project root, where git reads
 * it), otherwise a URL or a path — a path meaning from where you typed it.
 * The clone runs in a temp dir, where a relative path would mean nothing.
 */
function remoteUrl(root: string, cwd: string, from: string): string {
  const res = spawnSync('git', ['remote', 'get-url', '--', from], {
    cwd: root,
    encoding: 'utf8',
  });
  if (res.status === 0) return absoluteGitLocation(root, res.stdout.trim());
  return absoluteGitLocation(cwd, from);
}

export function registerReceiptsCommands(
  program: Command,
  ctx: CliContext
): void {
  const receipts = program
    .command('receipts')
    .description("The board's audit log, and rebuilding a board from it");

  receipts
    .command('restore')
    .description(
      "Rebuild this machine's board from a receipt log another machine pushed"
    )
    .requiredOption('--from <urlOrRemote>', 'where the log was pushed')
    .option('--branch <name>', 'its branch', DEFAULT_RECEIPTS_BRANCH)
    .action((opts: { from: string; branch: string }) => {
      const root = projectRoot(ctx.cwd);
      return findRunningDaemon(ctx.cwd).then((daemon) => {
        // The daemon owns the database while it runs; writing under it would
        // race every request it serves.
        if (daemon !== null) {
          throw new CliError(
            `dispatchd is running for this project (port ${daemon.port}); stop it first, then restore`
          );
        }
        const url = remoteUrl(root, ctx.cwd, opts.from);
        const dir = mkdtempSync(join(tmpdir(), 'dispatch-receipts-restore-'));
        try {
          const cloned = spawnSync(
            'git',
            ['clone', '-q', '--depth', '1', '--branch', opts.branch, url, dir],
            { encoding: 'utf8' }
          );
          if (cloned.status !== 0) {
            throw new CliError(
              `could not fetch ${opts.branch} from ${url}: ${cloned.stderr.trim()}`
            );
          }
          const stores = initProjectStores({
            rootDir: root,
            backend: 'sqlite',
          });
          let result;
          try {
            // Adds what is missing and never overwrites: a task this board
            // already holds keeps its own version.
            result = restoreReceipts(dir, stores);
          } finally {
            stores.close();
          }
          ctx.log(formatMigrationReport(result.migration));
          ctx.log(
            `evidence: ${result.runs} run(s), ${result.commands} command(s), ${result.mutations} mutation(s)`
          );
          for (const problem of result.problems) {
            ctx.log(`problem: ${problem.source}: ${problem.detail}`);
          }
          if (
            result.problems.length === 0 &&
            result.migration.problems.length === 0
          ) {
            writeProjectBackend(root, 'sqlite');
            ctx.log('Restored. Start the daemon to serve this board.');
          } else {
            ctx.log(
              'Restored with the problems above; the project is not yet marked as database-backed. Fix them and run this again.'
            );
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    });
}

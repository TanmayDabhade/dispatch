import { loadConfig } from '@dispatch/core';
import type { Command } from 'commander';
import { spawnSync } from 'node:child_process';

import type { CliContext } from '../context.js';
import { CliError } from '../context.js';

/**
 * `dispatch remote` — the machines this project can reach over ssh.
 *
 * Local, not a daemon route: reading `.dispatch/config.yml` and running ssh
 * are both things this process can do, and routing them through the daemon
 * would only mean `dispatch remote list` failed when no daemon is running.
 *
 * Remote *terminals* do go through the daemon (`POST /api/terminals` with a
 * `remote`), because a session has to outlive the command that opened it.
 * What is not here at all: running an agent on a remote checkout. The
 * orchestrator works in local worktree paths throughout, so remote runs are a
 * much larger change than remote shells.
 */

/** The ssh destination for a configured remote. */
export function remoteDestination(remote: {
  host: string;
  user?: string;
}): string {
  return remote.user === undefined || remote.user === ''
    ? remote.host
    : `${remote.user}@${remote.host}`;
}

export function registerRemoteCommands(
  program: Command,
  ctx: CliContext
): void {
  const remote = program
    .command('remote')
    .description('Machines this project can reach over ssh');

  remote
    .command('list')
    .description('Every configured remote')
    .option('--json')
    .action((opts: { json?: boolean }) => {
      const remotes = loadConfig(ctx.cwd).remotes ?? {};
      const rows = Object.entries(remotes).map(([name, config]) => ({
        name,
        destination: remoteDestination(config),
        ...(config.port === undefined ? {} : { port: config.port }),
        ...(config.path === undefined ? {} : { path: config.path }),
      }));
      if (opts.json === true) {
        ctx.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) {
        ctx.log(
          'no remotes configured (add a remotes: block to .dispatch/config.yml)'
        );
        return;
      }
      for (const row of rows) {
        ctx.log(
          `${row.name}  ${row.destination}${row.path === undefined ? '' : `  ${row.path}`}`
        );
      }
    });

  remote
    .command('exec <name> <command...>')
    .description('Run a command on a remote, in its configured path')
    .option('--cwd <dir>', 'run somewhere other than the remote’s path')
    .action((name: string, command: string[], opts: { cwd?: string }) => {
      const remotes = loadConfig(ctx.cwd).remotes ?? {};
      const config = remotes[name];
      if (config === undefined) {
        const known = Object.keys(remotes);
        throw new CliError(
          known.length === 0
            ? `no remote named "${name}" — none are configured`
            : `no remote named "${name}" (have ${known.join(', ')})`
        );
      }

      const cwd = opts.cwd ?? config.path;
      const args = [
        ...(config.port === undefined ? [] : ['-p', String(config.port)]),
        ...(config.identityFile === undefined
          ? []
          : ['-i', config.identityFile]),
        remoteDestination(config),
        ...(cwd === undefined ? [] : ['cd', cwd, '&&']),
        ...command,
      ];
      // Inherited stdio rather than captured: this is a passthrough, so the
      // remote's own output, exit code and any prompt it puts up belong to the
      // terminal the user is sitting at.
      const result = spawnSync('ssh', args, { stdio: 'inherit' });
      if (result.error !== undefined) {
        throw new CliError(`could not run ssh: ${result.error.message}`);
      }
      if (result.status !== 0 && result.status !== null) {
        throw new CliError(`remote command exited with ${result.status}`);
      }
    });
}

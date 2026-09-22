import type { Command } from 'commander';

import { createApiClient } from '../apiClient.js';
import type { CliContext } from '../context.js';
import { CliError } from '../context.js';
import { formatTable } from '../output.js';
import { attachToRunningDaemon, resolveAppToken } from './appToken.js';

type Tier = 'request' | 'decide';

function tierFrom(decide: boolean | undefined): Tier {
  return decide === true ? 'decide' : 'request';
}

/**
 * A client on the app token, attached to the daemon already running. Every
 * team command is decide-tier — handing out a credential is an adjudication —
 * so none of them may fall back to the agent token the way read commands do.
 */
async function decideClient(
  ctx: CliContext,
  token: string | undefined,
  command: string
) {
  const appToken = resolveAppToken(token, command);
  const { baseUrl } = await attachToRunningDaemon(ctx);
  return createApiClient(baseUrl, appToken);
}

export function registerTeamCommands(program: Command, ctx: CliContext): void {
  const team = program
    .command('team')
    .description('Give teammates their own credential for a shared daemon');

  team
    .command('invite <emailOrHandle>')
    .description(
      'Issue a teammate a token (adds them to team.yml when given an email)'
    )
    .option('--name <displayName>', 'display name for a new roster entry')
    .option('--decide', 'grant the decide tier (approvals, scope, merges)')
    .option('--token <token>', 'the daemon app token (or DISPATCH_APP_TOKEN)')
    .option('--json')
    .action(
      async (
        who: string,
        opts: {
          name?: string;
          decide?: boolean;
          token?: string;
          json?: boolean;
        }
      ) => {
        const client = await decideClient(
          ctx,
          opts.token,
          'dispatch team invite'
        );
        const tier = tierFrom(opts.decide);
        const issued = await client.issueTeamToken(
          who.includes('@')
            ? { email: who, displayName: opts.name, tier }
            : { handle: who, tier }
        );
        if (opts.json === true) {
          ctx.log(JSON.stringify(issued, null, 2));
          return;
        }
        // Said once, plainly: the daemon keeps only a hash, so this line is
        // the only place the token will ever be shown.
        ctx.log(`issued ${issued.tier} token for ${issued.handle}`);
        ctx.log('');
        ctx.log(`  ${issued.token}`);
        ctx.log('');
        ctx.log(
          'Send it to them privately. It is not stored anywhere readable and cannot be shown again; re-run this command to replace it.'
        );
      }
    );

  team
    .command('tokens')
    .description('List who holds a credential (never the credentials)')
    .option('--token <token>', 'the daemon app token (or DISPATCH_APP_TOKEN)')
    .option('--json')
    .action(async (opts: { token?: string; json?: boolean }) => {
      const client = await decideClient(
        ctx,
        opts.token,
        'dispatch team tokens'
      );
      const holders = await client.listTeamTokens();
      if (opts.json === true) {
        ctx.log(JSON.stringify(holders, null, 2));
        return;
      }
      ctx.log(
        formatTable([
          ['HANDLE', 'TIER', 'KIND', 'ISSUED'],
          ...holders.map((h) => [
            h.handle,
            h.tier,
            h.builtIn ? 'daemon' : 'issued',
            h.issuedAt ?? '-',
          ]),
        ])
      );
    });

  team
    .command('revoke <handle>')
    .description("Revoke a teammate's token; it stops working immediately")
    .option('--decide', 'revoke their decide-tier token instead')
    .option('--token <token>', 'the daemon app token (or DISPATCH_APP_TOKEN)')
    .action(
      async (handle: string, opts: { decide?: boolean; token?: string }) => {
        const client = await decideClient(
          ctx,
          opts.token,
          'dispatch team revoke'
        );
        const tier = tierFrom(opts.decide);
        try {
          await client.revokeTeamToken(handle, tier);
        } catch (err) {
          throw new CliError(
            `could not revoke ${handle}'s ${tier} token: ${(err as Error).message}`
          );
        }
        ctx.log(`revoked ${handle}'s ${tier} token`);
      }
    );
}

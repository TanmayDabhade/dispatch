import type { TeamMember } from '@dispatch/core';
import {
  DISPATCH_DIR,
  parseTeam,
  serializeTeam,
  TeamParseError,
  upsertMember,
} from '@dispatch/core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ApiContext, AuthTier } from '../api.js';
import { errorResponse, jsonResponse, readJsonBody } from './http.js';

// Issuing credentials to teammates: the step that turns one person's daemon
// into one a team can share. Every route here is decide-tier (see
// DECIDE_TIER_ROUTES) — handing out a credential is an adjudication, and an
// agent holding the on-disk agent token must not be able to mint itself a
// second identity.

const TIERS: readonly string[] = ['request', 'decide'];

function teamFile(rootDir: string): string {
  return join(rootDir, DISPATCH_DIR, 'team.yml');
}

/** The roster as it stands, or a reason it cannot be read. A conflicted
 *  team.yml is reported, never treated as empty — writing over it would wipe
 *  the team, the same rule ActorContext follows. */
function readRoster(
  rootDir: string
): { ok: true; members: TeamMember[] } | { ok: false; error: string } {
  const file = teamFile(rootDir);
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : '';
  try {
    return { ok: true, members: parseTeam(raw) };
  } catch (err) {
    if (!(err instanceof TeamParseError)) throw err;
    return { ok: false, error: err.message };
  }
}

// GET /api/team/tokens — who holds credentials, never the credentials.
export function listTeamTokens(ctx: ApiContext): Response {
  return jsonResponse(ctx.tokens.registry.list());
}

/**
 * POST /api/team/tokens — issue a teammate a credential.
 *
 * Body is either `{ handle }` for someone already on the roster, or
 * `{ email, displayName? }` to add them first — the same upsert a teammate's
 * own daemon performs on its first boot, so a person invited here and a person
 * who joined by cloning land as the same roster entry. `tier` defaults to
 * `request`: someone new to a project can drive it before they can adjudicate
 * in it, and granting `decide` is a separate, explicit act.
 *
 * The token is in the response body and nowhere else. It is not logged, not
 * persisted (only its hash is), and cannot be read back — lose it and issue a
 * new one, which revokes the old.
 */
export async function issueTeamToken(
  req: Request,
  ctx: ApiContext
): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as {
    handle?: unknown;
    email?: unknown;
    displayName?: unknown;
    tier?: unknown;
  };

  const tier = body.tier ?? 'request';
  if (typeof tier !== 'string' || !TIERS.includes(tier)) {
    return errorResponse(400, "invalid tier: expected 'request' or 'decide'");
  }

  const roster = readRoster(ctx.rootDir);
  if (!roster.ok) {
    return errorResponse(
      409,
      `team.yml cannot be read (${roster.error}); resolve it before issuing tokens`
    );
  }

  let handle: string;
  if (typeof body.email === 'string' && body.email.trim() !== '') {
    const email = body.email.trim();
    if (!email.includes('@')) {
      return errorResponse(400, 'invalid email');
    }
    const displayName =
      typeof body.displayName === 'string' && body.displayName.trim() !== ''
        ? body.displayName.trim()
        : email.slice(0, email.indexOf('@'));
    const result = upsertMember(roster.members, email, displayName);
    if (result.changed) {
      mkdirSync(join(ctx.rootDir, DISPATCH_DIR), { recursive: true });
      writeFileSync(teamFile(ctx.rootDir), serializeTeam(result.members));
    }
    handle = result.member.handle;
  } else if (typeof body.handle === 'string') {
    const wanted = body.handle;
    if (!roster.members.some((m) => m.handle === wanted)) {
      return errorResponse(
        404,
        `no roster member "${wanted}": pass their email instead to add them`
      );
    }
    handle = wanted;
  } else {
    return errorResponse(400, 'expected { handle } or { email }');
  }

  const token = ctx.tokens.registry.issue(handle, tier as AuthTier);
  return jsonResponse({ handle, tier, token }, 201);
}

// DELETE /api/team/tokens/:handle/:tier — revoke one. 404 rather than a
// silent 200 when there was nothing to revoke, so a typo in a handle is
// visible instead of reading as success.
export function revokeTeamToken(
  ctx: ApiContext,
  handle: string,
  tier: string
): Response {
  if (!TIERS.includes(tier)) {
    return errorResponse(400, "invalid tier: expected 'request' or 'decide'");
  }
  const revoked = ctx.tokens.registry.revoke(handle, tier as AuthTier);
  return revoked
    ? jsonResponse({ ok: true })
    : errorResponse(404, `no issued ${tier} token for "${handle}"`);
}

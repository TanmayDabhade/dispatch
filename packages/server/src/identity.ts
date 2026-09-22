import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { AuthTier } from './api.js';

// Who is on the other end of a request, not just what they may do.
//
// The daemon has always minted exactly two tokens — one per capability tier —
// which is enough to answer "may this call proceed" and not enough to answer
// "who made it". Presence, claims and trustworthy attribution all need the
// second answer, so tokens gain an identity here while keeping the tier they
// already carried.
//
// The team model this maps onto already exists: `.dispatch/team.yml` holds the
// roster (packages/core/src/team.ts) and ActorContext already renders a member
// as `human:<handle>`. Nothing new is invented — the wire simply stops being
// anonymous.

/** Who a presented token authenticates as, and what it may do. */
export interface TokenIdentity {
  /** The team handle, as `team.yml` records it. */
  handle: string;
  /** Serialized ActorRef — `human:<handle>` — ready for an attribution field. */
  ref: string;
  tier: AuthTier;
}

/** One issued credential. The token itself never leaves the registry except
 *  at the moment it is issued. */
interface Entry extends TokenIdentity {
  token: string;
  /** True for the two tokens the daemon mints at startup. They authenticate
   *  as the operator, so today's single-user behaviour is unchanged. */
  builtIn: boolean;
}

/** What a caller may safely be shown about who holds credentials: never a
 *  token, since a list endpoint would otherwise hand them out. */
export interface IssuedTokenSummary {
  handle: string;
  tier: AuthTier;
  builtIn: boolean;
}

/** Length-independent comparison, so a mismatch never leaks where it
 *  diverged. Mirrors api.ts's own `tokenMatches`, which this replaces as the
 *  single place a presented credential is checked. */
function sameToken(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The ActorRef a human handle renders as. Duplicated from core's actor.ts
 *  rather than imported for one string, the same way team.ts duplicates the
 *  handle pattern. */
function humanRef(handle: string): string {
  return `human:${handle}`;
}

/**
 * Every credential this daemon accepts, and who each one speaks for.
 *
 * Seeded with the two built-in tokens, both attributed to the operator — the
 * person whose machine this daemon runs on — so a solo project behaves exactly
 * as it did before. Additional tokens are issued per teammate, which is what
 * lets one shared daemon tell two humans apart.
 */
export class TokenRegistry {
  private readonly entries: Entry[] = [];

  constructor(
    builtIn: { agentToken: string; appToken: string },
    operatorHandle: string
  ) {
    // The app token is the decide tier and the agent token the request tier,
    // exactly as before. What is new is that both now name someone.
    this.entries.push(
      {
        token: builtIn.appToken,
        handle: operatorHandle,
        ref: humanRef(operatorHandle),
        tier: 'decide',
        builtIn: true,
      },
      {
        token: builtIn.agentToken,
        handle: operatorHandle,
        ref: humanRef(operatorHandle),
        tier: 'request',
        builtIn: true,
      }
    );
  }

  /**
   * Who this token speaks for, or null when it matches nothing.
   *
   * Ordered highest tier first, so the app token still wins when both are
   * somehow the same string — the pre-existing behaviour, kept deliberately
   * rather than by accident.
   */
  resolve(presented: string | null): TokenIdentity | null {
    if (presented === null) return null;
    for (const entry of this.entries) {
      if (sameToken(presented, entry.token)) {
        return { handle: entry.handle, ref: entry.ref, tier: entry.tier };
      }
    }
    return null;
  }

  /**
   * Mints a credential for one teammate and returns it. The only time a token
   * value leaves this registry — callers hand it to its owner and keep no copy
   * here beyond the comparison.
   *
   * Re-issuing for a handle and tier that already has one replaces it, so a
   * teammate whose laptop was lost is re-credentialed rather than accumulating
   * live tokens.
   */
  issue(handle: string, tier: AuthTier): string {
    this.revoke(handle, tier);
    const token = randomBytes(32).toString('hex');
    this.entries.push({
      token,
      handle,
      ref: humanRef(handle),
      tier,
      builtIn: false,
    });
    return token;
  }

  /**
   * Drops an issued credential. Returns whether one was there.
   *
   * The built-in pair is never revocable: they are this daemon's own
   * credentials, and dropping them would lock the operator out of the process
   * running on their machine with no way back in short of a restart.
   */
  revoke(handle: string, tier: AuthTier): boolean {
    const at = this.entries.findIndex(
      (e) => !e.builtIn && e.handle === handle && e.tier === tier
    );
    if (at === -1) return false;
    this.entries.splice(at, 1);
    return true;
  }

  /** Who currently holds credentials, without the credentials. */
  list(): IssuedTokenSummary[] {
    return this.entries.map(({ handle, tier, builtIn }) => ({
      handle,
      tier,
      builtIn,
    }));
  }
}

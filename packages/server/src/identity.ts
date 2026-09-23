import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

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

/** One issued teammate credential as it is kept on disk: a hash, never the
 *  token. A copied or leaked file then grants nothing — a sha256 of 32 random
 *  bytes cannot be walked back to the bytes. */
export interface PersistedToken {
  handle: string;
  tier: AuthTier;
  /** Hex sha256 of the token. */
  hash: string;
  issuedAt: string;
}

/** Where issued teammate tokens survive a restart. Injected so tests use
 *  memory; the daemon uses `fileTokenStore`. */
export interface TokenStore {
  load: () => PersistedToken[];
  save: (tokens: PersistedToken[]) => void;
}

interface Entry extends TokenIdentity {
  hash: Buffer;
  /** True for the two tokens the daemon mints at startup. They authenticate
   *  as the operator, so today's single-user behaviour is unchanged. */
  builtIn: boolean;
  issuedAt: string | null;
}

/** What a caller may safely be shown about who holds credentials: never a
 *  token or a hash, since a list endpoint would otherwise hand them out. */
export interface IssuedTokenSummary {
  handle: string;
  tier: AuthTier;
  builtIn: boolean;
  issuedAt: string | null;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** The ActorRef a human handle renders as. Duplicated from core's actor.ts
 *  rather than imported for one string, the same way team.ts duplicates the
 *  handle pattern. */
function humanRef(handle: string): string {
  return `human:${handle}`;
}

/** A TokenStore over one JSON file, written 0600 because even hashes are
 *  nobody else's business. A missing or unreadable file loads as empty: the
 *  worst outcome is that teammates must be issued fresh tokens, never that
 *  the daemon refuses to boot. */
export function fileTokenStore(path: string): TokenStore {
  return {
    load: () => {
      if (!existsSync(path)) return [];
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
          (t): t is PersistedToken =>
            typeof t === 'object' &&
            t !== null &&
            typeof (t as PersistedToken).handle === 'string' &&
            ((t as PersistedToken).tier === 'request' ||
              (t as PersistedToken).tier === 'decide') &&
            typeof (t as PersistedToken).hash === 'string' &&
            /^[0-9a-f]{64}$/.test((t as PersistedToken).hash)
        );
      } catch {
        console.error(
          `dispatchd: ignoring unreadable team token file ${path}; issue teammates fresh tokens`
        );
        return [];
      }
    },
    save: (tokens) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
      try {
        chmodSync(path, 0o600);
      } catch {
        // A filesystem without POSIX modes is not a reason to fail the write.
      }
    },
  };
}

/** A store that keeps nothing — the default, so a registry built without one
 *  (tests, a harness) never touches disk. */
const MEMORY_ONLY: TokenStore = { load: () => [], save: () => {} };

/**
 * Every credential this daemon accepts, and who each one speaks for.
 *
 * Seeded with the two built-in tokens, both attributed to the operator — the
 * person whose machine this daemon runs on — so a solo project behaves exactly
 * as it did before. Additional tokens are issued per teammate, which is what
 * lets one shared daemon tell two humans apart.
 *
 * Every entry is held as a hash and compared hash-to-hash, so the comparison
 * is constant-length whatever was presented and no raw teammate token exists
 * anywhere after the moment it is issued.
 */
export class TokenRegistry {
  private readonly entries: Entry[] = [];

  constructor(
    builtIn: { agentToken: string; appToken: string },
    operatorHandle: string,
    private readonly store: TokenStore = MEMORY_ONLY
  ) {
    // Highest tier first, so the app token still wins if the two were ever
    // the same string — the pre-existing behaviour, kept on purpose.
    this.entries.push(
      {
        hash: sha256(builtIn.appToken),
        handle: operatorHandle,
        ref: humanRef(operatorHandle),
        tier: 'decide',
        builtIn: true,
        issuedAt: null,
      },
      {
        hash: sha256(builtIn.agentToken),
        handle: operatorHandle,
        ref: humanRef(operatorHandle),
        tier: 'request',
        builtIn: true,
        issuedAt: null,
      }
    );
    for (const t of store.load()) {
      this.entries.push({
        hash: Buffer.from(t.hash, 'hex'),
        handle: t.handle,
        ref: humanRef(t.handle),
        tier: t.tier,
        builtIn: false,
        issuedAt: t.issuedAt,
      });
    }
  }

  /** Who this token speaks for, or null when it matches nothing. */
  resolve(presented: string | null): TokenIdentity | null {
    if (presented === null || presented === '') return null;
    const digest = sha256(presented);
    for (const entry of this.entries) {
      if (timingSafeEqual(digest, entry.hash)) {
        return { handle: entry.handle, ref: entry.ref, tier: entry.tier };
      }
    }
    return null;
  }

  /**
   * Mints a credential for one teammate and returns it — the only time the
   * token value exists outside its owner's hands. Re-issuing for a handle and
   * tier that already has one replaces it, so a teammate whose laptop was lost
   * is re-credentialed rather than accumulating live tokens.
   */
  issue(handle: string, tier: AuthTier, now: Date = new Date()): string {
    this.drop(handle, tier);
    const token = randomBytes(32).toString('hex');
    this.entries.push({
      hash: sha256(token),
      handle,
      ref: humanRef(handle),
      tier,
      builtIn: false,
      issuedAt: now.toISOString(),
    });
    this.persist();
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
    const dropped = this.drop(handle, tier);
    if (dropped) this.persist();
    return dropped;
  }

  /** Who currently holds credentials, without the credentials. */
  list(): IssuedTokenSummary[] {
    return this.entries.map(({ handle, tier, builtIn, issuedAt }) => ({
      handle,
      tier,
      builtIn,
      issuedAt,
    }));
  }

  private drop(handle: string, tier: AuthTier): boolean {
    const at = this.entries.findIndex(
      (e) => !e.builtIn && e.handle === handle && e.tier === tier
    );
    if (at === -1) return false;
    this.entries.splice(at, 1);
    return true;
  }

  /** Writes the issued (never the built-in) entries back as hashes. */
  private persist(): void {
    this.store.save(
      this.entries
        .filter((e) => !e.builtIn)
        .map((e) => ({
          handle: e.handle,
          tier: e.tier,
          hash: e.hash.toString('hex'),
          issuedAt: e.issuedAt ?? new Date(0).toISOString(),
        }))
    );
  }
}

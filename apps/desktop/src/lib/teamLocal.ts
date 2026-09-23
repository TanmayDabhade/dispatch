import type { AuthTier } from '@dispatch/client';

// Team-local mode, on the page side: a teammate's browser tab on a daemon
// someone else runs (see packages/server/src/shared.ts).
//
// Its own module, not part of tauri.ts, and self-contained on purpose: several
// test files mock tauri.ts with only the exports they need, and Bun's module
// mocks are process-wide — anything imported from tauri.ts that such a mock
// omits vanishes for every later file. Nothing here touches Tauri IPC.

// Injected by dispatchd itself in team-local mode (packages/server/src/shared.ts)
// — deliberately without a token, since anyone on the network can load the page.
// A teammate signs in with a credential from `dispatch team invite`, kept below.
interface SharedConfig {
  root: string;
}

export function injectedSharedConfig(): SharedConfig | undefined {
  const value = (globalThis as { __DISPATCH_SHARED__?: unknown })
    .__DISPATCH_SHARED__;
  if (typeof value !== 'object' || value === null) return undefined;
  const root = (value as { root?: unknown }).root;
  return typeof root === 'string' ? { root } : undefined;
}

/** A teammate's own credential on a team-local daemon, and what it resolved to
 *  when they signed in. */
export interface TeamCredential {
  token: string;
  handle: string;
  tier: AuthTier;
}

// Per origin, so signing in to one team's daemon never leaks into another's.
const TEAM_CREDENTIAL_KEY = 'dispatch:team-credential';

/** True when this page was served by a daemon in team-local mode. */
export function isTeamLocalPage(): boolean {
  // Inlined rather than tauri.ts's isTauri(), for the reason at the top.
  const inTauri =
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  return !inTauri && injectedSharedConfig() !== undefined;
}

/** The signed-in teammate's credential, or null. Storage can throw (private
 *  windows, blocked site data), which reads as not signed in rather than a
 *  crash — the sign-in screen is always a safe place to land. */
export function readTeamCredential(): TeamCredential | null {
  try {
    const raw = window.localStorage.getItem(TEAM_CREDENTIAL_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<TeamCredential>;
    return typeof parsed.token === 'string' &&
      typeof parsed.handle === 'string' &&
      (parsed.tier === 'request' ||
        parsed.tier === 'decide' ||
        parsed.tier === 'operator')
      ? { token: parsed.token, handle: parsed.handle, tier: parsed.tier }
      : null;
  } catch {
    return null;
  }
}

export function saveTeamCredential(credential: TeamCredential): void {
  window.localStorage.setItem(TEAM_CREDENTIAL_KEY, JSON.stringify(credential));
}

/** Forgets the credential — signing out, or a token the daemon stopped
 *  accepting because it was revoked. */
export function clearTeamCredential(): void {
  try {
    window.localStorage.removeItem(TEAM_CREDENTIAL_KEY);
  } catch {
    // Nothing stored is the outcome we wanted.
  }
}

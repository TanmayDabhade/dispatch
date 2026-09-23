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

/** Who a teammate signed in as on a team-local daemon, and at what tier.
 *
 *  Deliberately no token. The token went to the daemon once, at sign-in, and
 *  came back as an HttpOnly session cookie the browser sends on its own — see
 *  packages/server/src/session.ts. What is kept here is only what the page
 *  needs to draw itself before the daemon has answered, and none of it is a
 *  credential. */
export interface TeamSession {
  handle: string;
  tier: AuthTier;
}

// Per origin, so signing in to one team's daemon never leaks into another's.
const TEAM_SESSION_KEY = 'dispatch:team-session';

/** True when this page was served by a daemon in team-local mode. */
export function isTeamLocalPage(): boolean {
  // Inlined rather than tauri.ts's isTauri(), for the reason at the top.
  const inTauri =
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  return !inTauri && injectedSharedConfig() !== undefined;
}

/** The signed-in teammate, or null. Storage can throw (private windows,
 *  blocked site data), which reads as not signed in rather than a crash —
 *  the sign-in screen is always a safe place to land. */
export function readTeamSession(): TeamSession | null {
  try {
    const raw = window.localStorage.getItem(TEAM_SESSION_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<TeamSession>;
    return typeof parsed.handle === 'string' &&
      (parsed.tier === 'request' ||
        parsed.tier === 'decide' ||
        parsed.tier === 'operator')
      ? { handle: parsed.handle, tier: parsed.tier }
      : null;
  } catch {
    return null;
  }
}

export function saveTeamSession(session: TeamSession): void {
  // Spelled out field by field so nothing a caller happens to carry — a token,
  // above all — is ever written through.
  window.localStorage.setItem(
    TEAM_SESSION_KEY,
    JSON.stringify({ handle: session.handle, tier: session.tier })
  );
}

/** Forgets the session in this tab — signing out, or a token the daemon
 *  stopped accepting because it was revoked or expired. */
export function clearTeamSession(): void {
  try {
    window.localStorage.removeItem(TEAM_SESSION_KEY);
  } catch {
    // Nothing stored is the outcome we wanted.
  }
}

/** Ends the session: the daemon clears the cookie, this tab forgets who it
 *  was, and the page reloads onto the sign-in screen. */
export async function signOutOfTeam(
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  try {
    await fetchImpl('/api/session', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
    });
  } finally {
    clearTeamSession();
    window.location.reload();
  }
}

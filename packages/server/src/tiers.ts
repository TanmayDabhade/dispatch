// What a credential may do, as an ordered ladder.
//
// Three rungs, each including everything below it:
//
// - `request` drives the project: the board, dispatching runs, reviewing,
//   reading files. The on-disk agent token sits here, and so does a new
//   teammate.
// - `decide` adds adjudication: approving a parked tool call, deciding a scope
//   request, confirming an assistant's action, handing out credentials.
// - `operator` adds acting on the host machine as the person who runs it: a
//   shell, a browser carrying their cookies, writing files straight to disk,
//   and git operations on their own checkout. The daemon's app token sits
//   here, since it only ever reaches the person at the keyboard.
//
// `decide` and `operator` were one tier until terminals, the driven browser and
// direct file writes arrived. Folding those into "may approve" meant a reviewer
// could not be trusted with a merge without also being trusted with a shell.

export type AuthTier = 'request' | 'decide' | 'operator';

/** Every tier, lowest first. */
export const AUTH_TIERS: readonly AuthTier[] = [
  'request',
  'decide',
  'operator',
];

/** Whether a value read off the wire or out of a file names a tier. */
export function isAuthTier(value: unknown): value is AuthTier {
  return (AUTH_TIERS as readonly unknown[]).includes(value);
}

/** Whether a credential of tier `held` may use a route that needs `needed`. */
export function tierAllows(held: AuthTier, needed: AuthTier): boolean {
  return AUTH_TIERS.indexOf(held) >= AUTH_TIERS.indexOf(needed);
}

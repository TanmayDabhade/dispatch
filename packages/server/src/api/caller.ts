import type { ApiContext } from '../api.js';

/**
 * The human a write should be credited to: whoever presented the credential,
 * falling back to the operator for a context built without one (the few
 * internal callers that reach handlers directly).
 *
 * This is what makes attribution trustworthy on a shared daemon. Before
 * tokens named people every human write was credited to the operator,
 * because the operator was the only human there could be; a teammate's
 * comment would have read as the operator's.
 *
 * Its own module, importing only types, so the route modules under api/ can
 * call it without a value-level import cycle back into api.ts.
 */
export function humanActor(ctx: ApiContext): string {
  return ctx.caller?.ref ?? ctx.actorContext.humanRef;
}

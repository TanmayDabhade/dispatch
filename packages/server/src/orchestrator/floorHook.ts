import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';

import { floorCheckForToolInput } from '../floor.js';

// What a floor-tripping call becomes: `ask` routes it to the session's
// `canUseTool`, where a human decides; `deny` refuses it outright, for a
// session that has no human to ask.
export type FloorHookAction = 'ask' | 'deny';

/**
 * PreToolUse hooks that hold every irreversible tool call (floor.ts: a
 * force-push, a publish, a repo-settings change, a remote ref deletion) for a
 * human, whatever the permission mode or settings would otherwise do.
 *
 * The floor used to be enforced only inside `canUseTool`, and the Claude Code
 * CLI does not always call it. Verified against the bundled CLI (SDK
 * 0.3.207), a `git push --force` ran without `canUseTool` ever being called
 * under `permissionMode: 'bypassPermissions'`, and under any mode once a
 * settings allow rule such as `Bash(git push:*)` matched it. Plan-mode
 * sessions with no `canUseTool` at all ran it on the same allow rule.
 *
 * A PreToolUse hook runs before any of those shortcuts, for sub-agents' calls
 * too. Its `ask` made the CLI call `canUseTool` in every permission mode,
 * including `bypassPermissions` and `dontAsk`, and it outranked another hook
 * answering `allow`. Calls the floor does not cover get no decision at all,
 * so they go through the session's normal permission flow unchanged.
 */
export function floorHooks(
  action: FloorHookAction
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const hold: HookCallback = (input) => {
    if (input.hook_event_name !== 'PreToolUse') return noDecision();
    const check = floorCheckForToolInput(input.tool_input);
    if (check === null) return noDecision();
    const output: HookJSONOutput = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: action,
        permissionDecisionReason:
          action === 'ask'
            ? `Irreversible action (${check}): Dispatch holds it for a human decision.`
            : `Irreversible action (${check}): Dispatch never runs it in this session, which has no human to approve it.`,
      },
    };
    return Promise.resolve(output);
  };
  return { PreToolUse: [{ hooks: [hold] }] };
}

// An empty hook output: no decision, so the CLI carries on exactly as if the
// hook were not there.
function noDecision(): Promise<HookJSONOutput> {
  return Promise.resolve({});
}

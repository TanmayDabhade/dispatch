import type {
  HookCallback,
  HookJSONOutput,
  Options,
} from '@anthropic-ai/claude-agent-sdk';

import { floorCheckForToolInput } from '../floor.js';

// What a floor-tripping call becomes: `ask` routes it to the session's
// `canUseTool`, where a human decides; `deny` refuses it outright, for a
// session that has no human to ask.
export type FloorHookAction = 'ask' | 'deny';

/**
 * The SDK options that hold every irreversible tool call (floor.ts: a
 * force-push, a publish, a repo-settings change, a remote ref deletion) for a
 * human in a Claude Code session, spread into that session's `query()`
 * options.
 *
 * The floor used to be enforced only inside `canUseTool`, and the Claude Code
 * CLI does not always call it. Verified against the bundled CLI (SDK
 * 0.3.207), a `git push --force` ran without `canUseTool` ever being called
 * under `permissionMode: 'bypassPermissions'`, and under any mode once a
 * settings allow rule such as `Bash(git push:*)` matched it. Plan-mode
 * sessions with no `canUseTool` at all ran it on the same allow rule.
 *
 * Three parts close those paths:
 *
 * - A PreToolUse hook runs before the permission mode, allow rules and the
 *   auto-mode classifier, for sub-agents' calls too. Its `ask` made the CLI
 *   call `canUseTool` in default, acceptEdits, auto, dontAsk and
 *   bypassPermissions, and it outranked another hook answering `allow`. Calls
 *   the floor does not cover get no decision, so they take the session's
 *   normal permission path unchanged.
 * - `CLAUDE_CODE_SIMPLE` is pinned off. Bare mode drops every hook registered
 *   through the SDK, and a repo's `.claude/settings.json` (or a
 *   `settings.local.json` an agent writes) can switch it on through its `env`
 *   block; with the hook gone, a force-push ran under bypassPermissions.
 *   These settings load into the SDK's flag layer, which outranks the user,
 *   project and local files.
 * - Inline shell in skills and custom slash commands (a `!` + backtick line in
 *   a SKILL.md) is disabled. It runs as the skill loads, reaching neither a
 *   tool hook nor `canUseTool`; a checkout's own skill ran a force-push that
 *   way. The model can still run the same command through Bash, where the
 *   hook sees it.
 *
 * `refusal` is checked ahead of the floor on every call: while it returns a
 * reason, every call is denied with that reason, floor commands included. The
 * Claude executor's graceful stop uses it, since the stop has to reach the
 * agent in the same modes where canUseTool never runs. Checking both in one
 * callback means the outcome does not depend on how the CLI merges two hooks
 * that disagree.
 */
export function floorGuard(
  action: FloorHookAction,
  refusal: () => string | null = () => null
): Required<Pick<Options, 'hooks' | 'settings'>> {
  return {
    hooks: { PreToolUse: [{ hooks: [floorHook(action, refusal)] }] },
    settings: {
      env: { CLAUDE_CODE_SIMPLE: '0' },
      disableSkillShellExecution: true,
    },
  };
}

// The PreToolUse callback itself. It sees every tool (no matcher), because a
// command can reach the shell through any tool whose input carries one.
function floorHook(
  action: FloorHookAction,
  refusal: () => string | null
): HookCallback {
  return (input) => {
    if (input.hook_event_name !== 'PreToolUse') return noDecision();
    const refused = refusal();
    if (refused !== null) return decision('deny', refused);
    const check = floorCheckForToolInput(input.tool_input);
    if (check === null) return noDecision();
    return decision(
      action,
      action === 'ask'
        ? `This command matches Dispatch's irreversible-action floor (${check}), so it waits for a human decision.`
        : `This command matches Dispatch's irreversible-action floor (${check}) and cannot run in this read-only session, which has no human to approve it. If you only meant to search for or read that text, use Grep or Read instead.`
    );
  };
}

// A PreToolUse decision, with the reason the CLI shows the model.
function decision(
  permissionDecision: FloorHookAction,
  permissionDecisionReason: string
): Promise<HookJSONOutput> {
  return Promise.resolve({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason,
    },
  });
}

// An empty hook output: no decision, so the CLI carries on exactly as if the
// hook were not there.
function noDecision(): Promise<HookJSONOutput> {
  return Promise.resolve({});
}

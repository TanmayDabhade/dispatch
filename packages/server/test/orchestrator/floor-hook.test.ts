import { describe, expect, it } from 'bun:test';

import { floorGuard } from '../../src/orchestrator/floorHook.js';
import { floorDecision, preToolUse } from './helpers.js';

describe('floorGuard', () => {
  it('asks for a human on every floor command, from any tool carrying a command', async () => {
    const hooks = floorGuard('ask').hooks;
    for (const command of [
      'git push --force origin main',
      'npm publish',
      'git push origin v1.2.3',
      'gh repo edit --visibility public',
      'git push origin --delete feature',
    ]) {
      expect(await floorDecision(hooks, 'Bash', { command })).toBe('ask');
    }
    // The tool's name is not what decides: a renamed shell tool still counts.
    expect(
      await floorDecision(hooks, 'mcp__shell__run', {
        command: 'git push -f origin main',
      })
    ).toBe('ask');
  });

  it('denies floor commands outright in a session with no human to ask', async () => {
    expect(
      await floorDecision(floorGuard('deny').hooks, 'Bash', {
        command: 'cargo publish',
      })
    ).toBe('deny');
  });

  it('names the floor check in the reason the CLI passes on', async () => {
    const hook = floorGuard('ask').hooks.PreToolUse?.[0]?.hooks[0];
    const output = await hook?.(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git push --force' },
        tool_use_id: 'tu-1',
      } as never,
      'tu-1',
      { signal: new AbortController().signal }
    );
    expect(JSON.stringify(output)).toContain('force-push');
  });

  it('gives no decision for anything the floor does not cover', async () => {
    const hooks = floorGuard('ask').hooks;
    // No decision (not "allow"): the call takes the session's normal path.
    expect(
      await floorDecision(hooks, 'Bash', { command: 'git push origin HEAD' })
    ).toBeUndefined();
    expect(
      await floorDecision(hooks, 'Edit', { file_path: 'a.ts' })
    ).toBeUndefined();
    expect(await floorDecision(hooks, 'Read', null)).toBeUndefined();
  });

  it('denies every call with the refusal reason while there is one, floor or not', async () => {
    let reason: string | null = null;
    const hooks = floorGuard('ask', () => reason).hooks;
    expect(await floorDecision(hooks, 'Edit', { file_path: 'a.ts' })).toBe(
      undefined
    );
    expect(await floorDecision(hooks, 'Bash', { command: 'npm publish' })).toBe(
      'ask'
    );

    reason = 'stop now';
    for (const [toolName, toolInput] of [
      ['Edit', { file_path: 'a.ts' }],
      ['Read', null],
      ['Bash', { command: 'npm publish' }],
    ] as const) {
      expect(await preToolUse(hooks, toolName, toolInput)).toMatchObject({
        permissionDecision: 'deny',
        permissionDecisionReason: 'stop now',
      });
    }
  });

  it('gives no decision for events other than PreToolUse', async () => {
    const hook = floorGuard('deny').hooks.PreToolUse?.[0]?.hooks[0];
    const output = await hook?.(
      {
        hook_event_name: 'PostToolUse',
        tool_input: { command: 'npm publish' },
      } as never,
      undefined,
      { signal: new AbortController().signal }
    );
    expect(output).toEqual({});
  });

  // No matcher: a command can reach the shell through any tool whose input
  // carries one, so the hook has to see every tool call.
  it('hooks every tool, with no matcher narrowing it', () => {
    const matchers = floorGuard('ask').hooks.PreToolUse ?? [];
    expect(matchers).toHaveLength(1);
    expect(matchers[0]?.matcher).toBeUndefined();
  });

  // Both were verified against the bundled CLI: a repo's settings `env` could
  // switch on bare mode, which drops SDK hooks, and a SKILL.md's inline shell
  // ran a force-push without reaching any hook or canUseTool.
  it('pins bare mode off and disables inline skill shell in the flag settings layer', () => {
    for (const action of ['ask', 'deny'] as const) {
      expect(floorGuard(action).settings).toEqual({
        env: { CLAUDE_CODE_SIMPLE: '0' },
        disableSkillShellExecution: true,
      });
    }
  });
});
